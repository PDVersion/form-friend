// schema.js — SINGLE SOURCE OF TRUTH for the ServiceM8 form.json shape.
//
// If ServiceM8 ever renames a field, change it HERE only. Everything else
// (XML export/import, validation, merge, UI) goes through these helpers.
//
// Observed structure (from real .sm8f samples):
//   { "form": {...}, "fields": [ {field}, ... ] }
// Each `field` (one question) has outer keys uuid/name/sort_order/... and a
// DOUBLE-ENCODED `field_data_json` STRING holding the type, help text, choices
// and conditional logic.

export const KEYS = { form: "form", fields: "fields" };

// Outer (per-field) keys.
export const FIELD = {
  uuid: "uuid",
  name: "name",
  data: "field_data_json",
  sort: "sort_order",
  formUuid: "form_uuid",
  active: "active",
  createDate: "create_date",
  editDate: "edit_date",
};

// Inner (parsed field_data_json) keys.
export const DATA = {
  type: "fieldType",
  details: "additionalDetails",
  mandatory: "mandatory",
  choices: "choices",
  conditions: "conditions",
  method: "conditionMethod",
};

// Keys inside a single condition object.
export const COND = { ref: "question", op: "operator", value: "value" };

// ServiceM8 always stores exactly this many condition slots (empties padded).
export const COND_SLOTS = 3;

// Field types known to ServiceM8 (used for hints/warnings, not hard validation).
export const KNOWN_TYPES = [
  "Text",
  "Text (Multi-Line)",
  "Number",
  "Date",
  "Multiple Choice",
  "Multiple Choice (Multi-Answer)",
  "Signature",
  "Photo",
];

// Condition operators seen in the wild.
export const KNOWN_OPERATORS = ["CON", "NCON", "EQ", "NEQ"];

// Inner keys fully managed by the editor (everything else inside the blob is preserved as-is).
const MANAGED_DATA_KEYS = new Set([
  DATA.type,
  DATA.details,
  DATA.mandatory,
  DATA.choices,
  DATA.conditions,
  DATA.method,
]);

// Parse a raw field_data_json string defensively. Returns {} on failure.
export function parseFieldData(field) {
  const raw = field && field[FIELD.data];
  if (!raw || typeof raw !== "string") return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (_e) {
    return {};
  }
}

// Convert a raw field object into an editable "view-model" (vm) that the rest
// of the app works with. Empty condition slots are dropped here; they are
// re-padded by buildFieldData() on the way back out.
export function parseField(field) {
  const data = parseFieldData(field);
  const rawConditions = Array.isArray(data[DATA.conditions]) ? data[DATA.conditions] : [];
  const conditions = rawConditions
    .map((c) => ({
      ref: (c && c[COND.ref]) || "",
      op: (c && c[COND.op]) || "",
      value: (c && c[COND.value]) || "",
    }))
    .filter((c) => c.ref || c.op || c.value);

  return {
    uuid: (field[FIELD.uuid] || "").trim(),
    name: field[FIELD.name] || "",
    sort: field[FIELD.sort] != null ? String(field[FIELD.sort]) : "",
    type: data[DATA.type] || "",
    details: data[DATA.details] || "",
    mandatory: Boolean(data[DATA.mandatory]),
    choices: Array.isArray(data[DATA.choices]) ? data[DATA.choices].slice() : [],
    method: data[DATA.method] || "AND",
    conditions,
    // Internal references for the merge step (not part of the editable surface):
    _field: field, // original outer object
    _data: data, // original parsed inner blob
  };
}

// Build the inner field_data_json OBJECT from a view-model. `originalData` lets
// us preserve any unknown inner keys that ServiceM8 may add in future.
// Keys are emitted in ServiceM8's canonical order for tidy diffs.
export function buildFieldData(vm, originalData = {}) {
  const data = {};
  data[DATA.type] = vm.type || "";
  data[DATA.details] = vm.details != null ? vm.details : "";
  data[DATA.mandatory] = !!vm.mandatory;
  if (vm.choices && vm.choices.length) data[DATA.choices] = vm.choices.slice();

  const conds = (vm.conditions || []).map((c) => ({
    [COND.ref]: c.ref || "",
    [COND.op]: c.op || "",
    [COND.value]: c.value || "",
  }));
  while (conds.length < COND_SLOTS) {
    conds.push({ [COND.ref]: "", [COND.op]: "", [COND.value]: "" });
  }
  data[DATA.conditions] = conds;
  data[DATA.method] = vm.method || "AND";

  // Preserve unknown inner keys ServiceM8 may rely on.
  for (const k of Object.keys(originalData)) {
    if (!MANAGED_DATA_KEYS.has(k)) data[k] = originalData[k];
  }
  return data;
}

// Canonical signature of a vm's INNER content (excludes outer name/sort). Used
// to decide whether the field_data_json blob can be preserved byte-for-byte.
export function innerSignature(vm) {
  return JSON.stringify({
    type: vm.type || "",
    details: vm.details || "",
    mandatory: !!vm.mandatory,
    choices: vm.choices || [],
    method: vm.method || "AND",
    conditions: (vm.conditions || []).map((c) => ({
      ref: c.ref || "",
      op: c.op || "",
      value: c.value || "",
    })),
  });
}

// Sort a list of vms by numeric sort_order (stable, ascending).
export function sortByOrder(vms) {
  return vms
    .map((vm, i) => [vm, i])
    .sort((a, b) => {
      const sa = parseFloat(a[0].sort);
      const sb = parseFloat(b[0].sort);
      if (Number.isNaN(sa) && Number.isNaN(sb)) return a[1] - b[1];
      if (Number.isNaN(sa)) return 1;
      if (Number.isNaN(sb)) return -1;
      return sa - sb || a[1] - b[1];
    })
    .map((pair) => pair[0]);
}
