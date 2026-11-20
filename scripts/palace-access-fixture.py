import json
from pathlib import Path
import sys

import numpy as np
from shapely.geometry import LineString

root = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'pipeline'))
from common import load_osm
from features import points
from landmarks.world_surface import Surface

route = next(way for way in load_osm() if way['type']=='way' and way['id']==1008909371)
nodes = dict(zip(route['nodes'],points(route)))
axis = LineString(points(route))
surface = Surface()

from shapely.geometry import Point
def world(station, offset=0):
    center = np.array(axis.interpolate(station).coords[0])
    direction = np.subtract(axis.interpolate(station+.05).coords[0], axis.interpolate(station-.05).coords[0])
    return center+offset*np.array([-direction[1],direction[0]])/np.linalg.norm(direction)

def heights(point, above):
    return [*point,surface.sample(*point)[0]+above]

mid = axis.project(Point(nodes[9308958814]))
legs = [(12,29),(mid-5,mid-22)]
stairs = []
for foot,head in legs:
    sign = np.sign(head-foot)
    stairs.append([heights(world(foot-1.2*sign,3.48),0), heights(world(head+sign,3.48),6.5),
                   heights(world(head+sign),6.5)])
peace=next(way for way in load_osm() if way['type']=='way' and way['id']==265415873)
shared=peace['nodes'].index(2303787968)
approach=LineString(points(peace)[shared:shared+2])
end = axis.project(Point(nodes[2303787968]))
toe = world(end-34.2,11.4)
bottom = surface.sample(*toe)[0]
top = surface.sample(*world(end-36.8))[0]+6.5
stairs.append([heights(np.asarray(approach.interpolate(14).coords[0]),0),
              heights(world(end-34.2,14),0),heights(world(end-34.2,12.3),0),
              *[[*world(end-station,offset),bottom+(top-bottom)*level/3] for station,offset,level in
                [(34.2,3.1,1),(35.5,3.1,1),(35.5,10.8,2),(36.8,10.8,2),(36.8,3.1,3)]],
              heights(world(end-36.8),6.5)])
legs.append((end,end-36.8))

routes = []
for index in range(2):
    start,end = legs[index][1],legs[index+1][1]
    stations = sorted(set([axis.project(Point(vertex)) for vertex in axis.coords]+list(np.arange(start+3,end,6))))
    routes.append(stairs[index]+[heights(world(station),6.5) for station in stations if start+2<station<end-2]+stairs[index+1][::-1])
print(json.dumps(dict(routes=routes,stairs=stairs)))
