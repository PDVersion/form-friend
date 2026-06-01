// sm8f.js — read and write the .sm8f ZIP container using JSZip (loaded globally
// via a <script> tag in index.html).

/* global JSZip */
import { serializeFormJson } from "./serialize.js";

// Unpack a .sm8f File/Blob. Returns the parsed form, the unaltered docx, and
// the original zip (kept so EVERY entry can be repackaged verbatim).
export async function extractSm8f(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip failed to load (check your network / CDN).");
  }
  const zip = await JSZip.loadAsync(file);

  const formEntry = zip.file("form.json");
  if (!formEntry) {
    throw new Error("This .sm8f does not contain a form.json entry.");
  }
  const formText = await formEntry.async("string");

  let formObj;
  try {
    formObj = JSON.parse(formText);
  } catch (e) {
    throw new Error("form.json is not valid JSON: " + e.message);
  }

  const docxEntry = zip.file("template.docx");
  const docxBlob = docxEntry ? await docxEntry.async("blob") : null;

  return { formObj, formText, docxBlob, zip };
}

// Repackage: copy every original entry verbatim, swap in the new form.json,
// and return a .sm8f Blob. The template.docx content is preserved exactly.
export async function buildSm8f(formObj, originalZip) {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip failed to load (check your network / CDN).");
  }
  const out = new JSZip();

  if (originalZip) {
    for (const name of Object.keys(originalZip.files)) {
      const entry = originalZip.files[name];
      if (entry.dir || name === "form.json") continue;
      out.file(name, await entry.async("uint8array"));
    }
  }

  out.file("form.json", serializeFormJson(formObj));

  return out.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/octet-stream",
  });
}
