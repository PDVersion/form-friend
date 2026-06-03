// guide.js — an interactive on-screen "User guide" overlay (coach-marks).
//
// Clicking the User guide button (or first-visit auto-open) drops a lightly
// dimmed layer over the app and highlights the buttons/elements that matter
// for two workflows: "Create a brand-new form" and "Edit an existing form".
//
// Each in-app step is given a letter (A, B, C…). The matching element gets a
// glowing ring, a lettered pill bubble, and a vector (SVG) arrow pointing at
// it. A side panel lists the full numbered steps for the chosen workflow,
// including the off-app steps (paste into your LLM, import into ServiceM8…).
//
// "Smart" labelling: only elements that are actually on screen right now are
// ringed/arrowed. Steps whose element isn't visible yet (e.g. Download before
// you've built anything) are shown greyed in the step list with a hint, so an
// arrow never points at nothing.
//
// Self-contained, no dependencies. Call initGuide() once after DOM is ready.

const SVG_NS = "http://www.w3.org/2000/svg";
const SEEN_KEY = "ff_guide_seen";

// Reserve space on the right for the steps panel so right-column pills don't
// collide with it (kept in sync with the CSS width below).
const PANEL_WIDTH = 340;
const PANEL_GAP = 24; // breathing room between panel and a pill
const PILL_GAP = 16; // gap between a pill and the element it points at
const TOP_SAFE = 16; // keep pills/rings clear of the very top edge

const WORKFLOWS = [
  {
    id: "create",
    label: "Create a brand-new form",
    blurb: "Start from a blank slate with help from an LLM.",
    steps: [
      { n: 1, letter: "A", target: "copy-create-guide-btn", short: "Copy create guide", text: "Click Copy create guide." },
      { n: 2, kind: "llm", text: "Paste it into your LLM (Claude, ChatGPT…)." },
      { n: 3, kind: "llm", text: "Describe your questions, answers and conditions." },
      { n: 4, kind: "llm", text: "Ask the LLM to generate the form XML." },
      { n: 5, letter: "B", target: "xml-editor", short: "XML editor", text: "Paste the generated XML back into the editor." },
      { n: 6, letter: "C", target: "xml-docx-input", short: "PDF template", text: "Optional: choose a .docx to embed a PDF template." },
      { n: 7, letter: "D", target: "build-btn", short: "Build .sm8f", text: "Click Build .sm8f from XML." },
      { n: 8, kind: "check", text: "Check the questions on the left are correct." },
      { n: 9, letter: "E", target: "download-link", short: "Download", text: "Click Download rebuilt .sm8f." },
      { n: 10, kind: "external", text: "Import the .sm8f into ServiceM8 → Forms." },
    ],
  },
  {
    id: "edit",
    label: "Edit an existing form",
    blurb: "Export from SM8, mass-edit via an LLM, then re-import.",
    steps: [
      { n: 1, kind: "external", text: "Export the form from ServiceM8." },
      { n: 2, letter: "A", target: "dropzone", short: "Drop .sm8f", text: "Drop the .sm8f into the drop zone (or click to choose)." },
      { n: 3, kind: "check", text: "Check the parsed questions on the left." },
      { n: 4, letter: "B", target: "copy-edit-guide-btn", short: "Copy edit guide", text: "Click Copy edit guide." },
      { n: 5, kind: "llm", text: "Paste it into your LLM." },
      { n: 6, letter: "C", target: "copy-btn", short: "Copy XML", text: "Click Copy to grab the current form XML." },
      { n: 7, kind: "llm", text: "Paste the XML into your LLM and generate the edited XML." },
      { n: 8, letter: "D", target: "xml-editor", short: "XML editor", text: "Select all in the editor and replace it with the edited XML." },
      { n: 9, letter: "E", target: "import-btn", short: "Validate & Repackage", text: "Click Validate & Repackage." },
      { n: 10, letter: "F", target: "download-link", short: "Download", text: "Click Download rebuilt .sm8f." },
      { n: 11, kind: "external", text: "Import the .sm8f back into ServiceM8 → Forms." },
    ],
  },
];

const KIND_ICON = { llm: "🤖", external: "↗", check: "👀" };

let overlay = null; // root element while open
let activeId = "create";
let rafPending = false;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function isVisible(node) {
  if (!node) return false;
  // offsetParent is null for display:none subtrees (covers our .hidden toggles).
  if (node.offsetParent === null && getComputedStyle(node).position !== "fixed") {
    return false;
  }
  const r = node.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight;
}

function activeWorkflow() {
  return WORKFLOWS.find((w) => w.id === activeId) || WORKFLOWS[0];
}

// ---- Build the overlay once ------------------------------------------------

function buildOverlay() {
  const root = el("div", "ff-guide");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Form Friend user guide");

  const dim = el("div", "ff-guide-dim");
  dim.addEventListener("click", closeGuide);

  const svg = svgEl("svg", { class: "ff-guide-svg" });
  const defs = svgEl("defs", {});
  const marker = svgEl("marker", {
    id: "ff-arrowhead",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "3",
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.appendChild(svgEl("path", { d: "M0,0 L8,3 L0,6 Z", fill: "#4f46e5" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  const marks = el("div", "ff-guide-marks"); // rings live in SVG; pills live here

  const panel = buildPanel();

  root.appendChild(dim);
  root.appendChild(svg);
  root.appendChild(marks);
  root.appendChild(panel);
  return root;
}

function buildPanel() {
  const panel = el("aside", "ff-guide-panel");

  const head = el("div", "ff-guide-head");
  head.appendChild(el("div", "ff-guide-title", "📖 User guide"));
  const close = el("button", "ff-guide-close", "✕");
  close.setAttribute("aria-label", "Close guide");
  close.addEventListener("click", closeGuide);
  head.appendChild(close);
  panel.appendChild(head);

  panel.appendChild(
    el(
      "p",
      "ff-guide-intro",
      "Pick a workflow. Lettered tags point to the buttons you’ll use — only the ones on screen right now are highlighted."
    )
  );

  const tabs = el("div", "ff-guide-tabs");
  for (const w of WORKFLOWS) {
    const t = el("button", "ff-guide-tab", w.label);
    t.dataset.id = w.id;
    t.addEventListener("click", () => {
      activeId = w.id;
      renderPanelBody();
      layout();
    });
    tabs.appendChild(t);
  }
  panel.appendChild(tabs);

  panel.appendChild(el("div", "ff-guide-body"));

  const note = el(
    "div",
    "ff-guide-note",
    "💡 For <strong>big changes</strong>, editing the XML via an LLM is fastest. For <strong>small tweaks</strong>, use ServiceM8’s built-in form builder instead."
  );
  panel.appendChild(note);

  const footer = el("div", "ff-guide-footer");
  const got = el("button", "ff-guide-got", "Got it");
  got.addEventListener("click", closeGuide);
  footer.appendChild(got);
  panel.appendChild(footer);

  return panel;
}

function renderPanelBody() {
  // Tab active state
  overlay.querySelectorAll(".ff-guide-tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.id === activeId);
  });

  const body = overlay.querySelector(".ff-guide-body");
  body.innerHTML = "";
  const wf = activeWorkflow();
  body.appendChild(el("p", "ff-guide-blurb", wf.blurb));

  const list = el("ol", "ff-guide-steps");
  for (const s of wf.steps) {
    const node = document.getElementById(s.target);
    const visible = s.target ? isVisible(node) : true;
    const li = el("li", "ff-guide-step" + (!visible ? " is-hidden" : ""));

    const tag = el("span", "ff-guide-tag");
    if (s.letter) {
      tag.classList.add("is-letter");
      if (!visible) tag.classList.add("is-dim");
      tag.textContent = s.letter;
    } else {
      tag.classList.add("is-icon");
      tag.textContent = KIND_ICON[s.kind] || s.n;
    }
    li.appendChild(tag);

    const txt = el("span", "ff-guide-step-text");
    txt.textContent = s.text;
    if (s.target && !visible) {
      txt.appendChild(el("span", "ff-guide-hint", " (appears once it’s on screen)"));
    }
    li.appendChild(txt);
    list.appendChild(li);
  }
  body.appendChild(list);
}

// ---- Position rings, pills and arrows --------------------------------------

function scheduleLayout() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    layout();
  });
}

function layout() {
  if (!overlay) return;
  const svg = overlay.querySelector(".ff-guide-svg");
  const marks = overlay.querySelector(".ff-guide-marks");
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Clear previous marks (keep <defs>).
  marks.innerHTML = "";
  [...svg.querySelectorAll(".ff-mark")].forEach((n) => n.remove());
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  svg.setAttribute("width", vw);
  svg.setAttribute("height", vh);

  // The steps panel sits on the left on wide screens, or as a bottom sheet on
  // narrow ones. Keep pills clear of whichever it is.
  const wide = vw > 720;
  const minX = wide ? 16 + PANEL_WIDTH + PANEL_GAP : 8;
  const maxY = wide ? vh - 8 : Math.round(vh * 0.45);

  for (const s of activeWorkflow().steps) {
    if (!s.target) continue;
    const node = document.getElementById(s.target);
    if (!isVisible(node)) continue;
    const r = node.getBoundingClientRect();

    // Ring around the element.
    const pad = 6;
    const ring = svgEl("rect", {
      class: "ff-mark ff-ring",
      x: r.left - pad,
      y: Math.max(TOP_SAFE - pad, r.top - pad),
      width: r.width + pad * 2,
      height: Math.min(r.height + pad * 2, vh - (r.top - pad) - 4),
      rx: 10,
    });
    svg.appendChild(ring);

    // Pill: choose the side with the most room, biased away from the panel.
    const pill = el("div", "ff-guide-pill");
    if (s.letter) {
      pill.appendChild(el("span", "ff-pill-letter", s.letter));
    }
    pill.appendChild(el("span", "ff-pill-label", s.short));
    marks.appendChild(pill); // append first so we can measure it
    const pr = pill.getBoundingClientRect();
    const pw = pr.width;
    const ph = pr.height;

    // Room to the left of the element, but not into the panel's column.
    const spaceLeft = r.left - minX;
    const spaceRight = vw - r.right;
    let px;
    let py;
    let placeSide;

    if (spaceLeft >= pw + PILL_GAP && spaceLeft >= spaceRight) {
      placeSide = "left";
      px = r.left - PILL_GAP - pw;
      py = r.top + r.height / 2 - ph / 2;
    } else if (spaceRight >= pw + PILL_GAP) {
      placeSide = "right";
      px = r.right + PILL_GAP;
      py = r.top + r.height / 2 - ph / 2;
    } else if (r.top > ph + PILL_GAP + TOP_SAFE) {
      placeSide = "top";
      px = r.left + r.width / 2 - pw / 2;
      py = r.top - PILL_GAP - ph;
    } else {
      placeSide = "bottom";
      px = r.left + r.width / 2 - pw / 2;
      py = r.bottom + PILL_GAP;
    }

    // Clamp into the viewport, keeping clear of the steps panel.
    px = Math.max(minX, Math.min(px, vw - pw - 8));
    py = Math.max(TOP_SAFE, Math.min(py, maxY - ph));
    pill.style.left = `${px}px`;
    pill.style.top = `${py}px`;

    // Arrow from the pill edge to the nearest point on the element.
    const pcx = px + pw / 2;
    const pcy = py + ph / 2;
    const tx = Math.max(r.left, Math.min(pcx, r.right));
    const ty = Math.max(r.top, Math.min(pcy, r.bottom));
    // Start the line at the pill border closest to the target.
    let sx = pcx;
    let sy = pcy;
    if (placeSide === "left") sx = px + pw;
    else if (placeSide === "right") sx = px;
    else if (placeSide === "top") sy = py + ph;
    else sy = py;

    const arrow = svgEl("line", {
      class: "ff-mark ff-arrow",
      x1: sx,
      y1: sy,
      x2: tx,
      y2: ty,
      "marker-end": "url(#ff-arrowhead)",
    });
    svg.appendChild(arrow);
  }
}

// ---- Open / close ----------------------------------------------------------

function onKey(e) {
  if (e.key === "Escape") closeGuide();
}

export function openGuide() {
  if (overlay) return;
  overlay = buildOverlay();
  document.body.appendChild(overlay);
  document.body.classList.add("ff-guide-open");
  renderPanelBody();
  // Two frames: let layout settle (fonts/pill sizes) before measuring.
  requestAnimationFrame(() => requestAnimationFrame(layout));
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("scroll", scheduleLayout, true);
  document.addEventListener("keydown", onKey);
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch (_e) {}
}

export function closeGuide() {
  if (!overlay) return;
  window.removeEventListener("resize", scheduleLayout);
  window.removeEventListener("scroll", scheduleLayout, true);
  document.removeEventListener("keydown", onKey);
  overlay.remove();
  overlay = null;
  document.body.classList.remove("ff-guide-open");
}

export function initGuide() {
  const btn = document.getElementById("user-guide-btn");
  if (btn) btn.addEventListener("click", openGuide);

  // First-visit auto-open (remembered so it only nudges new users once).
  let seen = false;
  try {
    seen = !!localStorage.getItem(SEEN_KEY);
  } catch (_e) {}
  if (!seen) {
    // Default to the "create" workflow since that's the empty-state journey.
    activeId = "create";
    setTimeout(openGuide, 600);
  }
}
