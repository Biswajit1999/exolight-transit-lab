export function scoreTone(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 82) return "good";
  if (value >= 58) return "watch";
  if (value >= 35) return "caution";
  return "poor";
}

export function diagnosticGauge({
  score = 0,
  label = "Score",
  detail = "/100",
  className = "",
  size = "normal"
} = {}) {
  const numeric = Math.max(0, Math.min(100, Number.isFinite(Number(score)) ? Number(score) : 0));
  const rounded = Math.round(numeric);
  const tone = scoreTone(numeric);
  const safeLabel = String(label ?? "Score");
  const safeDetail = String(detail ?? "/100");
  const aria = `${safeLabel}: ${rounded} out of 100`;

  return `
    <div class="diagnostic-gauge ${tone} ${size} ${className}" style="--score:${rounded};" role="img" aria-label="${aria}">
      <div class="diagnostic-gauge-ring" aria-hidden="true"></div>
      <div class="diagnostic-gauge-core">
        <strong>${rounded}</strong>
        <span>${safeDetail}</span>
        <small>${safeLabel}</small>
      </div>
    </div>
  `;
}
