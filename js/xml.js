// xml.js — the interim format the LLM edits.
//
// Export: build a strict, compact XML document (one <question> per line).
// Import: parse it back with the browser's native DOMParser, which rejects
// malformed / unclosed structures for us (strict integrity at zero cost).

// ---- export -------------------------------------------------------------

function escText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s) {
  return escText(s).replace(/"/g, "&quot;");
}

// formMeta: { uuid, name }; vms: array of view-models (see schema.parseField).
export function buildFormXml(formMeta, vms) {
  const lines = [];
  lines.push(
    `<form id="${escAttr(formMeta.uuid || "")}" name="${escAttr(formMeta.name || "")}">`
  );
  for (const vm of vms) {
    let q = `<question id="${escAttr(vm.uuid)}" type="${escAttr(vm.type)}"`;
    q += ` mandatory="${vm.mandatory ? "true" : "false"}" sort="${escAttr(vm.sort)}">`;
    q += `<name>${escText(vm.name)}</name>`;
    q += `<details>${escText(vm.details)}</details>`;
    if (vm.choices && vm.choices.length) {
      q += "<choices>";
      for (const c of vm.choices) q += `<choice>${escText(c)}</choice>`;
      q += "</choices>";
    }
    // Always emit <conditions> so the AND/OR method round-trips even when empty.
    q += `<conditions method="${escAttr(vm.method || "AND")}">`;
    for (const c of vm.conditions || []) {
      q += `<condition ref="${escAttr(c.ref)}" op="${escAttr(c.op)}" value="${escAttr(c.value)}"/>`;
    }
    q += "</conditions>";
    q += "</question>";
    lines.push(q);
  }
  lines.push("</form>");
  return lines.join("\n");
}

// ---- import -------------------------------------------------------------

export class XmlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "XmlParseError";
  }
}

function firstChildText(el, tag) {
  if (!el) return "";
  const nodes = el.getElementsByTagName(tag);
  return nodes && nodes.length ? nodes[0].textContent : "";
}

// Parse the edited XML back into { form, questions }. Throws XmlParseError on
// malformed XML. Browser-only (relies on DOMParser).
export function parseFormXml(xmlString) {
  if (typeof DOMParser === "undefined") {
    throw new XmlParseError("DOMParser is not available in this environment.");
  }
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");

  const errs = doc.getElementsByTagName("parsererror");
  if (errs && errs.length) {
    throw new XmlParseError(errs[0].textContent.trim() || "Malformed XML.");
  }

  const formEl = doc.getElementsByTagName("form")[0] || null;
  const form = {
    uuid: formEl ? formEl.getAttribute("id") || "" : "",
    name: formEl ? formEl.getAttribute("name") || "" : "",
  };

  const questionEls = doc.getElementsByTagName("question");
  const questions = [];
  for (let i = 0; i < questionEls.length; i++) {
    const qEl = questionEls[i];

    const choices = [];
    const choiceEls = qEl.getElementsByTagName("choice");
    for (let j = 0; j < choiceEls.length; j++) choices.push(choiceEls[j].textContent);

    const condsEl = qEl.getElementsByTagName("conditions")[0] || null;
    const conditions = [];
    const condEls = qEl.getElementsByTagName("condition");
    for (let j = 0; j < condEls.length; j++) {
      conditions.push({
        ref: (condEls[j].getAttribute("ref") || "").trim(),
        op: condEls[j].getAttribute("op") || "",
        value: condEls[j].getAttribute("value") || "",
      });
    }

    const mandatoryAttr = (qEl.getAttribute("mandatory") || "").toLowerCase();
    questions.push({
      uuid: (qEl.getAttribute("id") || "").trim(),
      type: qEl.getAttribute("type") || "",
      mandatory: mandatoryAttr === "true" || mandatoryAttr === "1",
      sort: qEl.getAttribute("sort") || "",
      name: firstChildText(qEl, "name"),
      details: firstChildText(qEl, "details"),
      choices,
      method: condsEl ? condsEl.getAttribute("method") || "AND" : "AND",
      conditions,
    });
  }

  return { form, questions };
}
