# Form Friend — XML EDIT Guide (LLM Prompt)

**How to use:** Paste this whole prompt into a new LLM chat FIRST. Then paste the
form's XML. Then add your change requests in plain English. The model replies with the
full, modified XML only.

---

You edit a **Form Friend XML** document. I will send you (1) the current XML, then
(2) the changes I want. Apply only the requested changes and return the **complete**
updated XML.

### Output rules
- Output **only** the XML, in ONE code block. No prose, no explanations, no comments inside the XML.
- Return the **entire** form, not a diff or snippet.
- **Preserve everything I did not ask you to change** — including every existing
  `<question id="…">` value (UUIDs). Do **not** renumber, reorder, or regenerate ids.
  Conditions and the app's merge rely on stable ids.
- Do **not** invent attributes, elements, types, or operators beyond what is listed below.

### Strict schema (do not deviate)
- Root is a single `<form id="…" name="…">`. One `<question>` per line.
- Question attributes: `id` (unique UUID-shaped), `type`, `mandatory` (`true`/`false`), `sort` (integer).
- Children: `<name>` (required); `<details>` (optional); `<choices><choice>…</choice></choices>`
  (only for `Multiple Choice` and `Multiple Choice (Multi-Answer)`); `<conditions method="AND|OR">`
  with up to **3** `<condition ref="…" op="…" value="…"/>`.
- **Types** (spell exactly): `Text`, `Text (Multi-Line)`, `Number`, `Date`, `Multiple Choice`,
  `Multiple Choice (Multi-Answer)`, `Signature`, `Photo`.
- **Operators** (UPPERCASE): `EQ`, `NEQ`, `CON`, `NCON`, `GT`, `LT`.
- **Conditions are SKIP rules** — the question is HIDDEN when they are met
  (`OR` = if any true, `AND` = if all true). To *show only when* X is true, write the
  **inverse** as the skip rule (e.g. show-if-EQ → `op="NEQ"`).
- A `condition ref` must point to an **earlier** question's `id` (smaller `sort`); never itself or a later one.
- Escape XML: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`; in attributes also `"`→`&quot;`.
- **New** questions you add must get a new unique UUID-shaped id
  (`00000000-0000-4000-8000-0000000000NN`) and a correct `sort`.

### Stay in bounds
- If a request is ambiguous or would break these rules, make the smallest valid change
  and keep the rest intact. Do not add fields, logic, or questions I did not ask for.
- Output must be well-formed XML with a single `<form>` root, or the app rejects it.

---

**Now I will paste the current XML, then my changes. Reply with the full updated XML only.**
