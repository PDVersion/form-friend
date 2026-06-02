// main.js — entry point. Wires the DOM to the workflow:
// ingest -> display -> export XML -> import XML -> validate -> repackage.
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

function refreshFromState() {
  const fields = (state.formObj && state.formObj[KEYS.fields]) || [];
  state.questions = sortByOrder(fields.map(parseField));
  const nameMap = idToNameMap(state.questions);
  const numberMap = idToNumberMap(state.questions);
  renderFormInfo($("form-info"), state.formObj[KEYS.form] || {}, state.questions.length);
  renderQuestions($("question-list"), state.questions, nameMap, numberMap, onRemoveCondition);
  updateTemplateBanner();
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
    $("xml-output").value = "";
    $("xml-input").value = "";
    $("download-section").classList.add("hidden");

    setStatus("ok", "Loaded", [
      `${state.questions.length} questions parsed.`,
      docxBlob ? "template.docx held in memory (unaltered)." : "No template.docx found in this file.",
    ]);
  } catch (e) {
    setStatus("error", "Could not read .sm8f", [e.message || String(e)]);
  }
}

function handleExport() {
  if (!state.formObj) {
    setStatus("error", "Nothing to export", ["Load a .sm8f file first."]);
    return;
  }
  const xml = buildFormXml(state.formObj[KEYS.form] || {}, state.questions);
  $("xml-output").value = xml;
  setStatus("info", "Exported for LLM", [
    `${state.questions.length} questions written as XML. Copy it, edit with your LLM, then paste it back below.`,
  ]);
}

async function handleCopy() {
  const text = $("xml-output").value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("ok", "Copied", ["XML copied to clipboard."]);
  } catch (_e) {
    $("xml-output").select();
    setStatus("warn", "Copy manually", ["Clipboard blocked; the XML is selected — press Ctrl/Cmd+C."]);
  }
}

async function handleImport() {
  if (!state.formObj) {
    setStatus("error", "Load a file first", ["Import requires an original .sm8f for repackaging."]);
    return;
  }
  const text = $("xml-input").value.trim();
  if (!text) {
    setStatus("error", "Nothing to import", ["Paste the edited XML into the box."]);
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
    refreshFromState();
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

// ---- XML-build pathway -------------------------------------------------------

function toggleXmlPanel() {
  const panel = $("xml-build-panel");
  const btn = $("xml-mode-btn");
  const hidden = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !hidden);
  btn.textContent = hidden
    ? "← Back to .sm8f upload"
    : "Have XML already? Build a .sm8f without a template →";
}

async function handleBuildFromXml() {
  const text = $("xml-build-input").value.trim();
  if (!text) {
    setStatus("error", "Nothing to build", ["Paste your form XML into the box."]);
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

  // Read optional docx upload.
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

  refreshFromState();

  $("workspace").classList.remove("hidden");
  $("xml-output").value = "";
  $("xml-input").value = "";
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
  $("import-btn").addEventListener("click", handleImport);
  $("xml-mode-btn").addEventListener("click", toggleXmlPanel);
  $("xml-build-btn").addEventListener("click", handleBuildFromXml);
}

document.addEventListener("DOMContentLoaded", init);
