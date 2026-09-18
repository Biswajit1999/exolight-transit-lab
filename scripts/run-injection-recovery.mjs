import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runInjectionScenario } from "../src/analysis/injectionRecovery.js";

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, "data", "injection-recovery-scenarios.json"), "utf8"));
const results = config.scenarios.map(runInjectionScenario);
const white = results.find((item) => item.scenarioId === "deep-white");
const red = results.find((item) => item.scenarioId === "deep-red");
const coverageChange = Math.abs(red.iidCoverage95 - white.iidCoverage95);
const report = {
  schema: "exolight-injection-recovery-report-v1",
  generatedAt: null,
  generationPolicy: "Deterministic build; Git history records execution time.",
  researchQuestion: config.researchQuestion,
  nullHypothesis: config.nullHypothesis,
  nullThresholdAbsoluteCoverageChange: 0.10,
  observedAbsoluteCoverageChange: coverageChange,
  nullOutcome: coverageChange > 0.10 ? "rejected" : "not_rejected",
  results
};
const outputDir = path.join(root, "results", "injection-recovery");
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = [
  "scenario_id,depth_ppm,noise_ppm,rho,trials,bias_ppm,rmse_ppm,iid_coverage_95,cluster_coverage_95,iid_detection_rate_3sigma,cluster_detection_rate_3sigma",
  ...results.map((item) => [item.scenarioId,item.depthPpm,item.noisePpm,item.rho,item.trials,item.biasPpm,item.rmsePpm,item.iidCoverage95,item.clusterCoverage95,item.iidDetectionRate3Sigma,item.clusterDetectionRate3Sigma].join(","))
];
await writeFile(path.join(outputDir, "results.csv"), `${rows.join("\n")}\n`);
console.log(JSON.stringify({ nullOutcome: report.nullOutcome, observedAbsoluteCoverageChange: coverageChange, results }, null, 2));
