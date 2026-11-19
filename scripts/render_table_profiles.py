"""Render an accessible overview of archived CSV and TSV inputs."""

import argparse
import json
from urllib.parse import quote

from evidence_catalog import ROOT, read_bytes
from profile_evidence_tables import OUTPUT
from render_evidence_page import STYLES, escape

PAGE = 'table-evidence.html'


def numbers(column):
    if 'minimum' not in column:
        return '—'
    return f"{column['minimum']:.8g} to {column['maximum']:.8g}"


def table_section(table):
    rows = []
    for index, column in enumerate(table['columns'], 1):
        label = escape(column['name'] or f'Unnamed field {index}')
        blank = column['blank']
        nonfinite = column['nonfinite']
        flagged = blank + nonfinite
        percentage = 100 * flagged / table['rows'] if table['rows'] else 0
        rows.append(
            f'<tr><th scope="row">{label}</th><td>{column["finite"]:,}</td>'
            f'<td>{column["text"]:,}</td><td>{blank:,}</td><td>{nonfinite:,}</td>'
            f'<td><div class="coverage"><meter aria-label="Blank or non-finite percentage" '
            f'min="0" max="100" value="{percentage:.4f}"></meter>{percentage:.1f}%</div></td>'
            f'<td>{numbers(column)}</td></tr>'
        )
    label = escape(table['label'])
    url = quote(table['path'], safe='/')
    return (
        f'<section><h2>{label}</h2><p>{escape(table["role"])} · {table["rows"]:,} records · '
        f'{table["width_mismatches"]:,} records with a different field count from the header. '
        f'<a href="{url}" download>Download source table</a></p>'
        '<div class="table-scroll" tabindex="0" role="region" aria-label="Column statistics">'
        f'<table><caption class="sr-only">Column statistics for {label}</caption><thead><tr>'
        '<th scope="col">Field</th><th scope="col">Finite</th><th scope="col">Text</th>'
        '<th scope="col">Blank</th><th scope="col">Non-finite</th>'
        '<th scope="col">Blank or non-finite</th><th scope="col">Stored range</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table></div></section>'
    )


def render(profile):
    title = escape(profile['project'])
    sections = ''.join(table_section(table) for table in profile['tables'])
    exclusions = ''
    if profile['excluded']:
        items = ''.join(
            f'<li><code>{escape(item["path"])}</code> ({escape(item["reason"])})</li>'
            for item in profile['excluded']
        )
        exclusions = f'<section><h2>Tables outside the profile size limit</h2><ul>{items}</ul></section>'
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Table profiles</title>
<style>{STYLES}
section{{margin:1rem 0;background:white;border:1px solid #cdd6dc;border-radius:.65rem;padding:1rem}}
section h2{{margin-top:0}}th[scope="row"]{{overflow-wrap:anywhere}}tbody tr:nth-child(even){{background:#f1f3f4}}
.coverage{{display:flex;align-items:center;gap:.35rem;white-space:nowrap}}meter{{width:4rem}}
.sr-only{{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}
</style>
</head>
<body>
<main>
<header>
<nav aria-label="Publication links"><a href="evidence.html">Evidence catalogue</a> <a href="{OUTPUT}" download>Download JSON profile</a></nav>
<h1>{title}</h1>
<p>Column coverage and stored value ranges for {len(profile['tables'])} archived tables.</p>
</header>
<p>The bars show the fraction of records with a blank or non-finite value in each column. The report counts text labels separately. Ranges summarise stored finite values in columns without text. Refer to the source for units, measurement uncertainties and interpretation.</p>
{sections}
{exclusions}
</main>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--check-committed', action='store_true')
    args = parser.parse_args()
    data = json.loads(read_bytes(OUTPUT, args.check_committed))
    output = render(data).encode('utf-8')
    if args.check or args.check_committed:
        if read_bytes(PAGE, args.check_committed).replace(b'\r\n', b'\n') != output:
            parser.exit(1, 'Table profiles page differs. Run python scripts/render_table_profiles.py.\n')
    else:
        (ROOT / PAGE).write_bytes(output)


if __name__ == '__main__':
    main()
