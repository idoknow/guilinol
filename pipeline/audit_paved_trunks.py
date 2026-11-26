"""Count GL04 tree centres on final at-grade street faces (local centimetres)."""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import struct

import numpy as np
from shapely import Polygon, STRtree, points, make_valid, union_all

from legacy_core import CAMPUS_TILES, Downtown
from road_grading import eval_bspline_grid


def trunk_hits(streets, records):
    coords = records[:, :2]
    centres = points(coords)
    faces = streets[0]
    if len(streets) > 11 and streets[11]:
        faces = faces[:streets[11][0]]
    if len(streets) > 19:
        faces = [*faces, *streets[19]]
    kinds = {0: 'road', 1: 'walk', 2: 'marking', 4: 'verge', 5: 'cycle', 6: 'walk'}
    hits = {}
    for kind, label in kinds.items():
        areas = [Polygon(shell, holes) for channel, shell, *holes in faces if channel == kind]
        if areas:
            indices, _ = STRtree(areas).query(centres, predicate='intersects')
            hits.setdefault(label, set()).update(indices.tolist())
    roads = hits.get('road', set()) | hits.get('cycle', set()) | hits.get('marking', set())
    walks = hits.get('walk', set()) - roads - hits.get('verge', set())
    if len(streets) > 7 and streets[7]:
        pits = points([(east * 10, south * 10) for east, south, *_ in streets[7]])
        # Coordinates of a generated trunk and its planter centre differ by at most
        # half a decimetre per axis due to the independent quantisation grids.
        colocated, _ = STRtree(pits).query(centres, predicate='dwithin', distance=8)
        walks.difference_update(colocated.tolist())
    return {idx: 'road' if idx in roads else 'walk' for idx in roads | walks
            if records[idx, 3] % 256 != 5}


def at_grade_blockers(collision, ground, records, projected):
    streets = collision[1]
    faces = streets[0][:streets[11][0]] if len(streets) > 11 and streets[11] else streets[0]
    if len(streets) > 19:
        faces = [*faces, *streets[19]]
    walk = union_all([make_valid(Polygon(shell, holes)) for kind, shell, *holes in faces if kind in (1, 6)])
    buildings = STRtree([Polygon(row[2][0], row[2][1:]) for row in collision[0] if row[2]])
    ids = list(projected)
    if not ids:
        return {}
    east, south = records[ids, :2].T.astype(float) / 100
    grid_x, grid_z = east / 4, south / 4
    col, row = np.minimum(grid_x.astype(int), 63), np.minimum(grid_z.astype(int), 63)
    frac_x, frac_z = grid_x-col, grid_z-row
    nw, ne = ground[row, col], ground[row, col+1]
    sw, se = ground[row+1, col], ground[row+1, col+1]
    terrain = np.where(frac_x+frac_z <= 1, nw+(ne-nw)*frac_x+(sw-nw)*frac_z,
                       se+(sw-se)*(1-frac_x)+(ne-se)*(1-frac_z)) / 10
    support = terrain
    if len(streets) > 5 and streets[5]:
        base, deltas = streets[5]
        support = np.maximum(terrain, eval_bspline_grid((base+np.asarray(deltas)).reshape(35, 35)/1000,
                                                       0, 0, east, south))
    blockers = {}
    for idx, level, centre in zip(ids, support, points(records[ids, :2])):
        label = projected[idx]
        if abs(records[idx, 2].view('<i2')/10 - level - (.195 if label == 'walk' else .045)) > .45:
            continue
        if label == 'walk' and (walk.boundary.distance(centre) <= 85 or
                                buildings.query(centre, predicate='dwithin', distance=85).size):
            continue
        blockers[idx] = label
    return blockers


def audit(world, apply=False):
    manifest = json.loads((world / 'manifest.json').read_bytes())
    totals, protected, examples, projected_totals, deletions = Counter(), Counter(), [], Counter(), {}
    for tile in manifest['chunks']:
        file = world / tile['file']
        records = np.frombuffer(gzip.decompress(file.with_suffix('.trees').read_bytes()), '<u2').reshape(-1, 6)
        if not len(records):
            continue
        raw = gzip.decompress(file.read_bytes())
        vertices, indices, size = struct.unpack_from('<3I', raw, 4)
        start = 24 + 16900 + 9 * vertices + 4 * indices
        collision = json.loads(raw[start:start + size])
        projected = trunk_hits(collision[1], records)
        projected_totals.update(projected.values())
        if not projected:
            continue
        hits = at_grade_blockers(collision, np.frombuffer(raw, '<i2', 65**2, 24).reshape(65, 65), records, projected)
        if hits:
            deletions[f"{tile['x']},{tile['z']}"] = [records[idx].tobytes().hex() for idx in sorted(hits)]
            if apply:
                keep = np.ones(len(records), dtype=bool)
                keep[list(hits)] = False
                file.with_suffix('.trees').write_bytes(gzip.compress(records[keep].tobytes(), mtime=0))
        totals.update(hits.values())
        if (tile['x'], tile['z']) in CAMPUS_TILES or Downtown.depth(tile['x']+128, tile['z']+128) >= 384:
            protected.update(hits.values())
            for idx, label in sorted(hits.items()):
                if len(examples) < 5:
                    examples.append([file.name, label, tile['x'] + records[idx, 0].item()/100,
                                     tile['z'] + records[idx, 1].item()/100])
    return dict(chunks=len(manifest['chunks']), projectedTrunks=projected_totals, atGradeBlockers=totals,
                protectedBlockers=protected, examples=examples), deletions


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    parser.add_argument('--apply', type=Path, metavar='DELETIONS')
    args = parser.parse_args()
    report, deletions = audit(args.world, apply=args.apply is not None)
    if args.apply is not None:
        args.apply.write_text(json.dumps(deletions, separators=(',', ':')))
    print(json.dumps(report, indent=2))
