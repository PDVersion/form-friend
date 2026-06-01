// checks.mjs — Node verification of the pure (non-DOM, non-zip) logic against
// the real sample form. Run: `node test/checks.mjs` (or `npm test`).
//
// DOMParser (XML import) and JSZip (zip I/O) are browser-only and are verified
// manually in the browser; here we cross-check XML well-formedness with python3.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  KEYS,
  FIELD,
  DATA,
  parseField,
  buildFieldData,
  innerSignature,
  sortByOrder,
} from "../js/schema.js";
import { phpJsonStringify, serializeFormJson } from "../js/serialize.js";
import { buildFormXml } from "../js/xml.js";
import { validateImport } from "../js/validate.js";
import { ensureUuids, mergeForm } from "../js/merge.js";
import { generateUuid, isUuid } from "../js/uuid.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let passed = 0;
let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.log("  ✗ " + name + (detail ? "  — " + detail : ""));
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

const raw = readFileSync(join(root, "sample/form.json"), "utf8");
const formObj = JSON.parse(raw);
const fields = formObj[KEYS.fields];

console.log("\n[1] Parsing the sample");
ok("top level has form + fields", !!formObj[KEYS.form] && Array.isArray(fields));
ok("55 questions", fields.length === 55, `got ${fields.length}`);

const vms = fields.map(parseField);
const typeCounts = {};
for (const vm of vms) typeCounts[vm.type] = (typeCounts[vm.type] || 0) + 1;
ok("type distribution matches sample", deepEqual(typeCounts, {
  "Photo": 3,
  "Number": 18,
  "Multiple Choice": 13,
  "Multiple Choice (Multi-Answer)": 16,
  "Text (Multi-Line)": 5,
}), JSON.stringify(typeCounts));

console.log("\n[2] PHP-style encoding is byte-faithful to ServiceM8");
let fieldBytesOk = true;
for (const f of fields) {
  if (!raw.includes(phpJsonStringify(f))) { fieldBytesOk = false; break; }
}
ok("every field re-encodes to an exact substring of the original", fieldBytesOk);
ok("form object re-encodes to an exact substring", raw.includes(phpJsonStringify(formObj[KEYS.form])));

console.log("\n[3] form.json output formatting");
const out = serializeFormJson(formObj);
ok("output is valid JSON", (() => { try { JSON.parse(out); return true; } catch { return false; } })());
ok("output round-trips deep-equal to the original object", deepEqual(JSON.parse(out), formObj));
const fieldLines = out.split("\n").filter((l) => l.startsWith('{"uuid"'));
ok("each question object sits on its own line", fieldLines.length === 55, `got ${fieldLines.length}`);

console.log("\n[4] XML export + well-formedness (python cross-check)");
const xml = buildFormXml(formObj[KEYS.form], sortByOrder(vms));
const questionTagCount = (xml.match(/<question /g) || []).length;
ok("exports 55 <question> elements", questionTagCount === 55, `got ${questionTagCount}`);
const expectedConds = vms.reduce((n, vm) => n + vm.conditions.length, 0);
const xmlPath = join(tmpdir(), "form-friend-export.xml");
writeFileSync(xmlPath, xml);
try {
  const py =
    "import sys,xml.dom.minidom as m;" +
    `d=m.parse(${JSON.stringify(xmlPath)});` +
    "print(len(d.getElementsByTagName('question')),len(d.getElementsByTagName('condition')))";
  const res = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split(/\s+/);
  ok("python parses the XML (well-formed)", true);
  ok("python sees 55 <question>", Number(res[0]) === 55, `got ${res[0]}`);
  ok("python <condition> count matches JS", Number(res[1]) === expectedConds, `py=${res[1]} js=${expectedConds}`);
} catch (e) {
  ok("python parses the XML (well-formed)", false, String(e.message || e).split("\n")[0]);
}
// The negative fixture must still be well-formed XML (so DOMParser would accept it;
// it should fail only on reference validation).
try {
  execFileSync("python3", ["-c", `import xml.dom.minidom as m; m.parse(${JSON.stringify(join(root, "sample/broken.xml"))})`]);
  ok("sample/broken.xml is well-formed XML", true);
} catch (e) {
  ok("sample/broken.xml is well-formed XML", false, String(e.message || e).split("\n")[0]);
}

console.log("\n[5] Validation — the sample passes (0 dangling refs)");
const sampleValidation = validateImport({ questions: vms });
ok("sample validates ok", sampleValidation.ok, sampleValidation.errors.join("; "));

console.log("\n[6] Validation — a bad reference fails");
const badRef = "deadbeef-0000-4000-8000-000000000000";
const badResult = validateImport({
  questions: [
    { uuid: vms[0].uuid, type: "Number", name: "Bad", choices: [], method: "OR",
      conditions: [{ ref: badRef, op: "CON", value: "x" }] },
  ],
});
ok("validation reports not-ok", badResult.ok === false);
ok("error names the missing UUID", badResult.errors.some((e) => e.includes(badRef)), badResult.errors.join("; "));

console.log("\n[7] Merge round-trip preserves untouched questions verbatim");
const merged = mergeForm(formObj, vms.map((v) => ({ ...v }))); // unchanged import
ok("merged keeps 55 fields", merged[KEYS.fields].length === 55, `got ${merged[KEYS.fields].length}`);
const origByUuid = new Map(fields.map((f) => [f[FIELD.uuid], f]));
let verbatim = true;
for (const mf of merged[KEYS.fields]) {
  const of = origByUuid.get(mf[FIELD.uuid]);
  if (!of || mf[FIELD.data] !== of[FIELD.data]) { verbatim = false; break; }
}
ok("field_data_json preserved byte-for-byte for all questions", verbatim);
let sameObjects = merged[KEYS.fields].length === fields.length;
for (const mf of merged[KEYS.fields]) {
  if (!deepEqual(mf, origByUuid.get(mf[FIELD.uuid]))) { sameObjects = false; break; }
}
ok("every merged field deep-equals its original", sameObjects);

console.log("\n[8] UUID generation for new questions");
ok("generateUuid produces a valid v4 UUID", isUuid(generateUuid()));
const newQ = [{ uuid: "", type: "Text", name: "Brand new", details: "", choices: [], conditions: [], method: "AND", sort: "" }];
ensureUuids(newQ);
ok("ensureUuids fills a missing id", isUuid(newQ[0].uuid), newQ[0].uuid);
const mergedNew = mergeForm(formObj, newQ);
const createdData = JSON.parse(mergedNew[KEYS.fields][0][FIELD.data]);
ok("new question has a synthesized field_data_json", createdData[DATA.type] === "Text");
ok("new question's blob pads conditions to 3 slots", Array.isArray(createdData[DATA.conditions]) && createdData[DATA.conditions].length === 3);

console.log("\n[9] innerSignature changes when content is edited");
const editedVm = { ...vms.find((v) => v.type === "Number"), details: "EDITED help text" };
ok("edited inner content changes signature", innerSignature(editedVm) !== innerSignature(vms.find((v) => v.type === "Number")));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
