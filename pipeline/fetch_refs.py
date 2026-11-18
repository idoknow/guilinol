"""Download landmark reference photos listed in pipeline/landmark-refs.json into raw/refs/<id>/.

Reference only: these photos are never committed, never shipped and never used as textures (docs/style.md).
Usage: uv run python pipeline/fetch_refs.py [landmark-id ...]
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = {'User-Agent': 'guilinol-reference-research/0.1'}

landmarks = json.loads((ROOT/'pipeline/landmark-refs.json').read_text())
wanted = set(sys.argv[1:])
for landmark in landmarks:
    if wanted and landmark['id'] not in wanted:
        continue
    folder = ROOT/'raw/refs'/landmark['id']
    folder.mkdir(parents=True, exist_ok=True)
    for index, ref in enumerate(landmark['refs']):
        target = folder/f"{index:02d}-{ref['year'] or 'na'}.jpg"
        if target.exists() or not ref.get('thumb'):
            continue
        for attempt in range(4):
            try:
                target.write_bytes(urllib.request.urlopen(urllib.request.Request(ref['thumb'], headers=UA), timeout=60).read())
                break
            except Exception as error:  # Commons throttles bursts; back off and retry.
                print('retry', ref['title'], error)
                time.sleep(10*(attempt+1))
        time.sleep(1.5)
    (folder/'index.json').write_text(json.dumps(landmark['refs'], ensure_ascii=False, indent=1))
    print(landmark['id'], len(landmark['refs']), 'refs →', folder.relative_to(ROOT))
