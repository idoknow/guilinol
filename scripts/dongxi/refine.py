"""Clip weakly supported outline extensions to Esri eaves; retain signed wall segments."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ops_evidence import require_evidence
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio.features import shapes
from shapely import union_all
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import transform

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'pipeline'))
from common import MLON, MLAT, LON0, LAT0


def world(lon, lat):
    return (np.asarray(lon)-LON0)*MLON, (LAT0-np.asarray(lat))*MLAT


def geographic(east, south):
    return np.asarray(east)/MLON+LON0, LAT0-np.asarray(south)/MLAT


folder = require_evidence('layout')
grid = json.loads((folder/'dongxi-esri-grid.json').read_text())
scale = 256*2**grid['zoom']


def project(col, row):
    return world((np.asarray(col)+grid['pixel_origin'][0])/scale*360-180,
                 np.rad2deg(np.arctan(np.sinh(np.pi*(1-2*(np.asarray(row)+grid['pixel_origin'][1])/scale)))))


mask = np.asarray(Image.open(folder/'dongxi-esri-mask.png'))
trace = union_all([transform(project,shape(geom)) for geom, value in shapes(mask.astype('uint8'), mask=mask) if value])
market = next(item for item in json.loads((root/'pipeline/landmarks.json').read_text()) if item['id']=='wangcheng_market')
region = transform(world, Polygon(market['replace']['polygon']))
layout = (root/'pipeline/data/layout')/'dongxi-layout.geojson'
catalog = json.loads(layout.read_text())
features = catalog['features']
for feature in features:
    props = feature['properties']
    if props['kind']!='roof' or props['confidence']!='低' or props.get('esri_edge_refined'):
        continue
    original = transform(world, shape(feature['geometry']))
    inside = original.intersection(region)
    if inside.area < 12:
        continue
    supported = inside.intersection(trace)
    if not .12 < supported.area/inside.area < .92:
        continue
    retained = supported.buffer(.6).union(original.difference(region)).intersection(original)
    for shop in features:
        if shop['properties'].get('roof') != props['name']:
            continue
        center = Point(world(*shop['geometry']['coordinates']))
        ring = list(original.exterior.coords)
        wall = min((LineString([start,end]) for start,end in zip(ring,ring[1:])),key=center.distance)
        retained = retained.union(original.intersection(wall.buffer(1.2)))
    retained = retained.simplify(.45, preserve_topology=True).intersection(original)
    parts = [part for part in getattr(retained,'geoms',[retained]) if part.geom_type=='Polygon']
    if not parts:
        continue
    largest = max(parts,key=lambda part: part.area)
    wings = [part for part in parts if part is not largest and part.area>=9]
    signed = any(s['properties'].get('roof')==props['name'] for s in features)
    if (signed and largest.area < retained.area*.94) or retained.area < original.area*.22 or original.area-retained.area<6:
        continue
    if any(s['properties'].get('roof')==props['name'] and largest.boundary.distance(Point(world(*s['geometry']['coordinates'])))>.05 for s in features):
        continue
    feature['geometry'] = mapping(transform(geographic,largest))
    props['esri_edge_refined'] = True
    if not signed:
        for index, wing in enumerate(wings, 1):
            features.append(dict(type='Feature',properties={**props,'name':props['name']+'-wing'+str(index)},geometry=mapping(transform(geographic,wing))))
    print(props['name'], round(original.area-largest.area,1))
layout.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
