// state.js — tiny in-memory store for the loaded form.
//
// The original .docx (and any other zip entries) live here untouched, ready
// for repackaging. We never mutate `zip`; we only read from it.

export const state = {
  fileName: "", // original .sm8f filename
  formObj: null, // parsed { form, fields, ... } (updated after a successful import)
  formText: "", // original form.json text (for reference/debugging)
  docxBlob: null, // template.docx held unaltered in memory
  zip: null, // original JSZip instance (source of all entries on repackage)
  questions: [], // view-models, sorted by sort_order (for display + export)
  rebuiltBlob: null, // most recently repackaged .sm8f blob
};

export function resetState() {
  state.fileName = "";
  state.formObj = null;
  state.formText = "";
  state.docxBlob = null;
  state.zip = null;
  state.questions = [];
  state.rebuiltBlob = null;
}
