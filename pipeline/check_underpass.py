"""Measure lower-layer coverage and signed clearance beneath the packed slab."""
import json
import sys
from pathlib import Path

import numpy as np
import shapely

from audit_seams import ROOT, Streets, Surface, world_triangles
from common import ll2xz, load_osm


def main():
    world = Surface(ROOT/'public/world'); streets = Streets(world)
    entry = world.entries['jiefang_bridge']; triangles = world_triangles(entry,'stone',ROOT/'public')
    normals = np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    down = normals[:,1]<-.95*np.linalg.norm(normals,axis=1)
    triangles,normals = triangles[down],normals[down]
    tree = shapely.STRtree(shapely.polygons(triangles[:,:,[0,2]]))
    origins = {1531308428:(-298.386,19.163),682893309:(-60.633,98.484)}
    reports = {}
    for way in load_osm():
        if way['type']!='way' or way['id'] not in origins: continue
        line = shapely.LineString([ll2xz(vertex['lat'],vertex['lon']) for vertex in way['geometry']]); x,z = origins[way['id']]
        elevation,kinds = streets.at(x,z); stations = []
        pivot = line.project(shapely.Point(x,z))
        for station in np.arange(pivot-55,pivot+55.01,.5):
            point = line.interpolate(station); ids = tree.query(point,predicate='intersects')
            if not len(ids): continue
            base = triangles[ids,0]; slopes = normals[ids]
            levels = base[:,1]-((point.x-base[:,0])*slopes[:,0]+(point.y-base[:,2])*slopes[:,2])/slopes[:,1]
            ground,coverage = streets.at(point.x,point.y)
            stations.append([round(point.x,3),round(point.y,3),round(ground,3),round(min(levels)-ground,3),sorted(coverage)])
        reports[way['id']] = dict(edgeHeight=elevation,edgeKinds=sorted(kinds),centerline=stations)
    Path(sys.argv[1]).write_text(json.dumps(reports,indent=2)+'\n')


if __name__=='__main__': main()
