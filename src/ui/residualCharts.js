function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function prepareCanvas(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(120, Math.floor((rect.height || 180) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { ctx: canvas.getContext("2d"), width, height, dpr };
}

function drawFrame(ctx, width, height, dpr, label) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6,14,27,.72)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(130,170,220,.16)";
  ctx.lineWidth = dpr;
  for (let i = 1; i < 5; i += 1) {
    const x = width * i / 5;
    const y = height * i / 5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  ctx.fillStyle = "rgba(185,205,230,.78)";
  ctx.font = `${11 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  ctx.fillText(label, 12 * dpr, 18 * dpr);
}

function domain(samples, key) {
  const values = samples.map(sample => Number(sample[key])).filter(Number.isFinite);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function plotScales(samples, width, height, dpr) {
  const pad = { left: 44 * dpr, right: 16 * dpr, top: 28 * dpr, bottom: 26 * dpr };
  const phase = domain(samples, "phase");
  const residuals = samples.map(sample => Number(sample.residualPpm)).filter(Number.isFinite);
  const abs = Math.max(1, ...residuals.map(value => Math.abs(value)));
  const x = value => pad.left + ((value - phase.min) / Math.max(1e-9, phase.max - phase.min)) * (width - pad.left - pad.right);
  const y = value => height / 2 - (value / abs) * ((height - pad.top - pad.bottom) / 2);
  return { x, y, pad };
}

function binSamples(samples, bins = 28) {
  if (!samples.length) return [];
  const phase = domain(samples, "phase");
  const step = Math.max(1e-9, (phase.max - phase.min) / bins);
  const groups = Array.from({ length: bins }, () => []);
  for (const sample of samples) {
    const index = Math.max(0, Math.min(bins - 1, Math.floor((sample.phase - phase.min) / step)));
    groups[index].push(sample.residualPpm);
  }
  return groups.map((values, index) => {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return null;
    const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
    const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, clean.length - 1);
    return { phase: phase.min + (index + .5) * step, residualPpm: mean, errorPpm: Math.sqrt(variance) / Math.sqrt(clean.length) };
  }).filter(Boolean);
}

function periodogram(samples, count = 54) {
  const clean = samples.filter(sample => Number.isFinite(sample.phase) && Number.isFinite(sample.residualPpm));
  if (clean.length < 12) return [];
  const mean = clean.reduce((sum, sample) => sum + sample.residualPpm, 0) / clean.length;
  const result = [];
  for (let k = 1; k <= count; k += 1) {
    const frequency = k / 0.15;
    let s = 0, c = 0;
    for (const sample of clean) {
      const angle = Math.PI * 2 * frequency * sample.phase;
      const y = sample.residualPpm - mean;
      s += y * Math.sin(angle);
      c += y * Math.cos(angle);
    }
    result.push({ frequency, power: Math.sqrt(s * s + c * c) / clean.length });
  }
  return result;
}

export function drawResidualScatter(canvas, samples = []) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height, dpr } = prepared;
  drawFrame(ctx, width, height, dpr, samples.length ? "residuals = observed − model" : "no plotted residual samples available");
  if (!samples.length) return;
  const { x, y, pad } = plotScales(samples, width, height, dpr);
  ctx.strokeStyle = "rgba(255,255,255,.36)";
  ctx.beginPath(); ctx.moveTo(pad.left, height / 2); ctx.lineTo(width - pad.right, height / 2); ctx.stroke();
  ctx.fillStyle = "rgba(91,197,255,.76)";
  for (const sample of samples) {
    ctx.beginPath(); ctx.arc(x(sample.phase), y(sample.residualPpm), 2 * dpr, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawBinnedResiduals(canvas, samples = []) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height, dpr } = prepared;
  const bins = binSamples(samples);
  drawFrame(ctx, width, height, dpr, bins.length ? "binned residuals with standard-error bars" : "no binned residuals available");
  if (!bins.length) return;
  const { x, y } = plotScales(bins, width, height, dpr);
  ctx.strokeStyle = "rgba(255,181,71,.74)";
  ctx.fillStyle = "rgba(255,181,71,.92)";
  for (const bin of bins) {
    const px = x(bin.phase);
    const py = y(bin.residualPpm);
    const ey = Math.min(height * .18, Math.abs(finite(bin.errorPpm) || 0) * .015 * dpr);
    ctx.beginPath(); ctx.moveTo(px, py - ey); ctx.lineTo(px, py + ey); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 2.7 * dpr, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawResidualPeriodogram(canvas, samples = []) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height, dpr } = prepared;
  const powers = periodogram(samples);
  drawFrame(ctx, width, height, dpr, powers.length ? "quick-look residual periodicity scan" : "periodogram waits for residual samples");
  if (!powers.length) return;
  const max = Math.max(1e-9, ...powers.map(p => p.power));
  const barWidth = (width - 60 * dpr) / powers.length;
  ctx.fillStyle = "rgba(120,166,255,.82)";
  powers.forEach((p, i) => {
    const h = (p.power / max) * (height - 50 * dpr);
    ctx.fillRect(34 * dpr + i * barWidth, height - 24 * dpr - h, Math.max(1, barWidth * .72), h);
  });
}

export function drawResidualCharts(container, samples = []) {
  requestAnimationFrame(() => {
    drawResidualScatter(container.querySelector("#residual-scatter-canvas"), samples);
    drawBinnedResiduals(container.querySelector("#residual-binned-canvas"), samples);
    drawResidualPeriodogram(container.querySelector("#residual-periodogram-canvas"), samples);
  });
}
