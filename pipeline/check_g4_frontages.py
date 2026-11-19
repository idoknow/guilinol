"""Snapshot/compare procedural footprints at the six G4 school boundaries."""
import argparse
import hashlib
import json
from pathlib import Path

from shapely import STRtree, box, normalize, to_wkb

from common import X0, X1, Z0, Z1, load_osm
from features import area, buildings
from landmark_layout import Layout


SCHOOLS = (647468198, 1001796191, 1494945227, 1476020022, 1487482928, 646911647)


def snapshot():
    elements = {entry['id']: entry for entry in load_osm() if entry['type'] == 'way'}
    bounds = box(X0, Z0, X1, Z1)
    footprints, _ = buildings(bounds, lambda east, south: 0, STRtree([]), Layout())
    tree = STRtree(footprints)
    result = {}
    for school in SCHOOLS:
        frontage = area(elements[school]).buffer(20).intersection(bounds)
        matches = tree.query(frontage, predicate='intersects')
        if not len(matches):
            raise ValueError(f'No baseline buildings around school way/{school}')
        shapes = sorted(hashlib.sha256(to_wkb(normalize(footprints[index]), byte_order=1)).digest()
                        for index in matches)
        result[str(school)] = dict(count=len(shapes), sha256=hashlib.sha256(b''.join(shapes)).hexdigest())
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--record', type=Path)
    group.add_argument('--compare', type=Path)
    args = parser.parse_args()
    current = snapshot()
    if args.record:
        args.record.write_text(json.dumps(current, indent=2) + '\n')
    else:
        expected = json.loads(args.compare.read_text())
        if expected != current:
            changed = sorted(key for key in expected.keys() | current.keys() if expected.get(key) != current.get(key))
            raise SystemExit(f'Building footprints changed: {changed}')
        print(f'Unchanged procedural footprints at all {len(current)} G4 schools')
