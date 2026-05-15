import { useExoStore } from "../state/useExoStore";
import { fetchArchiveTargets } from "../data/nasaArchive";

export function TargetDock() {
  const targets = useExoStore(s => s.targets);
  const selectedIndex = useExoStore(s => s.selectedIndex);
  const setTargets = useExoStore(s => s.setTargets);
  const setSelectedIndex = useExoStore(s => s.setSelectedIndex);
  const pushConsole = useExoStore(s => s.pushConsole);

  async function liveNASA() {
    try { pushConsole("warn", "Requesting live NASA Exoplanet Archive target list"); const t = await fetchArchiveTargets(); setTargets(t); setSelectedIndex(0); pushConsole("ok", `NASA TAP returned ${t.length} targets`); }
    catch (e) { pushConsole("bad", `NASA TAP failed in browser: ${String(e)}`); }
  }

  return <section className="panel"><h2>Target List</h2>
    <button onClick={liveNASA} className="arm-button">Initialize NASA TAP</button>
    <select value={selectedIndex} onChange={e => setSelectedIndex(Number(e.target.value))}>
      {targets.map((t,i)=><option key={`${t.pl_name}-${i}`} value={i}>{t.pl_name} · {Math.round(t.transit_depth_ppm)} ppm</option>)}
    </select>
    <p className="microcopy">Bundled bootstrap targets are included. Run <code>python scripts/build-target-list.py</code> to populate 200+ candidates.</p>
  </section>;
}
