"""Compare the packed structural caps with the named Overture footprints."""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from shapely import from_wkt, polygons, union_all
from shapely.ops import transform

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'pipeline'))
from audit import load_landmark_meshes
from common import ll2xz

neighbors = dict(R2='zhengyang', R19='zhengyang', R61='zhengyang', R15='zhongshan_road',
                 R54='zhongshan_road', R36='zhuangyuan_gallery')
layout = json.loads((root / '.ops-docs/layout/dongxi-layout.geojson').read_text())['features']
source_ids = {feature['properties']['evidence'][0].split()[1]: feature['properties']['name']
              for feature in layout if feature['properties']['name'] in neighbors}
with (root / 'raw/overture_buildings.csv').open() as source:
    references = {source_ids[row['id']]: transform(lambda lon, lat: ll2xz(lat, lon), from_wkt(row['wkt']))
                  for row in csv.DictReader(source, delimiter='\t') if row['id'] in source_ids}
assert references.keys() == neighbors.keys()
manifest = json.loads((root / 'public/world/manifest.json').read_text())
manifest['landmarks'] = [entry for entry in manifest['landmarks']
                         if entry['id'] in {*neighbors.values(), 'wangcheng_market'}]
models = load_landmark_meshes(root, manifest)


def clipped_triangles(triangles, bounds):
    lower = triangles[:, :, ::2].min(axis=1)
    upper = triangles[:, :, ::2].max(axis=1)
    return triangles[((lower <= bounds[2:]) & (upper >= bounds[:2])).all(axis=1)]


def measure(model, reference):
    structural = clipped_triangles(model['coll_tris'], reference.buffer(100).bounds)
    flat = structural[np.ptp(structural[:, :, 1], axis=1) < .03]
    levels = np.round(flat[:, :, 1].mean(axis=1), 1)
    scores = []
    for level in np.unique(levels):
        caps = polygons(flat[levels == level][:, :, ::2])
        shape = union_all([cap for cap in caps if cap.area > .001], grid_size=.01)
        for part in getattr(shape, 'geoms', [shape]):
            if part.intersects(reference):
                scores.append(part.intersection(reference).area / part.union(reference).area)
    visible = clipped_triangles(model['vis_tris'], reference.bounds)
    above = visible[visible[:, :, 1].max(axis=1) > model['entry']['position'][1] + .6]
    skins = polygons(above[:, :, ::2])
    footprint = union_all([skin for skin in skins if skin.area > .001], grid_size=.01)
    return max(scores, default=0), footprint.intersection(reference)


for name, neighbor in neighbors.items():
    market_score, market = measure(models['wangcheng_market'], references[name])
    neighbor_score, other = measure(models[neighbor], references[name])
    print(f'{name} {neighbor}: overlap={market.intersection(other).area:.2f} m2; '
          f'IoU market={market_score:.4f} neighbor={neighbor_score:.4f}', flush=True)
