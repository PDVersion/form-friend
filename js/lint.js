// lint.js — higher-order skip-logic linter for form conditions.
//
// Builds on the structural conditionIssues() in schema.js (which catches broken
// refs, unknown operators, empty values, forward refs). This module adds
// semantic checks across the conditions of a single question: duplicate rules,
// AND-contradictions (question can never be hidden = dead logic),
// OR-tautologies (question is always hidden = likely a bug), subsumption,
// and the "required but hideable" footgun.
//
// All functions are pure (no DOM, no state imports). Testable in Node.

import { conditionIssues, KNOWN_OPERATORS } from "./schema.js";

// Severities used in issue objects.
export const SEV = { error: "error", warning: "warning", info: "info" };

// Operators where numeric comparison is meaningful (GT/LT).
const NUMERIC_OPS = new Set(["GT", "LT"]);

// Returns true if two conditions on the SAME ref logically contradict under AND,
// meaning they can never both be true simultaneously.
function contradictsUnderAnd(a, b) {
  const A = a.op, B = b.op, VA = a.value, VB = b.value;

  // EQ x AND EQ y  (x ≠ y) — can only equal one value at a time
  if (A === "EQ" && B === "EQ" && VA !== VB) return true;
  // EQ x AND NEQ x
  if (A === "EQ" && B === "NEQ" && VA === VB) return true;
  if (A === "NEQ" && B === "EQ" && VA === VB) return true;
  // GT a AND LT b where a >= b (no value is both > a and < b when a >= b)
  if (A === "GT" && B === "LT") {
    const na = parseFloat(VA), nb = parseFloat(VB);
    if (!isNaN(na) && !isNaN(nb) && na >= nb) return true;
  }
  if (A === "LT" && B === "GT") {
    const na = parseFloat(VA), nb = parseFloat(VB);
    if (!isNaN(na) && !isNaN(nb) && nb >= na) return true;
  }
  return false;
}

// Returns true if two conditions on the SAME ref form a tautology under OR,
// meaning one of them is always true, so the OR always fires.
function tautologyUnderOr(a, b) {
  const A = a.op, B = b.op, VA = a.value, VB = b.value;
  // EQ x OR NEQ x — together cover all values
  if (A === "EQ" && B === "NEQ" && VA === VB) return true;
  if (A === "NEQ" && B === "EQ" && VA === VB) return true;
  // CON x OR NCON x — together cover all strings
  if (A === "CON" && B === "NCON" && VA === VB) return true;
  if (A === "NCON" && B === "CON" && VA === VB) return true;
  return false;
}

// Returns true if condition `a` is subsumed by condition `b` under the method,
// meaning `b` being present makes `a` redundant.
// Under AND: if b is stricter than a, a is never the deciding condition.
// Under OR:  if a fires whenever b fires (b is stricter), then a fires more,
//            but that means b is subsumed by a, not a by b. We detect:
//            OR:  GT 10 and GT 5 → GT 10 is subsumed (GT 5 already captures all GT10 cases)
//            AND: GT 5 and GT 10 → GT 5 is subsumed (AND needs both; GT 10 already implies GT 5 needed too)
// Returns {a_subsumed, b_subsumed} booleans.
function subsumption(a, b, method) {
  if (a.op !== b.op) return { a_subsumed: false, b_subsumed: false };
  const op = a.op;
  if (!NUMERIC_OPS.has(op)) return { a_subsumed: false, b_subsumed: false };

  const na = parseFloat(a.value), nb = parseFloat(b.value);
  if (isNaN(na) || isNaN(nb) || na === nb) return { a_subsumed: false, b_subsumed: false };

  if (op === "GT") {
    // GT a AND GT b: the larger threshold makes the smaller one redundant under AND
    // GT a OR  GT b: the smaller threshold makes the larger one redundant under OR
    if (method === "AND") {
      return { a_subsumed: na < nb, b_subsumed: nb < na };
    } else {
      return { a_subsumed: na > nb, b_subsumed: nb > na };
    }
  }
  if (op === "LT") {
    // LT a AND LT b: the smaller threshold makes the larger one redundant under AND
    // LT a OR  LT b: the larger threshold makes the smaller one redundant under OR
    if (method === "AND") {
      return { a_subsumed: na > nb, b_subsumed: nb > na };
    } else {
      return { a_subsumed: na < nb, b_subsumed: nb < na };
    }
  }
  return { a_subsumed: false, b_subsumed: false };
}

// Main export. Takes the sorted questions array from state.questions.
// Returns [{uuid, position, severity, code, message}].
// Also includes structural issues from conditionIssues() with severity "error".
export function lintForm(questions) {
  const issues = [];
  const idSet = new Set(questions.map((q) => q.uuid));
  const idToNumber = new Map(questions.map((q, i) => [q.uuid, i + 1]));

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const position = qi + 1;
    const conds = q.conditions || [];
    const method = q.method || "AND";
    const ctx = { position, knownOperators: KNOWN_OPERATORS, idSet, idToNumber };

    // ── Structural issues (delegate to conditionIssues) ──────────────────────
    for (const c of conds) {
      const structural = conditionIssues(c, ctx);
      for (const msg of structural) {
        issues.push({
          uuid: q.uuid,
          position,
          severity: SEV.error,
          code: "structural",
          message: msg.charAt(0).toUpperCase() + msg.slice(1) + ".",
        });
      }
    }

    // ── Well-formed conditions only for higher-order checks ──────────────────
    const good = conds.filter((c) => conditionIssues(c, ctx).length === 0);
    if (good.length === 0) continue;

    // ── Duplicate rules ──────────────────────────────────────────────────────
    const seen = new Set();
    for (const c of good) {
      const key = `${c.ref}|${c.op}|${c.value}`;
      if (seen.has(key)) {
        const refNum = idToNumber.get(c.ref);
        const label = refNum ? `question ${refNum}` : "a question";
        issues.push({
          uuid: q.uuid,
          position,
          severity: SEV.info,
          code: "duplicate",
          message: `Duplicate rule — "${c.op} ${c.value}" on ${label} appears more than once. Remove the extra copy.`,
        });
      } else {
        seen.add(key);
      }
    }

    // ── Pair-wise checks on conditions sharing the same ref ──────────────────
    // Group well-formed, non-duplicate conditions by their ref
    const byRef = new Map();
    const deduped = good.filter((c) => {
      const key = `${c.ref}|${c.op}|${c.value}`;
      if (!byRef.has("_seen_" + key)) { byRef.set("_seen_" + key, true); return true; }
      return false;
    });
    const grouped = new Map();
    for (const c of deduped) {
      if (!grouped.has(c.ref)) grouped.set(c.ref, []);
      grouped.get(c.ref).push(c);
    }

    for (const [ref, group] of grouped) {
      const refNum = idToNumber.get(ref);
      const label = refNum ? `question ${refNum}` : "a question";

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];

          if (method === "AND" && contradictsUnderAnd(a, b)) {
            issues.push({
              uuid: q.uuid,
              position,
              severity: SEV.warning,
              code: "contradiction",
              message: `Contradictory rules on ${label} under AND — "${a.op} ${a.value}" and "${b.op} ${b.value}" can never both be true, so this question will never be hidden. The skip logic is dead.`,
            });
          }

          if (method === "OR" && tautologyUnderOr(a, b)) {
            issues.push({
              uuid: q.uuid,
              position,
              severity: SEV.warning,
              code: "tautology",
              message: `These two rules on ${label} under OR always trigger together — "${a.op} ${a.value}" and "${b.op} ${b.value}" cover every possible value, so this question will always be hidden. Is that intentional?`,
            });
          }

          const sub = subsumption(a, b, method);
          if (sub.a_subsumed) {
            issues.push({
              uuid: q.uuid,
              position,
              severity: SEV.info,
              code: "subsumption",
              message: `Rule "${a.op} ${a.value}" on ${label} never does anything — "${b.op} ${b.value}" already covers it under ${method}. Remove the weaker rule.`,
            });
          } else if (sub.b_subsumed) {
            issues.push({
              uuid: q.uuid,
              position,
              severity: SEV.info,
              code: "subsumption",
              message: `Rule "${b.op} ${b.value}" on ${label} never does anything — "${a.op} ${a.value}" already covers it under ${method}. Remove the weaker rule.`,
            });
          }
        }
      }
    }

    // ── Required but hideable ────────────────────────────────────────────────
    if (q.mandatory && good.length > 0) {
      issues.push({
        uuid: q.uuid,
        position,
        severity: SEV.warning,
        code: "required-hideable",
        message: `This question is marked required, but skip conditions can hide it. ServiceM8 will demand an answer to a hidden field — verify this is intentional or remove the "required" flag.`,
      });
    }
  }

  return issues;
}

// Convenience: map of question uuid → its lint issues.
export function lintByUuid(questions) {
  const map = new Map();
  for (const issue of lintForm(questions)) {
    if (!map.has(issue.uuid)) map.set(issue.uuid, []);
    map.get(issue.uuid).push(issue);
  }
  return map;
}
