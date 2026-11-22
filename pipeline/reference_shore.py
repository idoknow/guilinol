"""Compare old-box OSM shores to the rendered 4 m wet-cell boundary."""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from shapely import distance, points as sample_points, union_all
from shapely.geometry import LineString, box

from common import ll2xz
from expansion_overlays import wet_cells
from features import area, polygons


def measure(directory, snapshot):
    manifest = json.loads((directory/'manifest.json').read_bytes())
    south,west,north,east = manifest['bbox']
    interior = box(*ll2xz(north,west),*ll2xz(south,east)).buffer(-16)
    strips = []
    for tile in manifest['chunks']:
        raw = gzip.decompress((directory/tile['file']).read_bytes())
        strips.extend(wet_cells(raw,tile['x'],tile['z']))
    shore = union_all(strips).boundary
    rows = []
    for feature in json.loads(snapshot.read_bytes())['elements']:
        tags = feature.get('tags',{})
        if not (tags.get('natural')=='water' or tags.get('waterway')=='riverbank' or 'water' in tags):
            continue
        offsets = []
        for poly in polygons(area(feature)):
            for ring in [poly.exterior,*poly.interiors]:
                clipped = LineString(ring).intersection(interior)
                for line in getattr(clipped,'geoms',[clipped]):
                    if line.geom_type=='LineString' and not line.is_empty:
                        offsets.extend(distance(sample_points(line.segmentize(4).coords),shore))
        if offsets:
            values = np.asarray(offsets)
            rows.append(dict(osm=f"{feature['type']}/{feature['id']}", name=tags.get('name',''),
                             samples=len(values),above2=int((values>2).sum()),
                             atLeast632=int((values>=6.32).sum()),maximum=round(max(values),3)))
    return dict(bbox=manifest['bbox'],grid=manifest['grid'],features=rows)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    parser.add_argument('osm',type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.world,args.osm),ensure_ascii=False,indent=2))
