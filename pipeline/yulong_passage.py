"""Model the signed layer separation at the east entrance of Yulong Road."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, box
from common import OUT, load_osm
from features import area, building_mesh, points, polygons
from service_streets import width


def open_passage(output, chunks):
    ways = {el['id']: el for el in load_osm()
            if el['type'] == 'way' and el['id'] in (454947540, 1554374420)}
    road, building = ways[454947540], area(ways[1554374420])
    if road['tags'].get('layer') != '-1':
        raise ValueError('Recheck the mapped level of the Yulong Road crossing')
    axis = LineString(points(road))
    lane = axis.buffer(width(road['tags'])/2)
    for tile in chunks:
        origin = (tile['x'], tile['z'])
        if not building.intersects(box(*origin, origin[0]+256, origin[1]+256)):
            continue
        file = output/tile['file']
        data = gzip.decompress(file.read_bytes())
        magic, nv, ni, size, png, deck = struct.unpack_from('<4s5I', data)
        start = 24 + 16900
        offset = start + nv*9 + ni*4
        collision = json.loads(data[offset:offset+size])
        parts = []
        changed = False
        for bottom, top, loops, kind, floors, seed, anchor, rect, complex_shape, *flags in collision[0]:
            shell, *holes = [np.array(loop)/100 + origin for loop in loops]
            poly = Polygon(shell, holes)
            center = Point(np.array(anchor)/100 + origin) if anchor else Point(origin[0]-1, origin[1]-1)
            attrs = (kind, floors, seed, center, rect, complex_shape)
            base, roof = bottom/10, top/10
            if flags or not poly.intersects(axis) or poly.intersection(building).area < .98*poly.area:
                parts.append((poly, (base, roof, *attrs, *flags)))
                continue
            # OSM supplies relative layer, not surveyed headroom. Keep the roof
            # on a full-width upper storey and retain the two ground-floor wings.
            soffit = base + 4.5
            if soffit >= roof:
                raise ValueError('Yulong building has insufficient height for the opening')
            parts.append((poly, (soffit, roof, *attrs, True)))
            for wing in polygons(poly.difference(lane)):
                parts.append((wing, (base, soffit, kind, 1, seed, Point(origin[0]-1, origin[1]-1), [], False)))
            changed = True
        if changed:
            vertices, normals, indices, collision[0] = building_mesh(parts, origin)
            packed = json.dumps(collision, separators=(',', ':')).encode()
            header = struct.pack('<4s5I', magic, len(vertices)//6, len(indices)//4, len(packed), png, deck)
            file.write_bytes(gzip.compress(header + data[24:start] + vertices + normals + indices
                                           + packed + data[offset+size:], mtime=0))
            tile['bytes'] = file.stat().st_size


if __name__ == '__main__':
    output = Path(OUT)
    file = output/'manifest.json'
    manifest = json.loads(file.read_bytes())
    open_passage(output, manifest['chunks'])
    from peak_sectors import write_distant_buildings
    manifest['distantBuildings'] = write_distant_buildings(output, manifest['chunks'])
    file.write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
