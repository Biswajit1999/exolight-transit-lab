export function nonlinearLimbIntensity(mu: number, c: [number, number, number, number]): number {
  const m = Math.max(0, Math.min(1, mu));
  return Math.max(0,
    1
    - c[0] * (1 - Math.sqrt(m))
    - c[1] * (1 - m)
    - c[2] * (1 - m * Math.sqrt(m))
    - c[3] * (1 - m * m)
  );
}

export function radialIntensity(r: number, limb: [number, number, number, number]): number {
  const mu = Math.sqrt(Math.max(0, 1 - r * r));
  return nonlinearLimbIntensity(mu, limb);
}
