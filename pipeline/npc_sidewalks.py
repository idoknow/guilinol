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


def tile_polygons(directory, manifest, kinds):
    for tile in manifest['chunks']:
        data = gzip.decompress((directory / tile['file']).read_bytes())
        magic, vertices, indices, size = struct.unpack_from('<4s3I', data)
        if magic != b'GL04':
            raise ValueError(tile['file'])
        offset = 24 + 4 * (manifest['chunkSize'] // manifest['grid'] + 1)**2 + 9*vertices + 4*indices
        streets = json.loads(data[offset:offset+size])[1]
        shapes = []
        for kind, *rings in streets[0]:
            # Only true outer sidewalks (1) and tactile paving (6); never planting/median verges (4).
            if kind not in kinds:
                continue
            shell, *holes = [[(tile['x']+east/100, tile['z']+south/100) for east, south in ring] for ring in rings]
            for part in shapely.get_parts(shapely.make_valid(Polygon(shell, holes))):
                if part.geom_type == 'Polygon':
                    shapes.append((kind, part))
        yield shapes


def sidewalk_faces(directory, manifest):
    for shapes in tile_polygons(directory, manifest, (0, 1, 5, 6)):
        allowed, blocked = [], []
        for kind, part in shapes:
            (allowed if kind in (1, 6) else blocked).append(part)
        yield from (part for part in shapely.get_parts(shapely.union_all(allowed).difference(shapely.union_all(blocked)))
                    if part.geom_type == 'Polygon')


def _is_between_motors(line, motor_lines, max_span=10.0):
    coords = list(line.coords)
    if len(coords) < 2:
        return False
    mid = line.interpolate(0.5, normalized=True)
    mx, mz = mid.x, mid.y
    dx = coords[-1][0] - coords[0][0]
    dz = coords[-1][1] - coords[0][1]
    length = (dx * dx + dz * dz) ** 0.5
    if length < 1e-6:
        return False
    dx /= length
    dz /= length
    pos_d = float('inf')
    neg_d = float('inf')
    for mline, half_w in motor_lines:
        mcoords = list(mline.coords)
        mdx = mcoords[-1][0] - mcoords[0][0]
        mdz = mcoords[-1][1] - mcoords[0][1]
        mlen = (mdx * mdx + mdz * mdz) ** 0.5
        if mlen < 1e-6:
            continue
        mdx /= mlen
        mdz /= mlen
        if abs(mdx * dx + mdz * dz) < 0.72:
            continue
        ex = mx - mcoords[0][0]
        ez = mz - mcoords[0][1]
        along = ex * mdx + ez * mdz
        if along < -2.0 or along > mlen + 2.0:
            continue
        signed = ex * dz - ez * dx
        edge = abs(signed) - half_w
        if signed > 0 and edge < pos_d:
            pos_d = edge
        elif signed < 0 and edge < neg_d:
            neg_d = edge
    return pos_d < max_span and neg_d < max_span


def derive(center, surface, half_width, motor_exclusions=None, motor_lines=()):
    exclusions = center.buffer(half_width, cap_style='flat')
    if motor_exclusions is not None and not motor_exclusions.is_empty:
        exclusions = shapely.union_all([exclusions, motor_exclusions])
    safe = surface.difference(exclusions).buffer(-BODY_CLEARANCE)
    if safe.is_empty:
        return
    start, end = center.coords
    east, south = ((end[axis]-start[axis])/center.length for axis in (0, 1))
    extended = LineString([(start[0]-SEARCH_METRES*east, start[1]-SEARCH_METRES*south),
                           (end[0]+SEARCH_METRES*east, end[1]+SEARCH_METRES*south)])
    for sign in (-1, 1):
        best = []
        for index in range(1, int(2*(SEARCH_METRES-half_width))+1):
            candidate = center.offset_curve(sign*(half_width+index*.5))
            clipped = [part for part in shapely.get_parts(candidate.intersection(safe))
                       if part.geom_type == 'LineString' and part.length >= 2
                       and not _is_between_motors(part, motor_lines)]
            if sum(part.length for part in clipped) > sum(part.length for part in best):
                best = clipped
        yield from best
        if not best:
            margin = safe.intersection(center.buffer(SEARCH_METRES))
            for index in range(1, int(2*(SEARCH_METRES-half_width))+1):
                candidate = extended.offset_curve(sign*(half_width+index*.5))
                clipped = [part for part in shapely.get_parts(candidate.intersection(margin))
                           if part.geom_type == 'LineString' and part.length >= 2
                           and not _is_between_motors(part, motor_lines)]
                if sum(part.length for part in clipped) > sum(part.length for part in best):
                    best = clipped
            yield from best


def audit(directory, manifest=None):
    if manifest is None:
        manifest = json.loads((directory/'manifest.json').read_bytes())
    faces = STRtree(list(sidewalk_faces(directory, manifest)))
    roads = json.loads(gzip.decompress((directory/'roads/graph.json.gz').read_bytes()))
    nodes = {node['id']: (node['x'], node['z']) for node in roads['nodes']}
    all_motor_geoms = []
    all_motor_meta = []
    for lane in roads['lanes']:
        if lane['kind'] not in ('motor', 'bus'):
            continue
        a, b = nodes[lane['from']], nodes[lane['to']]
        length = ((b[0]-a[0])**2 + (b[1]-a[1])**2) ** 0.5
        if length < 0.5:
            continue
        dx, dz = (b[0]-a[0])/length, (b[1]-a[1])/length
        off = lane.get('offset', 0.0)
        half_w = lane.get('width', 3.0) / 2.0
        mline = LineString([(a[0]-dz*off, a[1]+dx*off), (b[0]-dz*off, b[1]+dx*off)])
        all_motor_geoms.append(mline.buffer(half_w, cap_style='flat'))
        all_motor_meta.append((mline, half_w))
    motor_tree = STRtree(all_motor_geoms) if all_motor_geoms else None
    segments = {}
    for lane in roads['lanes']:
        if lane['kind'] == 'motor' and lane['cls'].removesuffix('_link') in MAJOR:
            segments.setdefault(tuple(sorted((lane['from'], lane['to']))), []).append(lane)
    for ends, lanes in segments.items():
        line = LineString([nodes[node] for node in ends])
        hits = faces.query(line, predicate='dwithin', distance=SEARCH_METRES)
        width = max(abs(lane['offset'])+lane['width']/2 for lane in lanes)
        if len(hits):
            if motor_tree is not None:
                mhits = motor_tree.query(line, predicate='dwithin', distance=SEARCH_METRES + 12)
                motor_excl = shapely.union_all(motor_tree.geometries.take(mhits)) if len(mhits) else None
                near_lines = [all_motor_meta[int(idx)] for idx in mhits]
            else:
                motor_excl, near_lines = None, ()
            tracks = list(derive(line, shapely.union_all(faces.geometries.take(hits)), width, motor_excl, near_lines))
        else:
            tracks = []
        yield dict(lane=lanes[0]['id'], midpoint=list(line.centroid.coords[0]), length=line.length,
                   tileSidewalk=bool(len(hits)), tracks=[list(track.coords) for track in tracks])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    parser.add_argument('report', type=Path)
    options = parser.parse_args()
    options.report.write_text(json.dumps(list(audit(options.world)), separators=(',', ':')))
