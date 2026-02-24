#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GPU Quota Audit — lists all GPU quota > 0 across all global regions
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./gpu-quota-audit.sh                          # defaults to project "lumen-pipeline"
#   ./gpu-quota-audit.sh --project=my-project     # specify project
#   ./gpu-quota-audit.sh --output=my-report.txt   # custom output file
#   ./gpu-quota-audit.sh --min-limit=2            # only show quota >= 2
#   ./gpu-quota-audit.sh --filter=A100,L40S,RTX   # only show GPUs matching these strings
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="lumen-pipeline"
OUTPUT="gpu-quota-audit.txt"
MIN_LIMIT=1
FILTER=""

for arg in "$@"; do
  case $arg in
    --project=*) PROJECT="${arg#*=}" ;;
    --output=*)  OUTPUT="${arg#*=}" ;;
    --min-limit=*) MIN_LIMIT="${arg#*=}" ;;
    --filter=*) FILTER="${arg#*=}" ;;
    --help)
      echo "Usage: ./gpu-quota-audit.sh [--project=ID] [--output=FILE] [--min-limit=N] [--filter=A100,L40S]"
      exit 0
      ;;
  esac
done

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  GPU Quota Audit                                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Project:    $PROJECT"
echo "  Output:     $OUTPUT"
echo "  Min limit:  $MIN_LIMIT"
echo "  Filter:     ${FILTER:-<none — showing all GPUs>}"
echo ""

echo "Fetching all regions..."
ALL_REGIONS=$(gcloud compute regions list --project="$PROJECT" --format="json(name,quotas)" 2>/dev/null)

echo "Analyzing quotas..."
python3 -c "
import json, sys
from datetime import datetime, timezone

regions = json.loads('''$( echo "$ALL_REGIONS" )''')
min_limit = $MIN_LIMIT
filter_str = '$FILTER'
filters = [f.strip().upper() for f in filter_str.split(',') if f.strip()] if filter_str else []

# Collect all GPU quota entries with limit > 0
rows = []
for r in regions:
    name = r.get('name', '')
    for q in r.get('quotas', []):
        m = q['metric']
        limit = int(q['limit'])
        usage = int(q['usage'])
        if 'GPU' not in m:
            continue
        if limit < min_limit:
            continue
        if filters and not any(f in m for f in filters):
            continue
        rows.append((name, m, limit, usage))

# Sort: region, then metric
rows.sort(key=lambda x: (x[0], x[1]))

# Determine column widths
col_region = max((len(r[0]) for r in rows), default=10)
col_metric = max((len(r[1]) for r in rows), default=30)

# Build output
lines = []
lines.append('=' * 120)
lines.append(f'GPU QUOTA AUDIT — Project: {\"$PROJECT\"}')
lines.append(f'Generated: {datetime.now(timezone.utc).strftime(\"%Y-%m-%d %H:%M:%S UTC\")}')
lines.append(f'Min limit filter: {min_limit}')
if filters:
    lines.append(f'GPU filter: {filters}')
lines.append(f'Total entries: {len(rows)}')
lines.append('=' * 120)
lines.append('')

# Summary: unique GPU types with max limit across all regions
lines.append('─' * 80)
lines.append('SUMMARY: Unique GPU types found (max limit across all regions)')
lines.append('─' * 80)
gpu_summary = {}
for _, m, limit, usage in rows:
    # Strip PREEMPTIBLE_ and COMMITTED_ prefixes for grouping
    clean = m.replace('PREEMPTIBLE_', '').replace('COMMITTED_', '')
    if clean not in gpu_summary:
        gpu_summary[clean] = {'max_limit': 0, 'regions': set(), 'variants': set()}
    gpu_summary[clean]['max_limit'] = max(gpu_summary[clean]['max_limit'], limit)
    gpu_summary[clean]['regions'].add(_)
    gpu_summary[clean]['variants'].add(m)

for gpu in sorted(gpu_summary.keys()):
    info = gpu_summary[gpu]
    region_count = len(info['regions'])
    variant_count = len(info['variants'])
    unlimited = '(UNLIMITED)' if info['max_limit'] >= 9999999 else f'max_limit={info[\"max_limit\"]}'
    lines.append(f'  {gpu:50s} {unlimited:20s} in {region_count} region(s)')

lines.append('')

# Detailed table by region
lines.append('─' * 120)
lines.append(f'{\"REGION\":<{col_region+2}} {\"GPU METRIC\":<{col_metric+2}} {\"LIMIT\":>8}  {\"USED\":>8}  {\"AVAILABLE\":>10}  NOTES')
lines.append('─' * 120)

current_region = ''
for region, metric, limit, usage in rows:
    if region != current_region:
        if current_region:
            lines.append('')
        current_region = region

    avail = limit - usage
    notes = []
    if limit >= 9999999:
        limit_str = 'UNLIM'
        avail_str = 'UNLIM'
        notes.append('UNLIMITED')
    else:
        limit_str = str(limit)
        avail_str = str(avail)

    if usage > 0:
        notes.append(f'{usage} in use')
    if 'PREEMPTIBLE' in metric:
        notes.append('preemptible/spot')
    if 'COMMITTED' in metric:
        notes.append('committed use')
    if 'VWS' in metric:
        notes.append('virtual workstation')

    note_str = ', '.join(notes)
    lines.append(f'{region:<{col_region+2}} {metric:<{col_metric+2}} {limit_str:>8}  {usage:>8}  {avail_str:>10}  {note_str}')

lines.append('')
lines.append('=' * 120)
lines.append('END OF REPORT')
lines.append('=' * 120)

output = '\n'.join(lines)
print(output)

with open('$OUTPUT', 'w') as f:
    f.write(output + '\n')
"

echo ""
echo "✅ Report written to: $OUTPUT"
echo ""
