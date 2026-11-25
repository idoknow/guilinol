"""Rebuild the photographed ground-to-roof break in the Zhongshan frontage."""
import json
from math import radians, sin, cos
from pathlib import Path
import sys

from shapely.geometry import LineString, Point, Polygon

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'pipeline'))
from common import ll2xz, xz2ll

layout = root/'pipeline/data/layout/dongxi-layout.geojson'
catalog = json.loads(layout.read_text())
features = catalog['features']
host = next(feature for feature in features if feature['properties']['name']=='R10')
if any(feature['properties']['name']=='R10-west' for feature in features):
    raise SystemExit('Entrance already registered')
source = Polygon([ll2xz(lat,lon) for lon,lat in host['geometry']['coordinates'][0]])
angle = radians(41.8)
line = LineString([(-699.3,-128.4),(-699.3+55*sin(angle),-128.4-55*cos(angle))])
parts = sorted(source.difference(line.buffer(1.7)).geoms,key=lambda part:-part.area)
assert len(parts)==2
for index, part in enumerate(parts):
    name = 'R10-west' if index else 'R10'
    outline = [list(reversed(xz2ll(*point))) for point in part.exterior.coords]
    revised = {**host,'properties':{**host['properties'],'name':name},'geometry':{'type':'Polygon','coordinates':[outline]}}
    if index:
        features.append(revised)
    else:
        features[features.index(host)]=revised
for sign in features:
    if sign['properties'].get('roof')=='R10':
        lon,lat = sign['geometry']['coordinates']
        distance,index=min((part.boundary.distance(Point(ll2xz(lat,lon))),index) for index,part in enumerate(parts))
        assert distance<.05,sign['properties']['name']
        sign['properties']['roof']='R10-west' if index else 'R10'
layout.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
