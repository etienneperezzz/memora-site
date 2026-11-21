// Phone layout of the shared web UI: the desktop tab row becomes a floating dock of icons
// (mobile.css) and its buttons go to a slim top bar titled with the active tab.
// Plain JS on purpose: bundled into the app by bridge.ts, and copied as is into the web
// demo's mobile version (scripts/build_demo.py → app/mobile.html).
(function () {
  const TAB_ICONS = {   // by data-tab
    0: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>',
    4: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
    1: '<rect x="7" y="7" width="14" height="14" rx="3"/><path d="M17 3H6a3 3 0 0 0-3 3v11"/>',
    2: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  };
  window.memorizzzPhoneShell = function () {
    const app = document.getElementById("app");
    if (!app || !document.querySelector(".tabs") || document.getElementById("mz-top")) return;
    const top = document.createElement("header");
    top.id = "mz-top";
    top.innerHTML = '<img src="img/logo.png" alt=""><b id="mz-title"></b>';
    for (const id of ["add-btn", "random-btn", "settings-btn"]) {   // moved, not copied: their listeners stay
      const b = document.getElementById(id);
      if (b) top.appendChild(b);
    }
    app.insertBefore(top, app.firstChild);
    // Chat Media's search field: behind a magnifier in the top bar, shown on the tabs that have it
    const wrap = document.querySelector(".search-wrap"), input = document.getElementById("search-input");
    const sb = document.createElement("button");
    sb.className = "refresh-btn";
    sb.id = "mz-search";
    sb.setAttribute("aria-label", "Rechercher");
    sb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';
    top.insertBefore(sb, top.querySelector("b").nextSibling);
    sb.addEventListener("click", () => {
      const open = wrap.classList.toggle("mz-open");
      if (open) input.focus();
      else if (input.value) { input.value = ""; input.dispatchEvent(new Event("input")); }
    });
    const title = top.querySelector("#mz-title");
    const setTitle = () => {
      title.textContent = document.querySelector(".tabs .tab.active")?.dataset.label ?? "";
      sb.hidden = !wrap || getComputedStyle(wrap).display === "none";
    };
    document.querySelectorAll(".tabs .tab").forEach((t) => {
      const d = TAB_ICONS[t.dataset.tab];
      if (!d) return;
      t.dataset.label = t.textContent.trim();
      t.setAttribute("aria-label", t.dataset.label);
      t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
      t.addEventListener("click", setTitle);
    });
    setTitle();
  };
})();
