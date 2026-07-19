/* ============================================================================
   ExoLight Phase III - Lazy diagnostic tab runtime
   Loads heavy evidence/cockpit panels only when the visitor asks for them.
   ============================================================================ */

const VERSION = "20260720-tabs-v01";
const DEFAULT_TAB = "model";

const TABS = Object.freeze([
  {
    id: "model",
    label: "Model + Plot",
    status: "Default lightweight view: WebGL scene, controls, and transit curve.",
    module: null,
    styles: []
  },
  {
    id: "mission",
    label: "Mission Control",
    status: "Target audit, catalogue/model score, and exportable research note.",
    module: `./missionControlRuntime.js?v=${VERSION}`,
    styles: [`./src/ui/missionControl.css?v=${VERSION}`]
  },
  {
    id: "observatory",
    label: "Observatory Deck",
    status: "Geometry, visual meters, and diagnostic cockpit summary.",
    module: `./observatoryDeckRuntime.js?v=${VERSION}`,
    styles: [`./src/ui/observatoryDeck.css?v=${VERSION}`]
  },
  {
    id: "residuals",
    label: "Residuals",
    status: "Residual mismatch map and first-pass anomaly guidance.",
    module: `./residualInspectorRuntime.js?v=${VERSION}`,
    styles: [`./src/ui/residualInspector.css?v=${VERSION}`]
  },
  {
    id: "evidence",
    label: "Evidence",
    status: "False-positive evidence cockpit based on the Phase III research report.",
    module: `./evidenceCockpitRuntime.js?v=${VERSION}`,
    styles: [`./src/ui/evidenceCockpit.css?v=${VERSION}`]
  }
]);

const loadedModules = new Set();
const loadedStyles = new Set();
let mounted = false;
let activeTab = DEFAULT_TAB;

function byId(id) {
  return document.getElementById(id);
}

function loadStyle(href) {
  if (!href || loadedStyles.has(href)) return;
  loadedStyles.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.exolightLazyStyle = "true";
  document.head.appendChild(link);
}

async function loadTabResources(tab) {
  for (const href of tab.styles || []) loadStyle(href);
  if (tab.module && !loadedModules.has(tab.module)) {
    loadedModules.add(tab.module);
    await import(tab.module);
  }
}

function ensureTabBar() {
  const workspace = document.querySelector(".workspace");
  if (!workspace) return null;

  let bar = byId("exolight-tab-bar");
  if (bar) return bar;

  document.body.classList.add("exolight-tabs-active");
  document.body.dataset.exolightTab = activeTab;

  bar = document.createElement("nav");
  bar.id = "exolight-tab-bar";
  bar.className = "exolight-tab-bar";
  bar.setAttribute("aria-label", "ExoLight Phase III diagnostic tabs");

  const group = document.createElement("div");
  group.className = "exolight-tab-group";
  group.setAttribute("role", "tablist");

  for (const tab of TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exolight-tab-button";
    button.id = `exolight-tab-${tab.id}`;
    button.dataset.tab = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", tab.id === activeTab ? "true" : "false");
    button.textContent = tab.label;
    button.addEventListener("click", () => selectTab(tab.id));
    group.appendChild(button);
  }

  const status = document.createElement("span");
  status.id = "exolight-tab-status";
  status.className = "exolight-tab-status";
  status.textContent = TABS.find(tab => tab.id === activeTab)?.status || "";

  bar.append(group, status);
  workspace.prepend(bar);
  return bar;
}

function syncButtonState() {
  for (const tab of TABS) {
    const button = byId(`exolight-tab-${tab.id}`);
    if (button) button.setAttribute("aria-selected", tab.id === activeTab ? "true" : "false");
  }
  const status = byId("exolight-tab-status");
  const active = TABS.find(tab => tab.id === activeTab);
  if (status && active) status.textContent = active.status;
}

function requestSceneRest() {
  window.dispatchEvent(new CustomEvent("exolight:tab-change", { detail: { tab: activeTab } }));
}

async function selectTab(tabId) {
  const tab = TABS.find(item => item.id === tabId) || TABS[0];
  activeTab = tab.id;
  document.body.dataset.exolightTab = activeTab;
  window.localStorage?.setItem("exolight-phaseiii-active-tab", activeTab);
  syncButtonState();
  requestSceneRest();

  try {
    await loadTabResources(tab);
  } catch (error) {
    console.warn(`ExoLight tab '${tab.id}' could not load:`, error);
    const status = byId("exolight-tab-status");
    if (status) status.textContent = `Could not load ${tab.label}. See browser console.`;
  }

  window.requestAnimationFrame(() => {
    document.querySelector(".main-panel")?.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
  });
}

function restoreInitialTab() {
  const hash = window.location.hash.replace(/^#/, "");
  const fromHash = hash.startsWith("tab=") ? hash.slice(4) : "";
  const stored = window.localStorage?.getItem("exolight-phaseiii-active-tab");
  const requested = fromHash || stored || DEFAULT_TAB;
  return TABS.some(tab => tab.id === requested) ? requested : DEFAULT_TAB;
}

function watchForWorkspace() {
  const observer = new MutationObserver(() => {
    if (ensureTabBar()) {
      observer.disconnect();
      syncButtonState();
      selectTab(activeTab);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function bootTabs() {
  if (mounted) return;
  mounted = true;
  activeTab = restoreInitialTab();
  if (!ensureTabBar()) {
    watchForWorkspace();
    return;
  }
  syncButtonState();
  selectTab(activeTab);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootTabs, { once: true });
} else {
  bootTabs();
}
