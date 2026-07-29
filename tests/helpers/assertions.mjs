export function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} is not finite: ${value}`);
  }
}

export function assertWithin(actual, expected, tolerance, label) {
  assertFinite(actual, label);
  const difference = Math.abs(actual - expected);
  if (difference > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
  }
}

export function assertAtMost(actual, maximum, label) {
  assertFinite(actual, label);
  if (actual > maximum) {
    throw new Error(`${label}: expected <= ${maximum}, received ${actual}`);
  }
}

export function assertNearZero(value, tolerance, label) {
  assertWithin(value, 0, tolerance, label);
}

export function assertArrayFinite(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }

  values.forEach((value, index) => {
    assertFinite(value, `${label}[${index}]`);
  });
}

export function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

export function recordAssertion(assertions, label, fn) {
  try {
    fn();
    assertions.push({ label, passed: true });
  } catch (error) {
    assertions.push({ label, passed: false, message: error.message });
  }
}
