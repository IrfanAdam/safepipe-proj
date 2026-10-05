/* Safepipe DS — src/ds/gallery-shell.js · gallery tabs + doc loader.
 * One nav button [data-tab] shows one .frame[data-panel]; hash routes
 * (#color, #actions …). Each [data-doc] fragment is fetched inline,
 * then a `ds:doc` event tells specimens the DOM is ready. */

const items = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const section = document.getElementById("gtop-section");

function names() {
  return panels.map((p) => p.dataset.panel);
}

function fromHash() {
  const h = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return names().includes(h) ? h : names()[0];
}

function show(name, push = true) {
  if (!names().includes(name)) name = names()[0];
  for (const b of items) {
    const on = b.dataset.tab === name;
    b.classList.toggle("gnav__item--active", on);
    if (on) b.closest("details")?.setAttribute("open", "");
  }
  for (const p of panels) p.hidden = p.dataset.panel !== name;
  if (section) section.textContent = name;
  if (push) history.replaceState(null, "", "#" + name);
}

async function loadDocs() {
  const slots = [...document.querySelectorAll("[data-doc]")];
  await Promise.all(
    slots.map(async (el) => {
      try {
        const res = await fetch(el.dataset.doc);
        if (!res.ok) throw new Error(res.status + " " + el.dataset.doc);
        el.innerHTML = await res.text();
      } catch (err) {
        el.innerHTML = '<p class="meta">missing doc: ' + el.dataset.doc + "</p>";
      }
      document.dispatchEvent(new Event("ds:doc"));
    })
  );
  document.dispatchEvent(new Event("ds:doc"));
}

for (const b of items) {
  b.addEventListener("click", () => show(b.dataset.tab));
}
window.addEventListener("hashchange", () => show(fromHash(), false));

show(fromHash(), false);
loadDocs();
