# Form Friend — XML Authoring Guide (LLM Prompt)

**How to use:** Paste this entire document into a new LLM chat. Then list the questions you want
in plain English. The model replies with **Form Friend XML**. Copy that XML into the app's
**“Have XML already? → Build .sm8f”** box (or the *Import edited XML* box) and download a working
`.sm8f`.

---

## Your task (model instructions)

You convert a plain-English form description into ONE valid XML document in the EXACT format below.
Output **only** the XML, inside a single code block, with no text before or after it. Do not invent
attributes or elements that are not listed here. Do not add comments inside the XML.

## Output format

```xml
<form id="00000000-0000-4000-8000-000000000000" name="FORM NAME">
<question id="00000000-0000-4000-8000-000000000001" type="TYPE" mandatory="true" sort="1"><name>Question text</name><details>Optional help text</details><choices><choice>Option A</choice><choice>Option B</choice></choices><conditions method="AND"><condition ref="EARLIER-QUESTION-ID" op="OP" value="VALUE"/></conditions></question>
</form>
```

One `<question>` per line (readability only — not required). `<details>`, `<choices>`, and
`<conditions>` are each **optional**: include them only when needed.

## Elements & attributes

| Part | Required | Notes |
|---|---|---|
| `<form name="…">` | yes | Becomes the form's name. |
| `<form id="…">` | no | Leave the all-zero placeholder; the app assigns a real form UUID. |
| `<question id="…">` | yes | Unique UUID-shaped id (see Rules) so conditions can point at it. |
| `<question type="…">` | yes | One Type from the table below, spelled EXACTLY. |
| `<question mandatory="…">` | yes | `true` or `false`. |
| `<question sort="…">` | yes | Integer display order: 1, 2, 3, … |
| `<name>` | yes | The question label. |
| `<details>` | no | Help text shown under the question. May contain line breaks. Omit if empty. |
| `<choices>` / `<choice>` | choice types only | One `<choice>` per option. |
| `<conditions method="…">` | with conditions | `AND` or `OR`; applies to ALL conditions in that question. |
| `<condition>` | no | `ref` + `op` + `value`. Max 3 per question. |

## Question types (spell exactly)

| Type | Use | Choices? |
|---|---|---|
| `Text` | short text | no |
| `Text (Multi-Line)` | long text | no |
| `Number` | numeric input | no |
| `Date` | a date | no |
| `Multiple Choice` | pick ONE option | yes |
| `Multiple Choice (Multi-Answer)` | pick MANY options | yes |
| `Signature` | signature capture | no |
| `Photo` | photo capture | no |

## Operators (UPPERCASE)

| op | Meaning | Best for |
|---|---|---|
| `EQ` | equals (exact) | Multiple Choice; exact values |
| `NEQ` | does not equal | Multiple Choice |
| `CON` | contains (substring, or one of the selected answers) | Multi-Answer; partial text |
| `NCON` | does not contain | Multi-Answer; partial text |
| `GT` | greater than (numeric, strict) | Number |
| `LT` | less than (numeric, strict) | Number |

## ⚠️ Conditions are SKIP rules — read carefully

A `<conditions>` block lists reasons to **HIDE / SKIP** the question. The question is skipped when
the conditions are satisfied:

- `method="OR"` → skip if **any** condition is true.
- `method="AND"` → skip if **all** conditions are true.

So to make a question appear **only when** something is true, write the **opposite** as a skip rule:

| Show the question only when… | Skip-if condition |
|---|---|
| an earlier answer **equals** X | `op="NEQ" value="X"` |
| an earlier answer **does not equal** X | `op="EQ" value="X"` |
| an earlier answer **contains** X | `op="NCON" value="X"` |
| an earlier answer **does not contain** X | `op="CON" value="X"` |
| a number is **≥** X | `op="LT" value="X"` |
| a number is **≤** X | `op="GT" value="X"` |

**Combining clauses (De Morgan):** “show only if **A and B**” → skip with `method="OR"` and both
clauses inverted. “show only if **A or B**” → skip with `method="AND"` and both clauses inverted.

`value` for a choice question is the option's text (or a distinctive substring of it for `CON`/`NCON`).

## Rules

1. **IDs:** give every question a unique id shaped `00000000-0000-4000-8000-0000000000NN`, incrementing
   `NN` (01, 02, 03…). Any unique `8-4-4-4-12` hex string is valid. (Questions referenced by a
   condition MUST keep a stable id; others may reuse the same scheme.)
2. **Reference EARLIER questions only:** a `<condition ref>` must equal an earlier question's `id`
   (a smaller `sort`). Never reference the question itself or a later one.
3. **Max 3 conditions** per question, all joined by one `method` — you cannot mix AND and OR within a
   single question.
4. **Escape XML:** `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`; inside attribute values also `"` → `&quot;`.
5. Add `<choices>` only to `Multiple Choice` and `Multiple Choice (Multi-Answer)`.
6. Omit `<details>` and `<conditions>` when not used.
7. Output must be well-formed XML with a single `<form>` root — the app rejects malformed XML.

## Worked example

Plain English:
> Form “Pool Visit”. 1) Was the pool accessible? (Yes/No, required). 2) If NOT accessible, ask the
> reason (long text, required). 3) Only if accessible, ask litres of chlorine added (number, optional).

XML:

```xml
<form id="00000000-0000-4000-8000-000000000000" name="Pool Visit">
<question id="00000000-0000-4000-8000-000000000001" type="Multiple Choice" mandatory="true" sort="1"><name>Was the pool accessible?</name><choices><choice>Yes</choice><choice>No</choice></choices></question>
<question id="00000000-0000-4000-8000-000000000002" type="Text (Multi-Line)" mandatory="true" sort="2"><name>Reason the pool was not accessible</name><details>Describe why it could not be serviced.</details><conditions method="AND"><condition ref="00000000-0000-4000-8000-000000000001" op="EQ" value="Yes"/></conditions></question>
<question id="00000000-0000-4000-8000-000000000003" type="Number" mandatory="false" sort="3"><name>Chlorine added (litres)</name><conditions method="AND"><condition ref="00000000-0000-4000-8000-000000000001" op="EQ" value="No"/></conditions></question>
</form>
```

Why it works: Q2 is **skipped when** accessibility **equals “Yes”** (so it only appears on “No”);
Q3 is **skipped when** accessibility **equals “No”** (so it only appears on “Yes”).

### Advanced: two clauses

> “Show ‘pH decreaser qty’ only if the water test mentions pH **and** chemicals were supplied.”

“Show only if (A and B)” → skip with **OR** and both clauses inverted:

```xml
<conditions method="OR"><condition ref="…waterTestId…" op="NCON" value="pH"/><condition ref="…chemicalsSuppliedId…" op="EQ" value="No chemicals supplied"/></conditions>
```

---

## Now describe your form

List: a **form name**, then each question with its **type**, whether it's **required**, its **options**
(for choice questions), and any **“show only when…” / “skip when…”** logic. Then reply with the
complete XML only.
