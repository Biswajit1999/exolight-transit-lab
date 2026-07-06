import { validatePhysicsCore, PHYSICS_CORE_VERSION } from "./physics/validation.js";

function createBadge() {
  const result = validatePhysicsCore();
  const badge = document.createElement("aside");
  badge.className = `phaseiii-badge ${result.passed ? "ok" : "warn"}`;
  badge.setAttribute("aria-label", "Phase III research toolkit status");
  badge.innerHTML = `
    <strong>Phase III Toolkit</strong>
    <span>${result.passed ? "physics core validated" : "validation warning"}</span>
    <small>${PHYSICS_CORE_VERSION} · HD 189733 b benchmark</small>
  `;
  return badge;
}

function injectBadgeStyles() {
  if (document.getElementById("phaseiii-badge-style")) return;
  const style = document.createElement("style");
  style.id = "phaseiii-badge-style";
  style.textContent = `
    .phaseiii-badge {
      position: fixed;
      right: max(16px, env(safe-area-inset-right));
      bottom: max(16px, env(safe-area-inset-bottom));
      z-index: 50;
      display: grid;
      gap: 2px;
      max-width: min(280px, calc(100vw - 32px));
      padding: 12px 14px;
      border: 1px solid rgba(99, 167, 255, .32);
      border-radius: 16px;
      background: rgba(5, 12, 23, .76);
      color: #e8f4ff;
      box-shadow: 0 18px 60px rgba(0, 0, 0, .36), inset 0 1px 0 rgba(255, 255, 255, .08);
      -webkit-backdrop-filter: blur(14px);
      backdrop-filter: blur(14px);
      font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .phaseiii-badge strong { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; }
    .phaseiii-badge span { color: #9ee7c7; }
    .phaseiii-badge small { color: rgba(232, 244, 255, .72); }
    .phaseiii-badge.warn span { color: #ffd28a; }
    @media (max-width: 760px) { .phaseiii-badge { position: static; margin: 12px 16px 16px; } }
  `;
  document.head.appendChild(style);
}

function mount() {
  injectBadgeStyles();
  const existing = document.querySelector(".phaseiii-badge");
  if (existing) existing.remove();
  document.body.appendChild(createBadge());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
