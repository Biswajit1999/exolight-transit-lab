"""Describe column coverage and numerical ranges in the archived data tables."""

import argparse
import csv
import io
import json
import math
from pathlib import PurePosixPath

from evidence_catalog import ROOT, read_bytes

MANIFEST = 'evidence/manifest.json'
OUTPUT = 'evidence/table-profiles.json'
MAX_BYTES = 2_000_000


def profile_table(item, committed):
    path = item['path']
    source = io.StringIO(read_bytes(path, committed).decode('utf-8-sig'), newline='')
    delimiter = '\t' if PurePosixPath(path).suffix.lower() == '.tsv' else ','
    rows = csv.reader(source, delimiter=delimiter, strict=True)
    headers = next(rows, [])
    columns = [dict(name=name, blank=0, text=0, finite=0, nonfinite=0) for name in headers]
    count = 0
    width_mismatches = 0
    for row in rows:
        if not row:
            continue
        count += 1
        width_mismatches += len(row) != len(headers)
        for index, column in enumerate(columns):
            cell = row[index].strip() if index < len(row) else ''
            if not cell:
                column['blank'] += 1
                continue
            try:
                value = float(cell)
            except ValueError:
                column['text'] += 1
                continue
            if not math.isfinite(value):
                column['nonfinite'] += 1
                continue
            column['finite'] += 1
            column['minimum'] = min(value, column.get('minimum', value))
            column['maximum'] = max(value, column.get('maximum', value))
    for column in columns:
        if column['text']:
            column.pop('minimum', None)
            column.pop('maximum', None)
    return {
        'path': path,
        'label': item['label'],
        'role': item['role'],
        'rows': count,
        'width_mismatches': width_mismatches,
        'columns': columns,
    }


def profile(committed=False):
    manifest = json.loads(read_bytes(MANIFEST, committed))
    tables = []
    excluded = []
    for item in manifest['files']:
        if item['format'] not in {'CSV', 'TSV'}:
            continue
        if item['bytes'] > MAX_BYTES:
            excluded.append({'path': item['path'], 'reason': 'larger than 2,000,000 bytes'})
            continue
        tables.append(profile_table(item, committed))
    return {'schema': 1, 'project': manifest['project'], 'tables': tables, 'excluded': excluded}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--check-committed', action='store_true')
    args = parser.parse_args()
    payload = (json.dumps(profile(args.check_committed), indent=2, ensure_ascii=False) + '\n').encode()
    if args.check or args.check_committed:
        current = read_bytes(OUTPUT, args.check_committed).replace(b'\r\n', b'\n')
        if current != payload:
            parser.exit(1, 'Table profiles differ. Run python scripts/profile_evidence_tables.py.\n')
    else:
        (ROOT / OUTPUT).write_bytes(payload)


if __name__ == '__main__':
    main()
