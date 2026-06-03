// main.js — entry point. Wires the DOM to the workflow:
// ingest -> display -> live XML editor (export + import unified) -> validate -> repackage.
// Second pathway: paste XML directly -> build .sm8f from scratch.

import { state, resetState } from "./state.js";
import { extractSm8f, buildSm8f } from "./sm8f.js";
import { parseField, sortByOrder, FIELD, KEYS } from "./schema.js";
import { buildFormXml, parseFormXml, XmlParseError } from "./xml.js";
import { ensureUuids, mergeForm, buildBlankForm } from "./merge.js";
import { validateImport } from "./validate.js";
import { renderQuestions, renderFormInfo } from "./ui.js";
import { generateUuid } from "./uuid.js";

const $ = (id) => document.getElementById(id);

let lastDownloadUrl = null;

const STATUS_STYLES = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800",
  info: "border-sky-300 bg-sky-50 text-sky-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  error: "border-rose-300 bg-rose-50 text-rose-800",
};

function setStatus(kind, title, lines = []) {
  const node = $("status");
  node.className =
    "rounded-lg border p-3 text-sm " + (STATUS_STYLES[kind] || STATUS_STYLES.info);
  node.innerHTML = "";
  const h = document.createElement("div");
  h.className = "font-semibold";
  h.textContent = title;
  node.appendChild(h);
  for (const line of lines) {
    const d = document.createElement("div");
    d.className = "mt-0.5";
    d.textContent = line;
    node.appendChild(d);
  }
  node.classList.remove("hidden");
}

function idToNameMap(vms) {
  const m = new Map();
  for (const vm of vms) m.set(vm.uuid, vm.name);
  return m;
}

function idToNumberMap(vms) {
  const m = new Map();
  vms.forEach((vm, i) => m.set(vm.uuid, i + 1));
  return m;
}

function updateTemplateBanner() {
  const banner = $("template-banner");
  if (state.mode !== "xml") {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  if (state.docxBlob) {
    banner.className =
      "mb-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800";
    banner.textContent =
      "Template: template.docx embedded — SM8 will generate a PDF for this form.";
  } else {
    banner.className =
      "mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800";
    banner.textContent =
      "No PDF template (None) — SM8 will not generate a PDF for this form.";
  }
}

// Regenerate the XML editor box from current state (left → right sync).
function syncXmlFromState() {
  if (!state.formObj) return;
  $("xml-editor").value = buildFormXml(state.formObj[KEYS.form] || {}, state.questions);
}

// Flip the right panel between the empty-state build controls and the
// loaded-state action buttons.
function updateRightPanel() {
  const loaded = !!state.formObj;
  $("xml-build-controls").classList.toggle("hidden", loaded);
  $("xml-loaded-controls").classList.toggle("hidden", !loaded);
  $("xml-panel-title").className =
    "text-lg font-semibold " + (loaded ? "text-slate-800" : "text-slate-400");
  $("xml-panel-title").textContent = loaded ? "XML (live editor)" : "XML editor";
  if (!loaded) {
    $("xml-editor").placeholder = "Paste your form XML here…";
  } else {
    $("xml-editor").placeholder = "XML generates automatically on load…";
  }
}

function refreshFromState() {
  const fields = (state.formObj && state.formObj[KEYS.fields]) || [];
  state.questions = sortByOrder(fields.map(parseField));
  const nameMap = idToNameMap(state.questions);
  const numberMap = idToNumberMap(state.questions);
  const formMeta = (state.formObj && state.formObj[KEYS.form]) || {};
  $("form-name-input").value = formMeta.name || "";
  $("form-badge-input").value = formMeta.badge_name || "";
  renderFormInfo($("form-info"), formMeta, state.questions.length);
  renderQuestions($("question-list"), state.questions, nameMap, numberMap, onRemoveCondition);
  updateTemplateBanner();
  syncXmlFromState();   // auto-update right panel on every left-side change
  updateRightPanel();
}

function deriveOutputName(name) {
  const base = (name || "form.sm8f").replace(/\.sm8f$/i, "");
  return `${base}-edited.sm8f`;
}

// Shared: build the zip from current state.formObj, update the download link.
async function rebuildDownload() {
  const extraFiles =
    state.mode === "xml" && state.docxBlob
      ? { "template.docx": state.docxBlob }
      : {};
  const blob = await buildSm8f(state.formObj, state.zip, extraFiles);
  state.rebuiltBlob = blob;
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = URL.createObjectURL(blob);
  const link = $("download-link");
  link.href = lastDownloadUrl;
  link.download = deriveOutputName(state.fileName);
  $("download-section").classList.remove("hidden");
}

// Called when the user clicks Remove on a broken condition in the question list.
async function onRemoveCondition(vm, condIndex) {
  vm.conditions.splice(condIndex, 1);
  state.formObj = mergeForm(state.formObj, state.questions);
  refreshFromState();
  try {
    await rebuildDownload();
  } catch (e) {
    setStatus("warn", "Condition removed but repackage failed", [e.message || String(e)]);
  }
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.sm8f$/i.test(file.name)) {
    setStatus("error", "Unsupported file", ["Please choose a .sm8f file."]);
    return;
  }
  try {
    setStatus("info", "Reading file…", [file.name]);
    const { formObj, formText, docxBlob, zip } = await extractSm8f(file);
    resetState();
    state.fileName = file.name;
    state.formObj = formObj;
    state.formText = formText;
    state.docxBlob = docxBlob;
    state.zip = zip;
    state.mode = "sm8f";
    refreshFromState();

    $("workspace").classList.remove("hidden");
    $("download-section").classList.add("hidden");

    setStatus("ok", "Loaded", [
      `${state.questions.length} questions parsed.`,
      docxBlob ? "template.docx held in memory (unaltered)." : "No template.docx found in this file.",
      "XML generated automatically in the editor →",
    ]);
  } catch (e) {
    setStatus("error", "Could not read .sm8f", [e.message || String(e)]);
  }
}

// "Regenerate XML" — manual refresh of the editor from current state.
function handleExport() {
  if (!state.formObj) {
    setStatus("error", "Nothing to export", ["Load a .sm8f file first."]);
    return;
  }
  syncXmlFromState();
  setStatus("info", "XML regenerated", [
    `${state.questions.length} questions. Copy it, edit with your LLM, then click Validate & Repackage.`,
  ]);
}

async function handleCopy() {
  const text = $("xml-editor").value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("ok", "Copied", ["XML copied to clipboard."]);
  } catch (_e) {
    $("xml-editor").select();
    setStatus("warn", "Copy manually", ["Clipboard blocked; the XML is selected — press Ctrl/Cmd+C."]);
  }
}

// "Validate" — check XML formatting and conversion issues without touching state.
function handleValidate() {
  const text = $("xml-editor").value.trim();
  if (!text) {
    setStatus("warn", "Nothing to validate", ["The XML editor is empty."]);
    return;
  }
  let parsed;
  try {
    parsed = parseFormXml(text);
  } catch (e) {
    const detail = e instanceof XmlParseError ? e.message : String(e);
    setStatus("error", "XML formatting error", [detail]);
    return;
  }
  const result = validateImport(parsed);
  if (result.ok && result.warnings.length === 0) {
    setStatus("ok", `XML looks good — ${parsed.questions.length} question${parsed.questions.length === 1 ? "" : "s"}`, [
      "No errors or warnings. Ready to Validate & Repackage.",
    ]);
  } else if (result.ok) {
    setStatus("warn", `Valid with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`, result.warnings);
  } else {
    setStatus("error", `Validation failed (${result.errors.length} issue${result.errors.length === 1 ? "" : "s"})`, [
      ...result.errors,
      ...result.warnings.map((w) => "warning: " + w),
    ]);
  }
}

// "Validate & Repackage" — apply the XML to the form (right → left) then rebuild.
async function handleImport() {
  if (!state.formObj) {
    setStatus("error", "Load a file first", ["Import requires an original .sm8f for repackaging."]);
    return;
  }
  const text = $("xml-editor").value.trim();
  if (!text) {
    setStatus("error", "Nothing to import", ["The XML editor is empty."]);
    return;
  }

  let parsed;
  try {
    parsed = parseFormXml(text);
  } catch (e) {
    const detail = e instanceof XmlParseError ? e.message : String(e);
    setStatus("error", "Malformed XML", [detail]);
    return;
  }

  const existingIds = new Set(
    ((state.formObj[KEYS.fields]) || []).map((f) => (f[FIELD.uuid] || "").trim())
  );
  const newBefore = parsed.questions.filter((q) => !existingIds.has((q.uuid || "").trim()) && !q.uuid).length;

  ensureUuids(parsed.questions);
  const result = validateImport(parsed);

  if (!result.ok) {
    setStatus("error", `Validation failed (${result.errors.length} issue${result.errors.length === 1 ? "" : "s"})`, [
      ...result.errors,
      ...result.warnings.map((w) => "warning: " + w),
    ]);
    $("download-section").classList.add("hidden");
    return;
  }

  try {
    state.formObj = mergeForm(state.formObj, parsed.questions);
    refreshFromState();  // re-renders left + syncs canonical XML back to editor
    await rebuildDownload();

    setStatus("ok", "Validated & repackaged", [
      `${parsed.questions.length} questions (${newBefore} new). Conditional references all resolve.`,
      ...result.warnings.map((w) => "warning: " + w),
      "Download the rebuilt .sm8f below.",
    ]);
  } catch (e) {
    setStatus("error", "Repackaging failed", [e.message || String(e)]);
  }
}

// "Build .sm8f from XML" — empty-state pathway (no .sm8f loaded).
async function handleBuildFromXml() {
  const text = $("xml-editor").value.trim();
  if (!text) {
    setStatus("error", "Nothing to build", ["Paste your form XML into the editor."]);
    return;
  }

  let parsed;
  try {
    parsed = parseFormXml(text);
  } catch (e) {
    const detail = e instanceof XmlParseError ? e.message : String(e);
    setStatus("error", "Malformed XML", [detail]);
    return;
  }

  ensureUuids(parsed.questions);
  const result = validateImport(parsed);

  if (!result.ok) {
    setStatus("error", `Validation failed (${result.errors.length} issue${result.errors.length === 1 ? "" : "s"})`, [
      ...result.errors,
      ...result.warnings.map((w) => "warning: " + w),
    ]);
    return;
  }

  const docxInput = $("xml-docx-input");
  const docxFile = docxInput && docxInput.files && docxInput.files[0];
  const docxBlob = docxFile || null;
  const documentTemplateUuid = docxBlob ? generateUuid() : "";

  const formName = (parsed.form && parsed.form.name) || "New Form";
  const blankForm = buildBlankForm({ name: formName, documentTemplateUuid });

  resetState();
  state.mode = "xml";
  state.fileName = formName.replace(/[^a-z0-9_\-. ]/gi, "_") + ".sm8f";
  state.docxBlob = docxBlob;
  state.zip = null;
  state.formObj = mergeForm(blankForm, parsed.questions);

  refreshFromState();  // renders left, syncs canonical XML, flips right panel

  $("workspace").classList.remove("hidden");
  $("download-section").classList.add("hidden");

  try {
    await rebuildDownload();
    setStatus("ok", "Built from XML", [
      `${parsed.questions.length} questions.`,
      docxBlob
        ? `template.docx embedded (${docxFile.name}).`
        : "Form template: None — SM8 will not generate a PDF.",
      ...result.warnings.map((w) => "warning: " + w),
      "Download the .sm8f below.",
    ]);
  } catch (e) {
    setStatus("error", "Build failed", [e.message || String(e)]);
  }
}

// ---- Top toolbar: home + copy-guide buttons ---------------------------------

// Copy arbitrary text to the clipboard with a status message.
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("ok", "Copied", [`${label} copied to clipboard.`]);
  } catch (_e) {
    setStatus("warn", "Copy blocked", [
      `Could not access the clipboard. ${label} is open in a new tab — copy it manually.`,
    ]);
    const blob = new Blob([text], { type: "text/plain" });
    window.open(URL.createObjectURL(blob), "_blank");
  }
}

// Fetch a guide markdown file shipped alongside the app, then copy it.
async function copyGuide(path, label) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await copyText(text, label);
  } catch (e) {
    setStatus("error", "Could not load guide", [
      `${path} could not be read (${e.message || e}).`,
      "Serve the app over http (e.g. npm run serve) so the guide files are reachable.",
    ]);
  }
}

// "Start again" — wipe state and return the UI to a blank slate.
function handleHome() {
  resetState();
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }
  $("workspace").classList.add("hidden");
  $("download-section").classList.add("hidden");
  $("status").classList.add("hidden");
  $("xml-editor").value = "";
  $("form-name-input").value = "";
  $("form-badge-input").value = "";
  $("file-input").value = "";
  $("xml-docx-input").value = "";
  updateRightPanel();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- DOM wiring --------------------------------------------------------------

function wireDropzone() {
  const dz = $("dropzone");
  const input = $("file-input");

  dz.addEventListener("click", () => input.click());
  input.addEventListener("change", () => handleFile(input.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("ring-2", "ring-sky-400", "bg-sky-50");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("ring-2", "ring-sky-400", "bg-sky-50");
    })
  );
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
}

function init() {
  wireDropzone();
  $("export-btn").addEventListener("click", handleExport);
  $("copy-btn").addEventListener("click", handleCopy);
  $("validate-btn").addEventListener("click", handleValidate);
  $("import-btn").addEventListener("click", handleImport);
  $("build-btn").addEventListener("click", handleBuildFromXml);
  $("home-btn").addEventListener("click", handleHome);
  $("copy-create-guide-btn").addEventListener("click", () =>
    copyGuide("XML_GUIDE.md", "Form creation guide")
  );
  $("copy-quick-create-guide-btn").addEventListener("click", () =>
    copyGuide("XML_CREATE_GUIDE.md", "Quick XML create guide")
  );
  $("copy-edit-guide-btn").addEventListener("click", () =>
    copyGuide("XML_EDIT_GUIDE.md", "XML edit guide")
  );

  $("form-name-input").addEventListener("input", async () => {
    if (!state.formObj || !state.formObj[KEYS.form]) return;
    state.formObj[KEYS.form].name = $("form-name-input").value;
    syncXmlFromState();
    try { await rebuildDownload(); } catch (_e) {}
  });

  $("form-badge-input").addEventListener("input", async () => {
    if (!state.formObj || !state.formObj[KEYS.form]) return;
    state.formObj[KEYS.form].badge_name = $("form-badge-input").value;
    syncXmlFromState();
    try { await rebuildDownload(); } catch (_e) {}
  });

  // Initialise right panel to empty state on load.
  updateRightPanel();
}

document.addEventListener("DOMContentLoaded", init);
