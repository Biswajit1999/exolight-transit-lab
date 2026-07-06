import { validatePhysicsCore } from "../src/physics/validation.js";

const report = validatePhysicsCore();
console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  console.error("Physics validation failed.");
  process.exitCode = 1;
}
