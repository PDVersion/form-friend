// validate.js — pre-save integrity checks on imported questions.
//
// The core requirement: every conditional-logic reference must point at a
// question UUID that actually exists. We also catch duplicate UUIDs and a few
// structural problems. Errors block the rebuild; warnings are advisory.
//
// IMPORTANT: run AFTER ensureUuids() so newly added questions already have IDs
// and can be both referenced and reference-checked.

import { KNOWN_OPERATORS } from "./schema.js";

export function validateImport(parsed) {
  const questions = (parsed && parsed.questions) || [];
  const errors = [];
  const warnings = [];

  // Collect the set of valid question IDs and flag duplicates.
  const idSet = new Set();
  const seen = new Set();
  for (const q of questions) {
    const id = (q.uuid || "").trim();
    if (!id) continue;
    if (seen.has(id)) {
      errors.push(`Duplicate question UUID ${id} (reused by "${q.name || "(unnamed)"}").`);
    }
    seen.add(id);
    idSet.add(id);
  }

  for (const q of questions) {
    const label = q.name ? `"${q.name}"` : `question ${q.uuid || "(no id)"}`;

    if (!q.type) {
      errors.push(`${label} is missing a type.`);
    }
    if (q.method && q.method !== "AND" && q.method !== "OR") {
      errors.push(`${label} has an invalid condition method "${q.method}" (expected AND or OR).`);
    }

    for (const c of q.conditions || []) {
      if (c.ref) {
        if (!idSet.has(c.ref)) {
          errors.push(`${label} references a missing question UUID: ${c.ref}`);
        }
      } else if (c.op || c.value) {
        warnings.push(`${label} has a condition with an operator/value but no referenced question; it will be dropped.`);
      }
      if (c.op && !KNOWN_OPERATORS.includes(c.op)) {
        warnings.push(`${label} uses an unrecognised operator "${c.op}".`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
