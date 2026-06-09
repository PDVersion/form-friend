// logicmap.js — "Logic Map & Checker" overlay for form-friend.
//
// Opens a full-screen overlay (same pattern as guide.js) with two sections:
//   1. Checker: plain-English linter results grouped by severity.
//   2. Map: adjacency text view (always works) + optional Mermaid diagram.
//
// The overlay reads live from state.questions on every open.
// Self-contained; call initLogicMap() once after the DOM is ready.

import { state } from "./state.js";
import { lintForm, SEV } from "./lint.js";
import { buildFlowGraph, affectsOf, affectedByOf, toMermaid } from "./flow.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ── Open / close ─────────────────────────────────────────────────────────────

let overlayEl = null;

function openOverlay() {
  if (overlayEl) overlayEl.remove();
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
  document.body.classList.add("ff-lm-open");
  overlayEl.querySelector(".ff-lm-panel").focus();
}

function closeOverlay() {
  closeDiagramFullscreen();
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  document.body.classList.remove("ff-lm-open");
}

// ── Render helpers ────────────────────────────────────────────────────────────

const SEV_ICON  = { error: "✕", warning: "⚠", info: "ℹ" };
const SEV_CLASS = { error: "ff-lm-sev-error", warning: "ff-lm-sev-warn", info: "ff-lm-sev-info" };
const SEV_ORDER = { error: 0, warning: 1, info: 2 };

function buildChecker(questions) {
  const wrap = el("div", "ff-lm-section");
  const h = el("h2", "ff-lm-section-title", "Logic checker");
  wrap.appendChild(h);

  const issues = lintForm(questions);

  if (issues.length === 0) {
    const ok = el("div", "ff-lm-ok");
    ok.textContent = "✓ No logic issues found.";
    wrap.appendChild(ok);
    return wrap;
  }

  // Group by severity order
  const sorted = [...issues].sort((a, b) =>
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
  );

  for (const issue of sorted) {
    const row = el("div", `ff-lm-issue ${SEV_CLASS[issue.severity] || ""}`);

    const tag = el("span", "ff-lm-issue-tag", SEV_ICON[issue.severity] || "?");
    row.appendChild(tag);

    const body = el("div", "ff-lm-issue-body");
    const header = el("div", "ff-lm-issue-header");
    header.textContent = `Q${issue.position}. ${
      questions[issue.position - 1]?.name || "(untitled)"
    }`;
    body.appendChild(header);
    const msg = el("div", "ff-lm-issue-msg", issue.message);
    body.appendChild(msg);
    row.appendChild(body);

    wrap.appendChild(row);
  }

  return wrap;
}

function buildTextMap(questions, graph) {
  const wrap = el("div", "ff-lm-section");
  const h = el("h2", "ff-lm-section-title", "Dependency map");

  // Focus selector
  const toolbar = el("div", "ff-lm-map-toolbar");
  const label = el("label", "ff-lm-map-label", "Focus on question: ");
  const sel = el("select", "ff-lm-map-select");

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "— All questions —";
  sel.appendChild(allOpt);

  for (const node of graph.nodes) {
    const opt = document.createElement("option");
    opt.value = node.id;
    opt.textContent = `Q${node.num}. ${node.label}`;
    sel.appendChild(opt);
  }

  label.appendChild(sel);
  toolbar.appendChild(label);

  const textPane = el("div", "ff-lm-map-text");

  function renderTextMap(focusId) {
    textPane.innerHTML = "";

    const nodesToShow = focusId
      ? graph.nodes.filter((n) => {
          if (n.id === focusId) return true;
          if (affectsOf(graph, n.id).some((a) => {
            const target = graph.nodes.find((x) => x.num === a.num);
            return target && target.id === focusId;
          })) return true;
          if (affectedByOf(graph, n.id).some((a) => {
            const src = graph.nodes.find((x) => x.num === a.num);
            return src && src.id === focusId;
          })) return true;
          return false;
        })
      : graph.nodes;

    // Filter to show only questions that affect or are affected by the focus
    const focusNode = focusId ? graph.nodes.find((n) => n.id === focusId) : null;

    if (focusNode) {
      // Affected-by: what hides this question
      const by = affectedByOf(graph, focusId);
      const affects = affectsOf(graph, focusId);

      if (by.length === 0 && affects.length === 0) {
        const none = el("div", "ff-lm-map-empty",
          `Q${focusNode.num}. "${focusNode.label}" has no conditional dependencies.`);
        textPane.appendChild(none);
        return;
      }

      if (by.length > 0) {
        const section = el("div", "ff-lm-map-group");
        section.appendChild(el("div", "ff-lm-map-group-title",
          `What can hide Q${focusNode.num}. "${focusNode.label}":`));
        for (const dep of by) {
          const row = el("div", "ff-lm-map-dep-row");
          row.innerHTML = `Answering <strong>Q${dep.num}. "${esc(dep.label)}"</strong> `
            + `<span class="ff-lm-hide-label">${esc(dep.edge.label)}</span> `
            + `→ hides this question`;
          if (dep.edge.method === "AND") {
            row.appendChild(el("span", "ff-lm-method-tag", "AND"));
          } else {
            row.appendChild(el("span", "ff-lm-method-tag ff-lm-method-or", "OR"));
          }
          section.appendChild(row);
        }
        textPane.appendChild(section);
      }

      if (affects.length > 0) {
        const section = el("div", "ff-lm-map-group");
        section.appendChild(el("div", "ff-lm-map-group-title",
          `Questions Q${focusNode.num}. "${focusNode.label}" can hide:`));
        for (const dep of affects) {
          const row = el("div", "ff-lm-map-dep-row");
          row.innerHTML = `Hides <strong>Q${dep.num}. "${esc(dep.label)}"</strong> `
            + `when answer <span class="ff-lm-hide-label">${esc(dep.edge.label)}</span>`;
          section.appendChild(row);
        }
        textPane.appendChild(section);
      }
      return;
    }

    // All-questions view: each question that has dependencies
    let anyDeps = false;
    for (const node of graph.nodes) {
      const affects = affectsOf(graph, node.id);
      if (affects.length === 0) continue;
      anyDeps = true;

      const section = el("div", "ff-lm-map-group");
      section.appendChild(el("div", "ff-lm-map-group-title",
        `Q${node.num}. "${node.label}" can hide:`));
      for (const dep of affects) {
        const row = el("div", "ff-lm-map-dep-row");
        row.innerHTML = `→ <strong>Q${dep.num}. "${esc(dep.label)}"</strong> `
          + `when answer <span class="ff-lm-hide-label">${esc(dep.edge.label)}</span>`;
        section.appendChild(row);
      }
      textPane.appendChild(section);
    }

    if (!anyDeps) {
      textPane.appendChild(el("div", "ff-lm-map-empty",
        "No conditional dependencies in this form."));
    }
  }

  sel.addEventListener("change", () => renderTextMap(sel.value));
  renderTextMap("");

  wrap.appendChild(h);
  wrap.appendChild(toolbar);
  wrap.appendChild(textPane);

  // ── Mermaid diagram (optional, degrades gracefully) ──────────────────────
  const diagramToggle = el("div", "ff-lm-diagram-toggle");
  const showDiagramBtn = el("button", "ff-lm-btn-secondary", "Show flow diagram");
  diagramToggle.appendChild(showDiagramBtn);
  const maximiseBtn = el("button", "ff-lm-btn-secondary ff-lm-hidden", "⛶ Maximise");
  maximiseBtn.title = "Open the diagram full-screen for easier reading";
  diagramToggle.appendChild(maximiseBtn);
  wrap.appendChild(diagramToggle);

  const diagramPane = el("div", "ff-lm-diagram-pane ff-lm-hidden");
  wrap.appendChild(diagramPane);

  showDiagramBtn.addEventListener("click", () => {
    const isHidden = diagramPane.classList.contains("ff-lm-hidden");
    if (isHidden) {
      diagramPane.classList.remove("ff-lm-hidden");
      maximiseBtn.classList.remove("ff-lm-hidden");
      showDiagramBtn.textContent = "Hide flow diagram";
      renderMermaid(graph, diagramPane);
    } else {
      diagramPane.classList.add("ff-lm-hidden");
      maximiseBtn.classList.add("ff-lm-hidden");
      showDiagramBtn.textContent = "Show flow diagram";
    }
  });

  maximiseBtn.addEventListener("click", () => openDiagramFullscreen(graph));

  return wrap;
}

// Opens the flow diagram in a dedicated full-screen layer on top of the overlay,
// so it can use the whole viewport and is easier to read on large forms.
let fullscreenEl = null;

function openDiagramFullscreen(graph) {
  if (fullscreenEl) fullscreenEl.remove();

  fullscreenEl = el("div", "ff-lm-fs");
  fullscreenEl.setAttribute("role", "dialog");
  fullscreenEl.setAttribute("aria-modal", "true");
  fullscreenEl.setAttribute("aria-label", "Flow diagram (full screen)");
  fullscreenEl.setAttribute("tabindex", "-1");

  const bar = el("div", "ff-lm-fs-bar");
  bar.appendChild(el("div", "ff-lm-fs-title", "Flow diagram"));
  const closeBtn = el("button", "ff-lm-btn-secondary", "✕ Close");
  closeBtn.setAttribute("type", "button");
  closeBtn.addEventListener("click", closeDiagramFullscreen);
  bar.appendChild(closeBtn);
  fullscreenEl.appendChild(bar);

  const fsPane = el("div", "ff-lm-fs-pane");
  fullscreenEl.appendChild(fsPane);

  fullscreenEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDiagramFullscreen();
  });

  document.body.appendChild(fullscreenEl);
  fullscreenEl.focus();
  renderMermaid(graph, fsPane);
}

function closeDiagramFullscreen() {
  if (fullscreenEl) { fullscreenEl.remove(); fullscreenEl = null; }
}

// Render the Mermaid diagram into a container, with graceful fallback.
async function renderMermaid(graph, container) {
  container.innerHTML = "";

  const mmdText = toMermaid(graph);

  if (!graph.edges.some((e) => !e.broken)) {
    container.appendChild(el("div", "ff-lm-map-empty",
      "No conditional edges to draw — add some conditions first."));
    return;
  }

  // Check if Mermaid is available (loaded via CDN in index.html)
  if (typeof window !== "undefined" && window.mermaid) {
    try {
      const id = "ff-lm-mermaid-" + Date.now();
      const { svg } = await window.mermaid.render(id, mmdText);
      const wrapper = el("div", "ff-lm-diagram-svg");
      wrapper.innerHTML = svg;
      container.appendChild(wrapper);

      // Also show the Mermaid source for LLM use
      const details = el("details", "ff-lm-mmd-source");
      const summary = el("summary", "", "Copy as Mermaid text (for LLM context)");
      details.appendChild(summary);
      const pre = el("pre", "ff-lm-mmd-pre", mmdText);
      details.appendChild(pre);
      const copyBtn = el("button", "ff-lm-btn-secondary ff-lm-btn-small", "Copy");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(mmdText).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
        });
      });
      details.appendChild(copyBtn);
      container.appendChild(details);
    } catch (err) {
      container.appendChild(el("div", "ff-lm-map-empty",
        "Diagram rendering failed. The text view above still shows all dependencies."));
    }
  } else {
    // Fallback: show Mermaid source so it's still useful without the CDN
    const note = el("div", "ff-lm-map-empty",
      "Diagram library not loaded (are you offline?). Use the text view above, or paste the Mermaid source below into mermaid.live:");
    container.appendChild(note);
    const pre = el("pre", "ff-lm-mmd-pre", mmdText);
    container.appendChild(pre);
  }
}

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Build the whole overlay ───────────────────────────────────────────────────

function buildOverlay() {
  const questions = state.questions || [];
  const graph = buildFlowGraph(questions);

  const root = el("div", "ff-lm");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Logic Map & Checker");

  // Dim backdrop — click to close
  const dim = el("div", "ff-lm-dim");
  dim.addEventListener("click", closeOverlay);
  root.appendChild(dim);

  // Panel
  const panel = el("div", "ff-lm-panel");
  panel.setAttribute("tabindex", "-1");

  // Header
  const head = el("div", "ff-lm-head");
  const title = el("div", "ff-lm-title", "Logic Map & Checker");
  const subtitle = el("div", "ff-lm-subtitle",
    `${questions.length} question${questions.length === 1 ? "" : "s"} • conditions are skip rules (hidden when TRUE)`);

  const closeBtn = el("button", "ff-lm-close", "✕");
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.setAttribute("type", "button");
  closeBtn.addEventListener("click", closeOverlay);

  const headLeft = el("div", "ff-lm-head-left");
  headLeft.appendChild(title);
  headLeft.appendChild(subtitle);
  head.appendChild(headLeft);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  // Body: checker + map
  const body = el("div", "ff-lm-body");

  if (questions.length === 0) {
    const empty = el("div", "ff-lm-map-empty",
      "Load a form first to see its logic map and checker.");
    body.appendChild(empty);
  } else {
    body.appendChild(buildChecker(questions));
    body.appendChild(buildTextMap(questions, graph));
  }

  panel.appendChild(body);
  root.appendChild(panel);

  // Close on Escape
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });

  return root;
}

// ── Public init ───────────────────────────────────────────────────────────────

export function initLogicMap() {
  const btn = document.getElementById("logic-map-btn");
  if (!btn) return;
  btn.addEventListener("click", openOverlay);
}
