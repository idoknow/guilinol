"""OSM footprint, with camera-facing elevations from Rock 06/09 only."""
import math
import sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon
from c_kit import landmark_surface
from nikoniko import export_landmark
from shop_lettering import letters

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz,load_osm


def mall(model):
    model.surface = landmark_surface('wangcheng_mall')
    way=next(item for item in load_osm() if item['type']=='way' and item['id']==264901525)
    points=np.array([ll2xz(vertex['lat'],vertex['lon']) for vertex in way['geometry'][:-1]])
    points-=Polygon(points).centroid.coords[0]
    model.prism(points.tolist(),0,36.9,'beige',True,footing=True)
    for first,last in [(points[0],points[1]),(points[7],points[8]),(points[8],points[9]),(points[9],points[0])]:
        dx,dz=last-first; length=math.hypot(dx,dz); angle=math.atan2(-dz,dx)
        center=(first+last)/2
        model.pose=(center[0],0,center[1],angle)
        model.box(0,.3,-.25,length,36.3,.72,'glass',footing=True)
        model.box(0,4.6,-.74,length,4.35,.65,'red')
        model.box(0,36.3,-.2,length+.2,.7,.9,'alum')
        if length>30:
            model.box(0,36.8,-.46,min(19,length*.6)+.5,3,.66,'beige')
            letters(model,'王城商厦',(0,37.0,-.8),min(19,length*.6),2.65,'red',-1)
            letters(model,"KING'S PLAZA",(0,5.65,-1.09),min(23,length*.65),1.75,'white',-1)
        if model.detail:
            for height in np.arange(4.5,35,4):model.box(0,height,-.69,length,.19,.16,'alum')
            for location in np.linspace(-length/2,length/2,max(2,round(length/2.3))):
                model.box(location,.3,-.71,.13,36,.14,'alum',footing=True)
    model.pose=(0,0,0,0)


if __name__=='__main__':export_landmark('wangcheng_mall',mall)
