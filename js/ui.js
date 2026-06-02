// ui.js — render the parsed questions into the page.

import { conditionIssues, KNOWN_OPERATORS } from "./schema.js";

const OP_LABELS = {
  CON: "contains",
  NCON: "does not contain",
  EQ: "equals",
  NEQ: "does not equal",
  GT: "greater than",
  LT: "less than",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// vms: sorted view-models.
// idToName: Map(uuid -> question name) for readable refs.
// idToNumber: Map(uuid -> 1-based position) for numbered refs.
// onRemoveCondition(vm, condIndex): called when the user clicks Remove on a broken condition.
export function renderQuestions(container, vms, idToName, idToNumber, onRemoveCondition) {
  container.innerHTML = "";

  const idSet = new Set(idToName.keys());

  vms.forEach((vm, index) => {
    const position = index + 1;
    const card = el("div", "border border-slate-200 rounded-lg p-4 bg-white shadow-sm");

    const head = el("div", "flex items-start justify-between gap-3");
    const title = el("h3", "font-semibold text-slate-800");
    title.textContent = `${position}. ${vm.name || "(untitled)"}`;
    head.appendChild(title);

    const badges = el("div", "flex items-center gap-2 shrink-0");
    badges.appendChild(el("span", "text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700", vm.type || "?"));
    if (vm.mandatory) {
      badges.appendChild(el("span", "text-xs px-2 py-0.5 rounded bg-rose-100 text-rose-700", "required"));
    }
    head.appendChild(badges);
    card.appendChild(head);

    if (vm.details) {
      const details = el("p", "text-sm text-slate-500 mt-1 whitespace-pre-line", vm.details);
      card.appendChild(details);
    }

    if (vm.choices && vm.choices.length) {
      const wrap = el("div", "mt-2 flex flex-wrap gap-1.5");
      for (const choice of vm.choices) {
        wrap.appendChild(el("span", "text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-600", choice));
      }
      card.appendChild(wrap);
    }

    if (vm.conditions && vm.conditions.length) {
      const cond = el("div", "mt-3 text-xs text-slate-500 border-l-2 border-amber-300 pl-2");
      const header = el("div", "font-medium text-amber-700", `Skip Question If (${vm.method}):`);
      cond.appendChild(header);

      for (let ci = 0; ci < vm.conditions.length; ci++) {
        const c = vm.conditions[ci];
        const refNum = idToNumber ? idToNumber.get(c.ref) : undefined;
        const refName = idToName.get(c.ref) || c.ref || "(none)";
        const opText = OP_LABELS[c.op] || c.op || "?";
        const numPrefix = refNum !== undefined ? `(${refNum}) ` : "";

        const issues = conditionIssues(c, {
          position,
          knownOperators: KNOWN_OPERATORS,
          idSet,
          idToNumber: idToNumber || new Map(),
        });

        if (issues.length > 0) {
          const row = el("div", "flex items-start justify-between gap-1 mt-0.5");
          const text = el(
            "div",
            "text-rose-500",
            `⚠ ${numPrefix}"${refName}" ${opText} "${c.value}" — ${issues.join("; ")}`
          );
          row.appendChild(text);
          if (onRemoveCondition) {
            const btn = el("button", "ml-2 shrink-0 text-rose-400 hover:text-rose-600 text-xs underline cursor-pointer", "Remove");
            btn.type = "button";
            const captureCi = ci;
            btn.addEventListener("click", () => onRemoveCondition(vm, captureCi));
            row.appendChild(btn);
          }
          cond.appendChild(row);
        } else {
          cond.appendChild(el("div", "", `• ${numPrefix}"${refName}" ${opText} "${c.value}"`));
        }
      }

      card.appendChild(cond);
    }

    const idLine = el("div", "mt-2 text-[10px] text-slate-300 font-mono", vm.uuid);
    card.appendChild(idLine);

    container.appendChild(card);
  });
}

export function renderFormInfo(node, formMeta, count) {
  node.innerHTML = "";
  node.appendChild(el("div", "text-lg font-semibold text-slate-800", formMeta.name || "(unnamed form)"));
  node.appendChild(el("div", "text-sm text-slate-500", `${count} question${count === 1 ? "" : "s"} • form ${formMeta.uuid || "?"}`));
}
