"""Find candidate pedestrian tracks strictly inside existing GL04 sidewalk faces."""
import argparse
import gzip
import json
import struct
from pathlib import Path

import shapely
from shapely import LineString, Polygon, STRtree


SEARCH_METRES = 15
BODY_CLEARANCE = .35
MAJOR = {'primary', 'trunk', 'secondary'}


def sidewalk_faces(directory, manifest):
    for tile in manifest['chunks']:
        data = gzip.decompress((directory / tile['file']).read_bytes())
        magic, vertices, indices, size = struct.unpack_from('<4s3I', data)
        if magic != b'GL04':
            raise ValueError(tile['file'])
        offset = 24 + 4 * (manifest['chunkSize'] // manifest['grid'] + 1)**2 + 9*vertices + 4*indices
        streets = json.loads(data[offset:offset+size])[1]
        for kind, *rings in streets[0]:
            if kind not in (1, 4, 6):
                continue
            shell, *holes = [[(tile['x']+east/100, tile['z']+south/100) for east, south in ring] for ring in rings]
            for part in shapely.get_parts(shapely.make_valid(Polygon(shell, holes))):
                if part.geom_type == 'Polygon':
                    yield part


def derive(center, surface, half_width):
    safe = surface.difference(center.buffer(half_width, cap_style='flat')).buffer(-BODY_CLEARANCE)
    for sign in (-1, 1):
        best = []
        for index in range(1, int(2*(SEARCH_METRES-half_width))+1):
            candidate = center.offset_curve(sign*(half_width+index*.5))
            clipped = [part for part in shapely.get_parts(candidate.intersection(safe))
                       if part.geom_type == 'LineString' and part.length >= 2]
            if sum(part.length for part in clipped) > sum(part.length for part in best):
                best = clipped
        yield from best


def audit(directory):
    manifest = json.loads((directory/'manifest.json').read_bytes())
    faces = STRtree(list(sidewalk_faces(directory, manifest)))
    roads = json.loads(gzip.decompress((directory/'roads/graph.json.gz').read_bytes()))
    nodes = {node['id']: (node['x'], node['z']) for node in roads['nodes']}
    segments = {}
    for lane in roads['lanes']:
        if lane['kind'] == 'motor' and lane['cls'].removesuffix('_link') in MAJOR:
            segments.setdefault(tuple(sorted((lane['from'], lane['to']))), []).append(lane)
    for ends, lanes in segments.items():
        line = LineString([nodes[node] for node in ends])
        hits = faces.query(line, predicate='dwithin', distance=SEARCH_METRES)
        width = max(abs(lane['offset'])+lane['width']/2 for lane in lanes)
        tracks = list(derive(line, shapely.union_all(faces.geometries.take(hits)), width)) if len(hits) else []
        yield dict(lane=lanes[0]['id'], midpoint=list(line.centroid.coords[0]), length=line.length,
                   tileSidewalk=bool(len(hits)), tracks=[list(track.coords) for track in tracks])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    parser.add_argument('report', type=Path)
    options = parser.parse_args()
    options.report.write_text(json.dumps(list(audit(options.world)), separators=(',', ':')))
