// flow.js — transforms state.questions into a dependency graph for the Logic Map.
//
// Conditions in ServiceM8 are SKIP rules: a question is HIDDEN when its
// condition(s) evaluate TRUE. They reference EARLIER questions by UUID.
// An edge in this graph therefore means: "the source question's answer
// can hide the target question." Never "leads to."
//
// Pure module (no DOM, no state). Testable in Node.

import { conditionIssues, KNOWN_OPERATORS } from "./schema.js";
import { lintForm } from "./lint.js";

export const OP_LABELS = {
  CON: "contains",
  NCON: "does not contain",
  EQ: "equals",
  NEQ: "does not equal",
  GT: "greater than",
  LT: "less than",
};

// Builds the graph from a sorted questions array (state.questions).
// Returns { nodes: [...], edges: [...] }.
//
// node: { id, num, label, type, mandatory, alwaysHidden, neverHidden }
//   alwaysHidden: linter detected tautology (always skipped — likely a bug)
//   neverHidden:  linter detected contradiction (dead skip logic)
//
// edge: { from, to, fromNum, toNum, label, op, value, method, broken }
//   from: uuid of the controlling (earlier) question
//   to:   uuid of the question being hidden
//   broken: true if the condition has structural issues (shown differently)
export function buildFlowGraph(questions) {
  const idSet = new Set(questions.map((q) => q.uuid));
  const idToNumber = new Map(questions.map((q, i) => [q.uuid, i + 1]));

  // Collect lint results to flag always/never-hidden nodes.
  const lintIssues = lintForm(questions);
  const tautologyUuids = new Set(
    lintIssues.filter((i) => i.code === "tautology").map((i) => i.uuid)
  );
  const contradictionUuids = new Set(
    lintIssues.filter((i) => i.code === "contradiction").map((i) => i.uuid)
  );

  const nodes = questions.map((q, i) => ({
    id: q.uuid,
    num: i + 1,
    label: q.name || "(untitled)",
    type: q.type || "",
    mandatory: !!q.mandatory,
    alwaysHidden: tautologyUuids.has(q.uuid),
    neverHidden: contradictionUuids.has(q.uuid),
  }));

  const edges = [];
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const position = qi + 1;
    const ctx = { position, knownOperators: KNOWN_OPERATORS, idSet, idToNumber };

    for (const c of q.conditions || []) {
      const broken = conditionIssues(c, ctx).length > 0;
      const opLabel = OP_LABELS[c.op] || c.op || "?";
      edges.push({
        from: c.ref || null,
        to: q.uuid,
        fromNum: idToNumber.get(c.ref) ?? null,
        toNum: position,
        label: `${opLabel} "${c.value}"`,
        op: c.op,
        value: c.value,
        method: q.method || "AND",
        broken,
      });
    }
  }

  return { nodes, edges };
}

// Returns questions that control the visibility of `uuid` (affect it).
export function affectedByOf(graph, uuid) {
  return graph.edges
    .filter((e) => e.to === uuid && !e.broken)
    .map((e) => ({ num: e.fromNum, label: graph.nodes.find((n) => n.id === e.from)?.label || e.from, edge: e }));
}

// Returns questions whose visibility is controlled by `uuid` (affected by it).
export function affectsOf(graph, uuid) {
  return graph.edges
    .filter((e) => e.from === uuid && !e.broken)
    .map((e) => ({ num: e.toNum, label: graph.nodes.find((n) => n.id === e.to)?.label || e.to, edge: e }));
}

// Converts the graph to a Mermaid flowchart string for rendering.
// Edge direction: from (controlling Q) → to (hidden Q), labelled "hides when X".
// Dashed red edges for "hides"; node styling encodes mandatory/always/never.
export function toMermaid(graph) {
  const lines = ["flowchart LR"];

  // Node declarations with shape and class
  for (const n of graph.nodes) {
    const safeLabel = n.label.replace(/"/g, "'");
    const num = n.num;
    const id = `Q${num}`;
    // Mandatory gets a double-rect shape [[label]], others get rounded (label)
    const shape = n.mandatory ? `[["${num}. ${safeLabel}"]]` : `("${num}. ${safeLabel}")`;
    lines.push(`  ${id}${shape}`);
    if (n.alwaysHidden) lines.push(`  class ${id} always-hidden`);
    else if (n.neverHidden) lines.push(`  class ${id} never-hidden`);
    else if (n.mandatory) lines.push(`  class ${id} mandatory`);
  }

  // Edge declarations — only non-broken edges in the Mermaid diagram
  // Broken edges are shown in the text pane instead.
  const numById = new Map(graph.nodes.map((n) => [n.id, n.num]));
  for (const e of graph.edges) {
    if (e.broken || !e.from) continue;
    const fromId = `Q${numById.get(e.from)}`;
    const toId = `Q${e.toNum}`;
    const safeLabel = e.label.replace(/"/g, "'");
    // Dashed arrow to convey "hides" semantics
    lines.push(`  ${fromId} -. "hides when ${safeLabel}" .-> ${toId}`);
  }

  // Class definitions
  lines.push(`  classDef mandatory fill:#fef3c7,stroke:#d97706,color:#1e293b`);
  lines.push(`  classDef always-hidden fill:#fee2e2,stroke:#dc2626,color:#1e293b`);
  lines.push(`  classDef never-hidden fill:#dcfce7,stroke:#16a34a,color:#1e293b`);

  return lines.join("\n");
}
