import { useExoStore } from "../state/useExoStore";
export function DataConsoleDock(){ const lines=useExoStore(s=>s.console); return <section className="panel console-panel"><h2>Data Console</h2><div className="console">{lines.map((l,i)=><div key={i} className={l.level}><span>{l.time}</span> {l.text}</div>)}</div></section>; }
