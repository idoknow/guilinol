"""Compare exported floor triangles to the source roof rings, in metres."""
import argparse
import json
import math
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import cKDTree
from shapely import union_all
from shapely.geometry import Polygon, Point, LineString
from shapely import STRtree
import trimesh

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'pipeline'))
from common import ll2xz
from landmarks.world_surface import LandmarkSurface, Surface

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('glb', help='uncompressed generator output, before meshopt quantization')
args = parser.parse_args()
scene = trimesh.load_scene(args.glb)
config = json.loads((root/'pipeline/landmarks.json').read_text())
anchor = next(item['anchor'] for item in config if item['id']=='wangcheng_market')
origin = np.array(ll2xz(*reversed(anchor)))
features = json.loads((root/'docs/layout/dongxi-layout.geojson').read_text())['features']
features += json.loads((root/'docs/layout/dongxi-infill.geojson').read_text())['features']


def axis(polygon):
    corners = np.array(polygon.minimum_rotated_rectangle.exterior.coords)
    sides = np.diff(corners,axis=0)
    direction = max(sides,key=np.linalg.norm)
    return math.degrees(math.atan2(direction[1],direction[0])) % 180


mesh = scene.geometry[scene.graph['collision_surface'][1]]
surface=LandmarkSurface(Surface(),'wangcheng_market')
verts,inverse=np.unique(mesh.triangles.reshape(-1,3),axis=0,return_inverse=True)
grade=np.array([surface.ground(x,z)-.035 for x,_,z in verts])
on_grade=(abs(verts[:,1]-grade)<.003)[inverse].reshape(-1,3).all(axis=1)
triangles = mesh.triangles[on_grade]
slabs = [Polygon(triangle[:,[0,2]]) for triangle in triangles]
index=STRtree(slabs)
expected_roofs=[]
actual_roofs=[]
for item in features:
    props = item['properties']
    if props['kind']!='roof':continue
    assert props['render'],props['name']
    rings = [[ll2xz(*reversed(corner))-origin for corner in ring] for ring in item['geometry']['coordinates']]
    expected = Polygon(rings[0],rings[1:])
    floor=props['ground_m']-157.7
    actual = union_all([slabs[key] for key in index.query(expected.buffer(.02)) if slabs[key].area>.001 and expected.buffer(.02).covers(slabs[key])]);expected_roofs.append(expected);actual_roofs.append(actual)
    if actual.is_empty:raise ValueError('Missing floor: '+props['name'])
    distance = actual.centroid.distance(expected.centroid)
    rotation = abs((axis(actual)-axis(expected)+90)%180-90)
    overlap = actual.intersection(expected).area / actual.union(expected).area
    print(f"{props['name']}: center={distance:.3f} m, axis={rotation:.3f}°, IoU={overlap:.4f}")
    if distance>3 or (rotation>3 and actual.hausdorff_distance(expected)>.002) or overlap<.95:raise ValueError(props['name'])

coverage=union_all(actual_roofs).intersection(union_all(expected_roofs)).area/union_all(expected_roofs).area
print(f'Footprint coverage: {coverage:.2%} of {len(expected_roofs)} registered roofs');assert coverage>=.85
hosts={f['properties']['name']:f for f in features if f['properties']['kind'] in ('mall','roof')}
floating=[];checked=0
joinery=cKDTree(scene.geometry[scene.graph['lod0_joinery'][1]].vertices)
for item in features:
    props=item['properties']
    if props['kind']!='storefront':continue
    checked+=1;host=hosts[props['roof']];wall=Polygon([ll2xz(*reversed(corner)) for corner in host['geometry']['coordinates'][0]]).boundary
    center=np.array(ll2xz(*reversed(item['geometry']['coordinates'])));bearing=math.radians(props['bearing']);normal=np.array([math.sin(bearing),-math.cos(bearing)]);tangent=np.array([math.cos(bearing),math.sin(bearing)])
    width=min(props['wall_width_m'],8.6 if props['name']=='星巴克' else min(5.5,max(2.6,len(props['name'])*.72)))
    ref=props['ground_m']-157.7
    if props['roof']=='王城商厦':
        ref=max(ref,surface.ground(*(center-origin)))
    base=ref+2.4+(props['floor']-1)*3.45
    for fraction in [-.5,.5]:
        corner=center-origin+.24*normal+tangent*width*fraction
        for height in (base,base+.75):
            height+=np.clip(1-(height-ref)/3.2,0,1)*(surface.ground(*corner)-.035-ref)
            distance,_=joinery.query((corner[0],height,corner[1]))
            if distance>.002:raise ValueError('Missing exported sign corner: '+props['name'])
    offset=max(wall.distance(Point(center+.25*normal+tangent*width*fraction)) for fraction in [-.5,0,.5]);top=props['ground_m']-host['properties']['ground_m']+(props['floor']-1)*3.45+3.15
    if offset>.3001 or top>host['properties']['eave_m']:floating.append((props['name'],offset,top))
print(f'Unsupported signs: {len(floating)}/{checked}',floating);assert not floating
