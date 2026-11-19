"""OSM footprint, with camera-facing elevations from Rock 06/09 only."""
import math
import sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon
from nikoniko import export_landmark

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz,load_osm


def mall(model):
    way=next(item for item in load_osm() if item['type']=='way' and item['id']==264901525)
    points=np.array([ll2xz(vertex['lat'],vertex['lon']) for vertex in way['geometry'][:-1]])
    points-=Polygon(points).centroid.coords[0]
    model.prism(points.tolist(),0,22.8,'beige',True)
    for first,last in [(points[0],points[1]),(points[7],points[8]),(points[8],points[9]),(points[9],points[0])]:
        dx,dz=last-first; length=math.hypot(dx,dz); angle=math.atan2(-dz,dx)
        center=(first+last)/2
        model.pose=(center[0],0,center[1],angle)
        model.box(0,.3,-.25,length,21.9,.72,'glass')
        model.box(0,3.8,-.74,length,1.12,.65,'red')
        model.box(0,22,-.2,length+.2,.7,.9,'alum')
        if model.detail:
            for height in (8.4,12.1,15.8,19.5):model.box(0,height,-.69,length,.15,.16,'alum')
            for location in np.linspace(-length/2,length/2,max(2,round(length/2.3))):
                model.box(location,.3,-.71,.11,21.7,.14,'alum')
    model.pose=(0,0,0,0)


if __name__=='__main__':export_landmark('wangcheng_mall',mall)
