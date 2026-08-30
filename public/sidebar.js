(function () {
  const COLLAPSE_KEY = "mw-sidebar-collapsed";
  const collapseBtn = document.getElementById("sidebarToggle");
  const mobileBtn = document.getElementById("mobileNavToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const MOBILE_QUERY = window.matchMedia("(max-width: 980px)");

  // ---- Desktop: collapse to icon rail ----
  if (collapseBtn) {
    const applyLabel = isCollapsed => {
      const label = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
      collapseBtn.setAttribute("aria-label", label);
      collapseBtn.setAttribute("title", label);
    };
    const collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    applyLabel(collapsed);

    collapseBtn.addEventListener("click", () => {
      const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
      localStorage.setItem(COLLAPSE_KEY, isCollapsed ? "1" : "0");
      applyLabel(isCollapsed);
    });
  }

  // ---- Mobile / tablet: off-canvas drawer ----
  function closeMobileNav() {
    document.body.classList.remove("mobile-nav-open");
    if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
  }
  function openMobileNav() {
    document.body.classList.add("mobile-nav-open");
    if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "true");
  }

  if (mobileBtn) {
    mobileBtn.addEventListener("click", () => {
      if (document.body.classList.contains("mobile-nav-open")) closeMobileNav();
      else openMobileNav();
    });
  }
  if (backdrop) backdrop.addEventListener("click", closeMobileNav);

  document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (MOBILE_QUERY.matches) closeMobileNav();
    });
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMobileNav();
  });

  MOBILE_QUERY.addEventListener("change", e => {
    if (!e.matches) closeMobileNav();
  });
})();
