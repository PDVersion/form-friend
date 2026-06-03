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
  KNOWN_OPERATORS,
  COND_SLOTS,
  parseField,
  buildFieldData,
  innerSignature,
  sortByOrder,
  conditionIssues,
  buildBlankFormMeta,
} from "../js/schema.js";
import { phpJsonStringify, serializeFormJson } from "../js/serialize.js";
import { buildFormXml } from "../js/xml.js";
import { validateImport } from "../js/validate.js";
import { ensureUuids, mergeForm, buildBlankForm } from "../js/merge.js";
import { generateUuid, isUuid } from "../js/uuid.js";
import {
  BADGE_NAME_MAX,
  badgeNameTooLong,
  badgeNameEmpty,
  deriveBadgeName,
  badgeNameIssue,
} from "../js/badge.js";

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

console.log("\n[10] KNOWN_OPERATORS includes GT and LT");
ok("GT in KNOWN_OPERATORS", KNOWN_OPERATORS.includes("GT"));
ok("LT in KNOWN_OPERATORS", KNOWN_OPERATORS.includes("LT"));
ok("all six operators present", KNOWN_OPERATORS.length >= 6,
  `got ${KNOWN_OPERATORS.length}: ${KNOWN_OPERATORS.join(",")}`);
const sampleValidation2 = validateImport({ questions: vms });
ok("sample still validates ok with extended operator list", sampleValidation2.ok, sampleValidation2.errors.join("; "));

console.log("\n[11] buildFieldData caps conditions at COND_SLOTS");
const overflowVm = { ...vms[0], conditions: [
  { ref: vms[0].uuid, op: "EQ", value: "a" },
  { ref: vms[0].uuid, op: "EQ", value: "b" },
  { ref: vms[0].uuid, op: "EQ", value: "c" },
  { ref: vms[0].uuid, op: "EQ", value: "d" },
] };
const cappedData = buildFieldData(overflowVm, {});
ok("4-condition vm is capped to 3 slots", cappedData[DATA.conditions].length === COND_SLOTS,
  `got ${cappedData[DATA.conditions].length}`);
ok("capped slots are still padded to COND_SLOTS", cappedData[DATA.conditions].length === 3);
ok("method preserved through cap", cappedData[DATA.method] === overflowVm.method);

console.log("\n[12] conditionIssues detects broken conditions");
const allUuids = new Set(vms.map(v => v.uuid));
const numMap = new Map(vms.map((v, i) => [v.uuid, i + 1]));
const ctx = { position: 10, knownOperators: KNOWN_OPERATORS, idSet: allUuids, idToNumber: numMap };

const validCond = { ref: vms[0].uuid, op: "EQ", value: "yes" };
ok("valid condition has no issues", conditionIssues(validCond, ctx).length === 0,
  conditionIssues(validCond, ctx).join("; "));

const noRef = { ref: "", op: "CON", value: "x" };
ok("no-ref condition flagged", conditionIssues(noRef, ctx).some(s => s.includes("no question")));

const noOp = { ref: vms[0].uuid, op: "", value: "x" };
ok("no-op condition flagged", conditionIssues(noOp, ctx).some(s => s.includes("no operator")));

const deadRef = { ref: "deadbeef-0000-4000-8000-000000000000", op: "EQ", value: "x" };
ok("dangling ref flagged", conditionIssues(deadRef, ctx).some(s => s.includes("missing question")));

const emptyVal = { ref: vms[0].uuid, op: "EQ", value: "" };
ok("empty value flagged", conditionIssues(emptyVal, ctx).some(s => s.includes("empty value")));

const unknownOp = { ref: vms[0].uuid, op: "WEIRD", value: "x" };
ok("unknown operator flagged", conditionIssues(unknownOp, ctx).some(s => s.includes("unknown operator")));

// Forward reference: vms[0] is question 1; position=1 → same question
const selfRef = { ref: vms[0].uuid, op: "EQ", value: "x" };
const ctxSelf = { ...ctx, position: 1 };
ok("self-reference flagged", conditionIssues(selfRef, ctxSelf).some(s => s.includes("later or the same")));

// Forward reference: vms[9] is question 10; position=5 → forward
const forwardRef = { ref: vms[9].uuid, op: "EQ", value: "x" };
const ctxFwd = { ...ctx, position: 5 };
ok("forward reference flagged", conditionIssues(forwardRef, ctxFwd).some(s => s.includes("later or the same")));

console.log("\n[13] buildBlankFormMeta and buildBlankForm");
const stamp = "2026-06-01 12:00:00";
const meta = buildBlankFormMeta({ uuid: "test-uuid", name: "My Form", documentTemplateUuid: "", stamp });
ok("buildBlankFormMeta has uuid", meta.uuid === "test-uuid");
ok("buildBlankFormMeta has name", meta.name === "My Form");
ok("buildBlankFormMeta document_template_uuid defaults to empty", meta.document_template_uuid === "");
ok("buildBlankFormMeta has expected keys", [
  "uuid", "create_login", "create_by_staff_uuid", "edit_by_staff_uuid",
  "create_date", "edit_login", "edit_date", "active", "vendor_uuid",
  "document_template_uuid", "name", "badge_name", "is_sample_form", "sample_form_id",
  "can_be_used_independently", "badge_mandatory_state", "prevent_form_from_export",
  "store_item_uuid", "network_origin_form_uuid", "network_origin_form_etag",
  "template_fields_json", "is_locked"
].every(k => Object.prototype.hasOwnProperty.call(meta, k)));

const blank = buildBlankForm({ name: "Test Form", documentTemplateUuid: "" });
ok("buildBlankForm has form key", !!blank[KEYS.form]);
ok("buildBlankForm has empty fields", Array.isArray(blank[KEYS.fields]) && blank[KEYS.fields].length === 0);
ok("buildBlankForm form has a UUID", isUuid(blank[KEYS.form].uuid));
ok("buildBlankForm form template is empty for None", blank[KEYS.form].document_template_uuid === "");

// Merge parsed questions into a blank form and verify serialization
const simpleQ = [{
  uuid: generateUuid(),
  type: "Text",
  name: "Your name",
  details: "",
  mandatory: false,
  choices: [],
  conditions: [],
  method: "AND",
  sort: "1",
}];
const builtForm = mergeForm(blank, simpleQ);
const serialized = serializeFormJson(builtForm);
ok("built form serializes to valid JSON", (() => { try { JSON.parse(serialized); return true; } catch { return false; } })());
const roundTripped = JSON.parse(serialized);
ok("built form has 1 field after merge", roundTripped[KEYS.fields].length === 1,
  `got ${roundTripped[KEYS.fields].length}`);
ok("built form.document_template_uuid survives serialization",
  roundTripped[KEYS.form].document_template_uuid === "");

console.log("\n[14] Badge name length rule (ServiceM8 requires < 12 chars)");
ok("limit is 11 (must be under 12)", BADGE_NAME_MAX === 11, `got ${BADGE_NAME_MAX}`);
ok("11 chars is allowed", !badgeNameTooLong("12345678901"));
ok("12 chars is flagged too long", badgeNameTooLong("123456789012"));
ok("empty is fine", !badgeNameTooLong(""));
ok("null is fine", !badgeNameTooLong(null));
ok("derive truncates long form name to 11", deriveBadgeName("Pool Service Visit") === "Pool Servic",
  `got "${deriveBadgeName("Pool Service Visit")}"`);
ok("derive trims whitespace", deriveBadgeName("  Hi  ") === "Hi", `got "${deriveBadgeName("  Hi  ")}"`);
ok("derived names are never too long", !badgeNameTooLong(deriveBadgeName("A very long form name indeed")));
ok("derive of empty is empty", deriveBadgeName("") === "");
ok("short name passes through unchanged", deriveBadgeName("Audit") === "Audit");
ok("empty badge detected", badgeNameEmpty(""));
ok("whitespace-only badge detected as empty", badgeNameEmpty("   "));
ok("non-empty badge not flagged empty", !badgeNameEmpty("Audit"));
ok("issue: empty badge returns a message", typeof badgeNameIssue("") === "string");
ok("issue: too-long badge returns a message", typeof badgeNameIssue("123456789012") === "string");
ok("issue: valid badge returns null", badgeNameIssue("Audit") === null);
ok("issue: 11-char badge returns null", badgeNameIssue("12345678901") === null);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
