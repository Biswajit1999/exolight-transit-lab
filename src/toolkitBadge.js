import { validatePhysicsCore, PHYSICS_CORE_VERSION } from "./physics/validation.js";

function createStatusTile() {
  const result = validatePhysicsCore();
  const tile = document.createElement("div");
  tile.className = `status-tile phaseiii-status-pill ${result.passed ? "ok" : "warn"}`;
  tile.id = "phaseiii-status-tile";
  tile.title = `${PHYSICS_CORE_VERSION} · HD 189733 b benchmark`;
  tile.innerHTML = `
    <span>Phase III toolkit</span>
    <strong>${result.passed ? "validated" : "check warning"}</strong>
  `;
  return tile;
}

function mountIntoHeader() {
  const strip = document.querySelector(".status-strip");
  if (!strip) return false;
  document.getElementById("phaseiii-status-tile")?.remove();
  strip.appendChild(createStatusTile());
  return true;
}

function boot() {
  if (mountIntoHeader()) return;

  const observer = new MutationObserver(() => {
    if (mountIntoHeader()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
