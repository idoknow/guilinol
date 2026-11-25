"""Restore the N022 frontage beside OSM service way 1531321008 on the registered roof mask."""
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
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import transform, unary_union

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'pipeline'))
from common import LAT0, LON0, MLAT, MLON, load_osm
from features import points


def world(lon, lat):
    return (np.asarray(lon)-LON0)*MLON, (LAT0-np.asarray(lat))*MLAT


def geographic(east, south):
    return np.asarray(east)/MLON+LON0, LAT0-np.asarray(south)/MLAT


folder = require_evidence('layout')
config = json.loads((folder/'dongxi-esri-grid.json').read_text())
scale = 256*2**config['zoom']
origin_x, origin_y = config['pixel_origin']


def pixel(col, row):
    return world((col+origin_x)/scale*360-180,
                 math.degrees(math.atan(math.sinh(math.pi*(1-2*(row+origin_y)/scale)))))


path = (root/'pipeline/data/layout')/'dongxi-infill.geojson'
catalog = json.loads(path.read_text())
host = next(item for item in catalog['features'] if item['properties']['name']=='N022')
source = 'IMG_1407：OSM 1531321008 两侧，按登记 Esri 屋面补齐 N022；道路轴留宽 4.6 m'
if source in host['properties']['evidence']:
    raise SystemExit('N022 service alley already registered')
original = transform(world, shape(host['geometry']))
way = next(item for item in load_osm() if item['id']==1531321008 and item['type']=='way')
axis = LineString(points(way))
segment = LineString([axis.interpolate(8), axis.interpolate(25)])
strip = segment.buffer(9, cap_style='flat').difference(axis.buffer(2.3))
mask = np.asarray(Image.open(folder/'dongxi-esri-mask.png'))
rows, cols = np.nonzero(mask)
east = ((cols+origin_x)/scale*360-180-LON0)*MLON
south = (LAT0-np.rad2deg(np.arctan(np.sinh(np.pi*(1-2*(rows+origin_y)/scale)))))*MLAT
left, top, right, bottom = strip.bounds
inside = (east>left-1)&(east<right+1)&(south>top-1)&(south<bottom+1)
pixels = [box(*pixel(col,row), *pixel(col+1,row+1)) for col,row in zip(cols[inside],rows[inside])]
supported = unary_union(pixels).intersection(strip)
outline = original.union(supported).simplify(.10, preserve_topology=True)
assert outline.geom_type=='Polygon' and outline.is_valid
extension = outline.difference(original)
assert 15 < extension.area < 150 and extension.difference(supported.buffer(.12)).area < .05
assert extension.intersection(axis.buffer(2.2)).area < .05
host['geometry'] = mapping(transform(geographic, outline))
host['properties']['evidence'].append(source)
path.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'N022 infill: {extension.area:.1f} m²')
