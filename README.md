# Form Friend

A static, **client-side** web app to parse, mass-edit, and repackage ServiceM8
`.sm8f` form files — optimised for **LLM-assisted editing**. No backend; nothing
leaves your browser.

## Why

ServiceM8's form editor edits one question at a time. Form Friend lets you:

1. **Open** a `.sm8f` (a ZIP of `form.json` + `template.docx`) and see every question.
2. **Export** the questions to a strict, compact **XML** an LLM can safely mass-edit.
   XML is used on purpose: the browser's native `DOMParser` rejects malformed /
   unclosed structures, so we get cheap integrity checking on the LLM's output.
3. **Import** the edited XML, **validate** that every conditional-logic reference
   points at a real question UUID, auto-generate UUIDs for new questions, then
   **repackage** a valid `.sm8f` (with the original `template.docx` untouched) for
   re-import into ServiceM8.

**Or**, if you already have the XML (e.g. from a prior export): paste it directly via
"Have XML already?" and build an `.sm8f` from scratch — no original file needed.
Choose form template **None** to skip PDF generation (no `.docx` required), or upload
a `.docx` to embed a template.

## Run it locally

ES modules require HTTP (not `file://`), so serve the folder:

```bash
python3 -m http.server 8000    # or: npm run serve
# open http://localhost:8000
```

Drop `sample/DRAFT_Pool_Service_Form_2027_FY.sm8f` to try it.

## The workflow

1. Load a `.sm8f`.
2. **Generate XML** → copy it.
3. Ask your LLM to edit the XML (reword questions, adjust choices/conditions, add
   new `<question>` blocks). Keep `id`/`ref` UUIDs intact; **omit `id` on brand-new
   questions** and one is generated for you.
4. Paste the result back → **Validate & Repackage**. Fix any reported errors
   (malformed XML, duplicate UUIDs, conditions pointing at missing UUIDs).
5. **Download** the rebuilt `.sm8f`.

### XML format

```xml
<form id="<form-uuid>" name="<form name>">
<question id="<uuid>" type="Number" mandatory="false" sort="16"><name>pH Decreaser Qty</name><details>Amount in litres</details><conditions method="OR"><condition ref="<uuid>" op="NCON" value="pH"/></conditions></question>
</form>
```

- `type`: `Text`, `Text (Multi-Line)`, `Number`, `Date`, `Multiple Choice`,
  `Multiple Choice (Multi-Answer)`, `Signature`, `Photo`.
- `op`: `CON` (contains), `NCON` (not contains), `EQ` (equals), `NEQ` (not equals),
  `GT` (greater than), `LT` (less than).
- Conditions are **skip rules**: a question is hidden when the condition(s) are satisfied.
  Maximum 3 conditions per question, combined with the `method` (`AND`/`OR`).
- Choice questions add `<choices><choice>…</choice></choices>`.
- `<condition ref="…">` must reference an existing, *earlier* question's `id`.

## How the data is handled

`form.json` is `{ "form": {…}, "fields": [ … ] }`. Each field's type, help text,
choices and conditions live inside a **double-encoded** `field_data_json` string.

To protect data we don't surface in the XML, imports **merge onto the original**
in-memory object rather than rebuilding from scratch:

- existing questions keep all their original fields (audit timestamps, staff UUIDs, …);
- a question whose content is unchanged keeps its `field_data_json` **byte-for-byte**;
- new questions get a generated v4 UUID and a minimal wrapper;
- questions absent from the XML are dropped.

Output is written in ServiceM8's PHP `json_encode` style (`\/`, `\uXXXX`) with a
newline before each question object, for clean diffs and maximum re-import compatibility.

To adjust to a future ServiceM8 schema change, edit the field-name maps in
[`js/schema.js`](js/schema.js) — that's the single source of truth.

## Project layout

```
index.html              # bare-bones MVP UI (Tailwind + JSZip via CDN)
css/app.css             # minimal custom styles
js/
  main.js               # orchestration + DOM wiring
  sm8f.js               # JSZip extract / repackage
  schema.js             # field-name maps + field_data_json (de)serialize
  state.js              # in-memory store
  xml.js                # JSON -> XML  and  XML -> objects (DOMParser)
  validate.js           # UUID-reference integrity + structural checks
  merge.js              # merge edits onto original; UUID generation
  serialize.js          # form.json output (newline-per-field, PHP-style escaping)
  uuid.js               # v4 UUID
  ui.js                 # render question cards
sample/                 # example .sm8f + extracted form.json + broken.xml fixture
test/checks.mjs         # Node verification of the pure logic against the sample
.github/workflows/deploy-pages.yml
```

## Tests

```bash
npm test        # node test/checks.mjs
```

Covers parsing the real sample (55 questions), PHP-style byte fidelity, the
newline-per-field formatter, reference-integrity validation (pass and fail),
the merge round-trip (verbatim blob preservation), UUID generation,
the extended operator set (GT/LT), the 3-condition cap, `conditionIssues`
broken-condition detection (all cases), and the XML-build pathway
(`buildBlankFormMeta`, `buildBlankForm`, merge + serialization round-trip).
(DOM/zip paths are exercised manually in the browser — see steps above.)

## Deployment

GitHub Actions publishes the repo root to GitHub Pages on pushes to the default
branch (`.github/workflows/deploy-pages.yml`). Enable **Settings → Pages →
Source: GitHub Actions** once. Feature branches must be merged to the default
branch (or use the manual **Run workflow** button) to go live.

## Hardening (future)

- **JSZip** is loaded from CDN without an SRI hash (a wrong hash would break
  loading and one couldn't be computed in this environment). For production,
  vendor `jszip.min.js` into `js/vendor/` or add a verified `integrity` attribute.
- **Tailwind** uses the CDN play build; switch to a compiled stylesheet for production.
- `sample/` is published with the site; remove it if the form data shouldn't be public.
