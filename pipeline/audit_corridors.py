"""Report plan intersections and headroom along the configured travel corridors."""
import argparse
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
from shapely import LineString, Polygon, STRtree, box, get_parts, make_valid
from common import OUT
from landmarks.world_surface import Surface


def audit(output):
    corridors = json.loads(Path(__file__).with_name('region.json').read_bytes())['corridors']
    lines = [LineString(route['geometry']['coordinates']) for route in corridors]
    tree = STRtree(lines)
    manifest = json.loads((output/'manifest.json').read_bytes())
    ground = Surface(output, manifest)
    hits = []

    def check(footprint, bottom, routes, source):
        for r in routes:
            overlap = footprint.intersection(lines[r])
            if overlap.is_empty:
                continue
            heights = []
            for part in get_parts(overlap):
                steps = max(1, math.ceil(part.length/.25))
                for t in np.linspace(0, 1, steps+1):
                    p = part if part.geom_type == 'Point' else part.interpolate(t, normalized=True)
                    heights.append(ground.sample(p.x, p.y)[0])
            route = corridors[r]
            clearance = bottom-max(heights)
            hits.append(dict(source=source, mode=route['mode'], start=route['start'], end=route['end'],
                             xz=overlap.representative_point().coords[0], metres=round(overlap.length, 2),
                             minHeadroom=round(clearance, 2), blocked=clearance < 2))

    for tile in manifest['chunks']:
        x, z = tile['x'], tile['z']
        routes = sorted(tree.query(box(x, z, x+256, z+256), predicate='intersects'))
        if not routes:
            continue
        data = gzip.decompress((output/tile['file']).read_bytes())
        vertices, indices, size = struct.unpack_from('<3I', data, 4)
        start = 24 + 16900 + 9*vertices + 4*indices
        for i, row in enumerate(json.loads(data[start:start+size])[0]):
            shell, *holes = [np.array(ring)/100 + (x,z) for ring in row[2]]
            check(make_valid(Polygon(shell, holes)), row[0]/10, routes, f"{tile['file']}#{i}")
    for landmark in manifest['landmarks']:
        for i, (bottom, _, shell) in enumerate(landmark.get('solid', [])):
            poly = Polygon(shell)
            check(poly, bottom, tree.query(poly, predicate='intersects'), f"{landmark['id']}#{i}")
    return hits


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', nargs='?', type=Path, default=Path(OUT))
    hits = audit(parser.parse_args().world)
    print(json.dumps(hits, ensure_ascii=False, indent=2))
    raise SystemExit(int(any(hit['blocked'] for hit in hits)))
