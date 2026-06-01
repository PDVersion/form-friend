// ui.js — render the parsed questions into the page. Intentionally minimal
// (the user will refine the visual design later).

const OP_LABELS = {
  CON: "contains",
  NCON: "does not contain",
  EQ: "equals",
  NEQ: "does not equal",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// vms: sorted view-models. idToName: Map(uuid -> question name) for readable refs.
export function renderQuestions(container, vms, idToName) {
  container.innerHTML = "";

  vms.forEach((vm, index) => {
    const card = el("div", "border border-slate-200 rounded-lg p-4 bg-white shadow-sm");

    const head = el("div", "flex items-start justify-between gap-3");
    const title = el("h3", "font-semibold text-slate-800");
    title.textContent = `${index + 1}. ${vm.name || "(untitled)"}`;
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
      const header = el("div", "font-medium text-amber-700", `Show only if (${vm.method}):`);
      cond.appendChild(header);
      for (const c of vm.conditions) {
        const refName = idToName.get(c.ref) || c.ref || "(none)";
        const opText = OP_LABELS[c.op] || c.op || "?";
        cond.appendChild(el("div", "", `• "${refName}" ${opText} "${c.value}"`));
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
