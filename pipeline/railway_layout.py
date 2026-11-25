"""Clip rail centrelines into 256 m tiles and check their centimetre encoding."""
from collections import defaultdict
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, box
from shapely.ops import unary_union

from common import CHUNK, load_osm
from features import points
from play_region import PlayRegion


def lines(geom):
    if geom.is_empty:
        return
    if geom.geom_type == 'LineString':
        yield geom
    elif hasattr(geom, 'geoms'):
        for part in geom.geoms:
            yield from lines(part)


def layout(elements, region):
    tiles = defaultdict(list)
    sources = {}
    for way in elements:
        if way['type'] != 'way' or way.get('tags', {}).get('railway') != 'rail':
            continue
        source = LineString(points(way)).intersection(region.geometry)
        for line in lines(source):
            sources[way['id']] = source
            left, top, right, bottom = (math.floor(v/CHUNK)*CHUNK for v in line.bounds)
            for x in range(left, right+1, CHUNK):
                for z in range(top, bottom+1, CHUNK):
                    if (x,z) not in region.tiles:
                        continue
                    for part in lines(line.intersection(box(x,z,x+CHUNK,z+CHUNK))):
                        local = np.rint((np.asarray(part.coords)-[x,z])*100).astype(int)
                        if (local == local[0]).all():
                            continue
                        tiles[x,z].append((way['id'], local))
    return sources, tiles


def verify(sources, tiles, boundary, destination):
    emitted = defaultdict(list)
    for (x,z), rows in tiles.items():
        for way, local in rows:
            emitted[way].append(LineString(local / 100 + [x,z]))
    if sources.keys() != emitted.keys():
        raise ValueError('Clipping dropped or added rail ways')
    distances = [line.hausdorff_distance(unary_union(emitted[way])) for way,line in sources.items()]
    size = 2000
    xmin,zmin,xmax,zmax = boundary.bounds
    scale = (size-80)/(xmax-xmin)
    image = Image.new('RGB', (size, round((zmax-zmin)*scale)+80), '#f4f1e8')
    draw = ImageDraw.Draw(image)
    def coords(line):
        return [((x-xmin)*scale+40,(z-zmin)*scale+40) for x,z in line.coords]
    draw.line(coords(boundary.exterior), fill='#b4ad9f', width=2)
    for source in sources.values():
        for part in lines(source):
            draw.line(coords(part), fill='#d57336', width=5)
    for parts in emitted.values():
        for part in parts:
            draw.line(coords(part), fill='#164d69', width=1)
    draw.text((40,14),'Guilin | OSM rail (orange) / tiled centreline (blue) | OpenStreetMap contributors',
              fill='#283a40',font_size=20)
    image.save(destination)
    print(json.dumps(dict(ways=len(sources), tiles=len(tiles), p95WayHausdorffM=float(np.percentile(distances,95)),
                          maxWayHausdorffM=max(distances)), indent=2))
    if max(distances)>1.5 or np.percentile(distances,95)>.5:
        raise ValueError('Encoded railway diverges from source geometry')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('overlay',type=Path)
    args = parser.parse_args()
    region = PlayRegion()
    verify(*layout(load_osm(),region),region.geometry,args.overlay)
