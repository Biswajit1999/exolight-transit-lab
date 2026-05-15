export const GOLD_SQL = `SELECT TOP 150
    pl_name, hostname, pl_orbper, pl_trandep, pl_trandur, pl_ratror, pl_ratdor,
    pl_orbincl, pl_orbeccen, pl_orblper, st_teff, st_rad, st_lum, sy_vmag
FROM pscomppars
WHERE
    tran_flag = 1 AND
    pl_ratror IS NOT NULL AND
    pl_ratdor IS NOT NULL AND
    sy_vmag < 12
ORDER BY pl_trandep DESC`;
export async function fetchNASA(log){log("NASA TAP browser request started","warn");const res=await fetch("https://exoplanetarchive.ipac.caltech.edu/TAP/sync?"+new URLSearchParams({query:GOLD_SQL,format:"json"}),{headers:{Accept:"application/json"}});if(!res.ok)throw new Error("NASA TAP HTTP "+res.status);return await res.json();}
export async function loadBootstrap(){const res=await fetch("data/bootstrap-targets.json",{cache:"no-store"});if(!res.ok)throw new Error("Missing data/bootstrap-targets.json");return await res.json();}
export function normalize(row){const n={};for(const[k,v]of Object.entries(row)){const x=Number(v);n[k]=Number.isFinite(x)&&v!==""?x:v}const rp=n.pl_ratror||Math.sqrt((n.pl_trandep||1000)/1e6),a=n.pl_ratdor||10;return{pl_name:String(n.pl_name||"Unknown planet"),hostname:String(n.hostname||"Unknown star"),period:Number(n.pl_orbper||3),depth:Number(n.pl_trandep||rp*rp*1e6),duration:Number(n.pl_trandur||2),rpRs:Number(rp),aRs:Number(a),inc:Number(n.pl_orbincl||88),ecc:Number(n.pl_orbeccen||0),omega:Number(n.pl_orblper||90),teff:Number(n.st_teff||5772),radius:Number(n.st_rad||1),lum:Number(n.st_lum||0),vmag:Number(n.sy_vmag||12)}}
