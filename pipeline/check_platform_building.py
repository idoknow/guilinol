"""Check the retained Overture footprint's finished GL04 collider against the rail envelope."""
from pathlib import Path
import csv
import gzip
import json
import struct

import numpy as np
from shapely import LineString, Polygon, box, union_all

from check_rail_platforms import rail_chords
from common import RAW
from features import overture_geometry


def building_parts(world, manifest, building):
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        row = next(r for r in csv.DictReader(source, delimiter='\t') if r['id'] == building)
    footprint = overture_geometry(row)
    for tile in manifest['chunks']:
        origin = np.array([tile['x'], tile['z']])
        if not box(*origin, *(origin+256)).intersects(footprint):
            continue
        raw = gzip.decompress((world/tile['file']).read_bytes())
        v, i, size = struct.unpack_from('<3I', raw, 4)
        offset = 16924+9*v+4*i
        for index, (_, _, rings, *_) in enumerate(json.loads(raw[offset:offset+size])[0]):
            shell, *holes = rings
            collider = Polygon(origin+np.array(shell)/100, [origin+np.array(h)/100 for h in holes])
            # A single Overture footprint may be split at several tile boundaries.
            if collider.area and footprint.intersection(collider).area > .99*collider.area:
                yield tile, index, collider


def check(world, building, radius):
    manifest = json.loads((world/'manifest.json').read_bytes())
    solids = []
    for tile, index, polygon in building_parts(world, manifest, building):
        loops = tile.get("buildingColliderRings", {}).get(str(index))
        if loops is not None:
            origin = np.array([tile["x"],tile["z"]])
            polygon = Polygon(np.array(loops[0])/100+origin, [np.array(h)/100+origin for h in loops[1:]])
        solids.append(polygon)
    if not solids:
        raise ValueError(f'Missing retained building collider {building}')
    shape = union_all(solids)
    conflicts = []
    for key, heights in rail_chords(world, shape.buffer(radius), include_structures=True).items():
        axis = LineString([key[:2],key[2:]])
        overlap = shape.intersection(axis.buffer(radius,cap_style='flat'))
        if overlap.area > 1e-8:
            conflicts.append(dict(chord=key, railM=heights, overlapM2=overlap.area,
                                  encroachmentM=radius-shape.distance(axis)))
    return dict(building=building, pieces=len(solids), radiusM=radius, conflicts=conflicts)

def fit_collider(world, manifest, building, radius):
    for tile, index, solid in building_parts(world, manifest, building):
        rails = rail_chords(world, solid.buffer(radius+.01), include_structures=True)
        bands = [LineString([k[:2],k[2:]]).buffer(radius+.008, cap_style="square") for k in rails]
        cut = solid.difference(union_all(bands))
        if solid.area-cut.area < 1e-8:
            continue
        if cut.geom_type != "Polygon" or cut.is_empty:
            raise ValueError(f"Rail clearance splits retained building {building}")
        origin = np.array([tile["x"],tile["z"]])
        loops = [np.rint((np.array(ring.coords[:-1])-origin)*100).astype(int).tolist()
                 for ring in [cut.exterior,*cut.interiors]]
        tile.setdefault("buildingColliderRings",{})[str(index)] = loops
