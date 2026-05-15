import { useEffect, useRef } from "react";
import { OrreryView } from "../render/OrreryView";
import { useExoStore } from "../state/useExoStore";

export function OrreryDock(){
  const canvasRef=useRef<HTMLCanvasElement|null>(null); const view=useRef<OrreryView|null>(null);
  const target=useExoStore(s=>s.selectedTarget); const fit=useExoStore(s=>s.fit); const phase=useExoStore(s=>s.phaseCursor);
  useEffect(()=>{ if(canvasRef.current && !view.current) view.current=new OrreryView(canvasRef.current); return()=>view.current?.dispose();},[]);
  useEffect(()=>{ if(target&&fit) view.current?.setTarget(target,fit);},[target,fit?.period]);
  useEffect(()=>{ if(fit) view.current?.updateFit(fit);},[fit]);
  useEffect(()=>{ view.current?.setPhase(phase+0.5);},[phase]);
  return <section className="panel hero-panel"><div className="panel-header"><h2>3D Orrery View</h2><span>true units: AU / R★ scaled</span></div><canvas ref={canvasRef}/></section>;
}
