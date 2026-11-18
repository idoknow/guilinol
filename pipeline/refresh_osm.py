"""Refresh the handoff snapshot and report OSM element identity changes."""

import argparse
import json
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen


RAW = Path(__file__).resolve().parents[1] / 'raw'
NODES = ('  node["highway"~"^(crossing|traffic_signals|bus_stop|street_lamp)$"];\n'
         '  node["barrier"];\n')


def query():
    handoff = (RAW / 'q.txt').read_text()
    body, close, tail = handoff.rpartition(');')
    if not close or 'out body geom;' not in tail:
        raise ValueError('Unrecognized raw/q.txt; expected a union followed by out body geom')
    return body + NODES + close + tail


def identities(snapshot):
    return {(element['type'], element['id']) for element in snapshot['elements']}


def refresh(endpoint):
    request = Request(endpoint, urlencode({'data': query()}).encode(),
                      headers={'User-Agent': 'GuilinOL-world-pipeline/1.0'})
    with urlopen(request, timeout=150) as response:
        payload = response.read()
    snapshot = json.loads(payload)
    if snapshot.get('remark') or not snapshot.get('elements'):
        raise ValueError(f'Incomplete Overpass response: {snapshot.get("remark")}')
    stamp = datetime.fromisoformat(snapshot['osm3s']['timestamp_osm_base'].replace('Z', '+00:00'))
    if (stamp.year, stamp.month) != (2026, 11):
        raise ValueError(f'Expected November 2026 snapshot, received {stamp.isoformat()}')
    previous = identities(json.loads((RAW / 'osm.json').read_bytes()))
    current = identities(snapshot)
    with NamedTemporaryFile(dir=RAW, delete=False) as temp:
        temp.write(payload)
    Path(temp.name).replace(RAW / 'osm-2026-11.json')
    print(f'{stamp.isoformat()}: {len(previous)} → {len(current)}; '
          f'added {len(current - previous)}, removed {len(previous - current)}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint', default='https://overpass.private.coffee/api/interpreter')
    refresh(parser.parse_args().endpoint)
