// merge.js — reconstruct form.json by MERGING edited questions onto the
// original in-memory object (rather than rebuilding from the lossy XML).
//
// Why merge: the XML is a simplified view and does not carry every field that
// ServiceM8 stores (audit timestamps, staff UUIDs, unknown future keys). By
// starting from the original objects we never lose those, and we keep the
// field_data_json blob byte-for-byte identical whenever its content is
// unchanged.

import {
  FIELD,
  KEYS,
  parseField,
  buildFieldData,
  innerSignature,
} from "./schema.js";
import { generateUuid, isUuid } from "./uuid.js";

function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

// Assign a fresh v4 UUID to any imported question that lacks a valid one.
// Returns the same array (mutated) for convenience.
export function ensureUuids(questions) {
  for (const q of questions) {
    if (!isUuid(q.uuid)) q.uuid = generateUuid();
  }
  return questions;
}

// originalForm: parsed { form, fields, ... }. questions: imported view-models
// (already passed through ensureUuids + validateImport).
export function mergeForm(originalForm, questions) {
  const origFields = Array.isArray(originalForm[KEYS.fields])
    ? originalForm[KEYS.fields]
    : [];
  const byUuid = new Map();
  for (const f of origFields) byUuid.set((f[FIELD.uuid] || "").trim(), f);

  const formUuid =
    (originalForm[KEYS.form] && originalForm[KEYS.form][FIELD.uuid]) || "";

  let nextSort = 0;
  for (const f of origFields) {
    const s = parseFloat(f[FIELD.sort]);
    if (!Number.isNaN(s)) nextSort = Math.max(nextSort, s);
  }
  nextSort += 1;

  const stamp = nowStamp();

  const newFields = questions.map((q) => {
    const orig = byUuid.get((q.uuid || "").trim());

    if (orig) {
      // Existing question: preserve the original object, overlay edits.
      const origVm = parseField(orig);
      const merged = { ...orig };
      merged[FIELD.name] = q.name;
      if (q.sort !== "" && q.sort != null) merged[FIELD.sort] = String(q.sort);

      if (innerSignature(q) === innerSignature(origVm)) {
        // Inner content unchanged → keep the original blob string verbatim.
        merged[FIELD.data] = orig[FIELD.data];
      } else {
        merged[FIELD.data] = JSON.stringify(buildFieldData(q, origVm._data));
        merged[FIELD.editDate] = stamp;
      }
      return merged;
    }

    // Brand-new question: synthesize a minimal ServiceM8 wrapper.
    return {
      [FIELD.uuid]: q.uuid,
      [FIELD.formUuid]: formUuid,
      [FIELD.active]: "1",
      [FIELD.name]: q.name || "",
      [FIELD.data]: JSON.stringify(buildFieldData(q, {})),
      [FIELD.sort]:
        q.sort !== "" && q.sort != null ? String(q.sort) : String(nextSort++),
      [FIELD.createDate]: stamp,
      [FIELD.editDate]: stamp,
    };
  });

  return { ...originalForm, [KEYS.fields]: newFields };
}
