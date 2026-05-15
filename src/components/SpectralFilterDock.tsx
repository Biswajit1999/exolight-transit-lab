import { useExoStore } from "../state/useExoStore";
import { applySpectralPreset } from "../physics/fitting";
import type { SpectralFilter } from "../types";

export function SpectralFilterDock(){
  const filter=useExoStore(s=>s.spectralFilter); const setFilter=useExoStore(s=>s.setSpectralFilter); const patch=useExoStore(s=>s.setFitPatch);
  function choose(f:SpectralFilter){ setFilter(f); patch({limb:applySpectralPreset(f)}); }
  return <section className="panel"><h2>Spectral Overlay</h2><div className="segmented">
    {(["VISUAL","IR","UV"] as SpectralFilter[]).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>choose(f)}>{f}</button>)}
  </div><p className="microcopy">Filter presets modify the four-parameter limb darkening law and immediately alter the transit model.</p></section>;
}
