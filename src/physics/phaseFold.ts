export function phaseFold(time: Float64Array, period: number, t0: number): Float32Array {
  const phase = new Float32Array(time.length);
  for (let i = 0; i < time.length; i++) {
    let p = ((time[i] - t0) / period) % 1;
    if (p < 0) p += 1;
    if (p > 0.5) p -= 1;
    phase[i] = p;
  }
  return phase;
}
