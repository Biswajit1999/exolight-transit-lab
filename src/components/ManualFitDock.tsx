import { useExoStore } from "../state/useExoStore";

function Slider({label,value,min,max,step,onChange}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void}){
  return <label className="control"><span>{label}</span><b>{value.toFixed(step < 0.01 ? 4 : 2)}</b><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}

export function ManualFitDock(){
  const fit=useExoStore(s=>s.fit); const patch=useExoStore(s=>s.setFitPatch);
  if(!fit) return <section className="panel"><h2>Manual Fit</h2><p>No target selected.</p></section>;
  return <section className="panel"><h2>Manual Fit</h2>
    <Slider label="Rp/Rs" value={fit.rpRs} min={0.005} max={0.35} step={0.001} onChange={rpRs=>patch({rpRs})}/>
    <Slider label="a/Rs" value={fit.aRs} min={2} max={80} step={0.1} onChange={aRs=>patch({aRs})}/>
    <Slider label="Inclination" value={fit.inclinationDeg} min={70} max={90} step={0.01} onChange={inclinationDeg=>patch({inclinationDeg})}/>
    <Slider label="Eccentricity" value={fit.eccentricity} min={0} max={0.95} step={0.001} onChange={eccentricity=>patch({eccentricity})}/>
    <Slider label="ω" value={fit.omegaDeg} min={0} max={360} step={0.1} onChange={omegaDeg=>patch({omegaDeg})}/>
    <label className="switch"><input type="checkbox" checked={fit.starspotEnabled} onChange={e=>patch({starspotEnabled:e.target.checked})}/> active-region photometry</label>
  </section>;
}
