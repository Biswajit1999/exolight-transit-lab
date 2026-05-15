import json, requests
from pathlib import Path
NASA='https://exoplanetarchive.ipac.caltech.edu/TAP/sync'
OUT=Path('data/bootstrap-targets.json')
QUERY='''SELECT TOP 250 pl_name, hostname, pl_orbper, pl_trandep, pl_trandur, pl_ratror, pl_ratdor, pl_orbincl, pl_orbeccen, pl_orblper, st_teff, st_rad, st_lum, sy_vmag FROM pscomppars WHERE tran_flag = 1 AND pl_ratror IS NOT NULL AND pl_ratdor IS NOT NULL AND sy_vmag < 12 ORDER BY pl_trandep DESC'''
r=requests.get(NASA,params={'query':QUERY,'format':'json'},timeout=120);r.raise_for_status();OUT.parent.mkdir(exist_ok=True);OUT.write_text(json.dumps(r.json(),indent=2),encoding='utf-8');print('Wrote',OUT)
