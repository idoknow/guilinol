"""OSM ground footprint, Esri upper roof and glazing visible in Rock 06/09."""
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
    way = next(item for item in load_osm() if item['type']=='way' and item['id']==264901525)
    footprint = np.array([ll2xz(v['lat'],v['lon']) for v in way['geometry'][:-1]])
    origin = np.array(Polygon(footprint).centroid.coords[0])
    footprint -= origin
    podium = 7.0
    model.prism(footprint,0,podium,'beige',True,footing=True)

    # Register the Esri roof's NE corner to the matching OSM corner at grade.
    # The west and south shop wings stop at the podium (IMG_1398).
    roof_ll = [(110.2941945,25.2806334),(110.2946870,25.2805347),
               (110.2945793,25.2801160),(110.2940854,25.2802227)]
    roof = np.array([ll2xz(lat,lon) for lon,lat in roof_ll])
    roof += footprint[1]-roof[1]
    corner = roof[0]
    start = corner + 4*(roof[-1]-corner)/np.linalg.norm(roof[-1]-corner)
    end = corner + 4*(roof[1]-corner)/np.linalg.norm(roof[1]-corner)
    curve = [(1-t)**2*start+2*t*(1-t)*corner+t*t*end for t in np.linspace(0,1,5)]
    tower = np.array([*curve,*roof[1:]])
    height = 36.9
    model.prism(tower,podium,height-podium,'glass',True,cap_mat='alum')
    for a,b in zip(tower,np.roll(tower,-1,axis=0)):
        dx,dz=b-a
        length=math.hypot(dx,dz)
        center=(a+b)/2
        model.pose=(center[0],0,center[1],math.atan2(-dz,dx))
        model.box(0,height,-.1,length,.45,.65,'alum')
        if model.detail:
            for y in np.arange(podium+3.7,height,3.7):
                model.box(0,y,-.08,length,.16,.22,'alum')
            bays=max(1,round(length/2.3))
            for i in range(bays):
                model.box(((i+.5)/bays-.5)*length,podium,-.08,.12,height-podium,.22,'alum')
    for a,b in zip(footprint,np.roll(footprint,-1,axis=0)):
        dx,dz=b-a
        length=math.hypot(dx,dz)
        center=(a+b)/2
        model.pose=(center[0],0,center[1],math.atan2(-dz,dx))
        model.box(0,4.4,-.16,length,2.25,.38,'red')
        if length>30:
            letters(model,"KING'S PLAZA",(0,4.85,-.38),min(20,length*.6),1.45,'white',-1)
    a,b=end,roof[1]
    center=(a+b)/2
    model.pose=(center[0],0,center[1],math.atan2(a[1]-b[1],b[0]-a[0]))
    letters(model,'王城商厦',(0,height+.20,-.25),19,2.3,'red',-1)
    model.pose=(0,0,0,0)


if __name__=='__main__':export_landmark('wangcheng_mall',mall)
