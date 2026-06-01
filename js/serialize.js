// serialize.js — turn the in-memory form object back into form.json text.
//
// Two goals:
//   1. Match ServiceM8's PHP json_encode house style (escape "/" as "\/" and
//      all non-ASCII as \uXXXX) so untouched questions diff cleanly and the
//      file stays maximally compatible on re-import.
//   2. Put each question object on its own line (a newline before every element
//      of the `fields` array) for readable diffing/debugging, while remaining
//      strictly valid JSON.

import { KEYS } from "./schema.js";

// Apply PHP-style escaping on top of a standard JSON string. Done char-by-char
// so the source stays ASCII-only and the slash/non-ASCII rules can't collide.
export function phpEncode(jsonStr) {
  let out = "";
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    const code = jsonStr.charCodeAt(i);
    if (ch === "/") {
      out += "\\/";
    } else if (code > 0x7f) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      out += ch;
    }
  }
  return out;
}

// Compact, PHP-compatible JSON for a single value.
export function phpJsonStringify(value) {
  return phpEncode(JSON.stringify(value));
}

// Serialize the full { form, fields, ...extras } object.
// Top-level key order and any unexpected extra keys are preserved.
export function serializeFormJson(formObj) {
  const parts = Object.keys(formObj).map((key) => {
    const keyStr = phpJsonStringify(String(key));
    const val = formObj[key];
    if (key === KEYS.fields && Array.isArray(val)) {
      const body = val.map((field) => phpJsonStringify(field)).join(",\n");
      return keyStr + ":[\n" + body + "\n]";
    }
    return keyStr + ":" + phpJsonStringify(val);
  });
  return "{" + parts.join(",\n") + "}";
}
