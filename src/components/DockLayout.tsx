import { DataConsoleDock } from "./DataConsoleDock";
import { FitQualityDock } from "./FitQualityDock";
import { LightCurveDock } from "./LightCurveDock";
import { ManualFitDock } from "./ManualFitDock";
import { OrreryDock } from "./OrreryDock";
import { PhaseFoldDock } from "./PhaseFoldDock";
import { ResidualDock } from "./ResidualDock";
import { SpectralFilterDock } from "./SpectralFilterDock";
import { TargetDock } from "./TargetDock";
import { TelemetryDock } from "./TelemetryDock";

export function DockLayout() {
  return <div className="obsidian-prime">
    <header className="top-dock">
      <div><p className="eyebrow">EXOINTEL-PRIME / TRANSIT INTELLIGENCE SYSTEM</p><h1>Exoplanetary Analysis Laboratory</h1></div>
      <div className="mission-readout"><span>NASA TAP</span><span>MAST Photometry</span><span>GPU Transit Engine</span></div>
    </header>
    <aside className="dock dock-left"><TargetDock/><SpectralFilterDock/><ManualFitDock/></aside>
    <main className="dock-center"><OrreryDock/><LightCurveDock/><div className="lower-grid"><ResidualDock/><PhaseFoldDock/></div></main>
    <aside className="dock dock-right"><TelemetryDock/><FitQualityDock/><DataConsoleDock/></aside>
    <footer className="credit-strip">Created by <b>Biswajit Jana</b> · © 2026 · ExoIntel-Prime</footer>
  </div>;
}
