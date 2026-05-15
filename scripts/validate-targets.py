import json
from pathlib import Path
p = Path("public/targets.json")
rows = json.loads(p.read_text(encoding="utf-8"))
required = ["pl_name", "period_days", "rp_rs", "a_rs", "inclination_deg"]
missing = []
for i, row in enumerate(rows):
    for key in required:
        if row.get(key) in (None, ""):
            missing.append((i, key))
if missing:
    raise SystemExit(f"Missing required fields: {missing[:10]}")
print(f"Validated {len(rows)} targets.")
