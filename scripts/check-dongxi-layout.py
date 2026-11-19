"""Compare exported floor triangles to the source roof rings, in metres."""
import argparse
import json
import math
from pathlib import Path
import sys

import numpy as np
from shapely import union_all
from shapely.geometry import Polygon
import trimesh

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'pipeline'))
from common import ll2xz

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('glb', help='uncompressed generator output, before meshopt quantization')
args = parser.parse_args()
scene = trimesh.load_scene(args.glb)
config = json.loads((root/'pipeline/landmarks.json').read_text())
anchor = next(item['anchor'] for item in config if item['id']=='wangcheng_market')
origin = np.array(ll2xz(*reversed(anchor)))
features = json.loads((root/'docs/layout/dongxi-layout.geojson').read_text())['features']


def axis(polygon):
    corners = np.array(polygon.minimum_rotated_rectangle.exterior.coords)
    sides = np.diff(corners,axis=0)
    direction = max(sides,key=np.linalg.norm)
    return math.degrees(math.atan2(direction[1],direction[0])) % 180


mesh = scene.geometry[scene.graph['collision_surface'][1]]
triangles = mesh.triangles[np.all(abs(mesh.triangles[:,:,1])<.001,axis=1)]
slabs = [Polygon(triangle[:,[0,2]]) for triangle in triangles]
for item in features:
    props = item['properties']
    if not props.get('render') or props['canopy']:continue
    expected = Polygon([ll2xz(*reversed(corner))-origin for corner in item['geometry']['coordinates'][0]])
    actual = union_all([slab for slab in slabs if slab.area>.001 and expected.buffer(.02).covers(slab)])
    if actual.is_empty:raise ValueError('Missing floor: '+props['name'])
    distance = actual.centroid.distance(expected.centroid)
    rotation = abs((axis(actual)-axis(expected)+90)%180-90)
    overlap = actual.intersection(expected).area / actual.union(expected).area
    print(f"{props['name']}: center={distance:.3f} m, axis={rotation:.3f}°, IoU={overlap:.4f}")
    if distance>3 or rotation>3 or overlap<.95:raise ValueError(props['name'])
