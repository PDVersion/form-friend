# Form Friend — Quick XML Create Guide (LLM Prompt)

**How to use:** Paste this whole prompt into a new LLM chat FIRST. Then list the
questions you want in plain English. The model replies with **Form Friend XML** only —
ready to paste into the app's XML editor and build a `.sm8f`.

This is the short, low-token version for building a form **from scratch** (no existing
XML required). For exhaustive detail and worked examples, use the full create guide.

---

You build a **Form Friend XML** document from a plain-English form description.
Output the XML only — nothing else.

### Output rules
- Output **only** the XML, in ONE code block. No prose, no explanations, no comments inside the XML.
- Root is a single `<form id="00000000-0000-4000-8000-000000000000" name="FORM NAME">`.
- One `<question>` per line. Invent nothing outside the schema below.

### Schema (do not deviate)
- Question attributes: `id` (unique UUID-shaped), `type`, `mandatory` (`true`/`false`), `sort` (integer 1,2,3…).
- Children: `<name>` (required); `<details>` (optional help text); `<choices><choice>…</choice></choices>`
  (only for the two Multiple Choice types); `<conditions method="AND|OR">` with up to **3**
  `<condition ref="…" op="…" value="…"/>`.
- **Types** (spell exactly): `Text`, `Text (Multi-Line)`, `Number`, `Date`, `Multiple Choice`,
  `Multiple Choice (Multi-Answer)`, `Signature`, `Photo`.
- **Operators** (UPPERCASE): `EQ`, `NEQ`, `CON`, `NCON`, `GT`, `LT`.
- **IDs:** give each question `00000000-0000-4000-8000-0000000000NN`, incrementing `NN`
  (01, 02, …). Any unique `8-4-4-4-12` hex string is valid.

### Conditions are SKIP rules
A question is **HIDDEN** when its conditions are met (`OR` = if any true, `AND` = if all true).
So to *show only when* something is true, write the **inverse** as the skip rule:

| Show only when an earlier answer… | Skip-if |
|---|---|
| equals X | `op="NEQ" value="X"` |
| does not equal X | `op="EQ" value="X"` |
| contains X | `op="NCON" value="X"` |
| does not contain X | `op="CON" value="X"` |
| number ≥ X | `op="LT" value="X"` |
| number ≤ X | `op="GT" value="X"` |

A `condition ref` must point to an **earlier** question's `id` (smaller `sort`) — never itself or a later one.

### Other rules
- Escape XML: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`; in attributes also `"`→`&quot;`.
- Add `<choices>` only to `Multiple Choice` / `Multiple Choice (Multi-Answer)`. Omit `<details>` and
  `<conditions>` when unused.
- Output must be well-formed XML with a single `<form>` root, or the app rejects it.

### Mini example
```xml
<form id="00000000-0000-4000-8000-000000000000" name="Pool Visit">
<question id="00000000-0000-4000-8000-000000000001" type="Multiple Choice" mandatory="true" sort="1"><name>Was the pool accessible?</name><choices><choice>Yes</choice><choice>No</choice></choices></question>
<question id="00000000-0000-4000-8000-000000000002" type="Text (Multi-Line)" mandatory="true" sort="2"><name>Reason it was not accessible</name><conditions method="AND"><condition ref="00000000-0000-4000-8000-000000000001" op="EQ" value="Yes"/></conditions></question>
</form>
```

---

**Now list your form name and questions. Reply with the complete XML only.**
