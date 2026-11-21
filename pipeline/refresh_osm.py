"""Refresh the handoff snapshot and report OSM element identity changes."""

import argparse
import json
import re
import time
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


def fetch_shards(endpoint, template, pause=10):
    match = re.search(r'\[bbox:([^\]]+)\]', template)
    if not match or '[date:' not in template:
        raise ValueError('Expected a dated regional bbox query')
    south, west, north, east = map(float, match[1].split(','))
    elements = {}
    for index in range(9):
        row, col = divmod(index, 3)
        bounds = (south + row*(north-south)/3, west + col*(east-west)/3,
                  south + (row+1)*(north-south)/3, west + (col+1)*(east-west)/3)
        bbox = ','.join(f'{value:.8f}' for value in bounds)
        shard = template[:match.start(1)] + bbox + template[match.end(1):]
        if index:
            time.sleep(pause)
        request = Request(endpoint, urlencode({'data': shard}).encode(),
                          headers={'User-Agent': 'GuilinOL-world-pipeline/1.0'})
        with urlopen(request, timeout=300) as response:
            snapshot = json.load(response)
        if snapshot.get('remark') or not isinstance(snapshot.get('elements'), list):
            raise ValueError(f'Incomplete Overpass shard {index+1}: {snapshot.get("remark")}')
        for element in snapshot['elements']:
            key = element['type'], element['id']
            previous = elements.setdefault(key, element)
            if previous != element:
                raise ValueError(f'Conflicting geometries in dated snapshot for {key}')
    if not elements:
        raise ValueError('Empty regional Overpass result')
    # Query time and server version can differ between runs of the dated query.
    return json.dumps({'elements': [elements[key] for key in sorted(elements)]},
                      ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def identities(snapshot):
    return {(element['type'], element['id']) for element in snapshot['elements']}


def refresh(endpoint):
    template = query()
    if '[date:' in template:
        payload = fetch_shards(endpoint, template)
        with NamedTemporaryFile(dir=RAW, delete=False) as temp:
            temp.write(payload)
        Path(temp.name).replace(RAW / 'osm-2026-11.json')
        return
    request = Request(endpoint, urlencode({'data': template}).encode(),
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
    parser.add_argument('--endpoint', default='https://maps.mail.ru/osm/tools/overpass/api/interpreter')
    refresh(parser.parse_args().endpoint)
