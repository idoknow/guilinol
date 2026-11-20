"""Check the shipped wall-top collision mesh against the elevated OSM route."""
import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely import STRtree, polygons
from shapely.geometry import LineString

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'pipeline'))
from audit import load_landmark_meshes
from common import load_osm
from features import points
from landmarks.world_surface import Surface

world = root/'public/world'
manifest = json.loads((world/'manifest.json').read_text())
manifest['landmarks'] = [entry for entry in manifest['landmarks'] if entry['id']=='jingjiang']
mesh = load_landmark_meshes(root, manifest)['jingjiang']
faces = mesh['coll_tris'][mesh['coll_normals'][:,1]>.9]
index = STRtree(polygons(faces[:,:,::2]))
route = next(way for way in load_osm() if way['type']=='way' and way['id']==1008909371)
assert route['tags']['layer']=='1'
line = LineString(points(route))
terrain = Surface(world)
def surface_levels(point):
    levels = []
    for face in faces[index.query(point,predicate='intersects')]:
        normal = np.cross(face[1]-face[0],face[2]-face[0])
        levels.append(face[0,1]-np.dot(normal[::2],np.asarray(point.coords[0])-face[0,::2])/normal[1])
    return levels

errors = []
for station in np.linspace(0,line.length,math.ceil(line.length/2)+1):
    point = line.interpolate(station)
    reference = terrain.sample(point.x,point.y)[0]+6.5
    levels = surface_levels(point)
    errors.append(min((abs(level-reference) for level in levels),default=math.inf))
    if errors[-1]>.3: print(f'station={station:.2f} m, XZ={point.x:.3f},{point.y:.3f}, error={errors[-1]:.3f}',file=sys.stderr)
print(json.dumps(dict(samples=len(errors),unsupported=sum(not math.isfinite(error) for error in errors),
                      within_tolerance=int(sum(error<=.3 for error in errors)),
                      max_finite_error_m=max((error for error in errors if math.isfinite(error)),default=None))))
from shapely.geometry import Point
edge_heights = []
for station in (41.,43.):
    center = np.asarray(line.interpolate(station).coords[0])
    forward = np.asarray(line.interpolate(station+1).coords[0])-center
    normal = np.array([-forward[1],forward[0]])/np.linalg.norm(forward)
    deck = max(surface_levels(Point(center)))
    edge_heights.append([max(surface_levels(Point(center+side*normal*2.25)))-deck for side in (1,-1)])
print('outer/inner above walkway (m):',np.round(edge_heights,3).tolist())
sys.exit(int(max(errors)>.3 or not np.allclose(edge_heights,[[1.1,.72],[.52,.72]],atol=.08)))
