from pathlib import Path
import sys

import numpy as np
from shapely.geometry import LineString

from jiefang_layout import deck_level
from shop_lettering import letters

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import load_osm, ll2xz


def portal_furniture(model, frame):
    way=next(item for item in load_osm() if item['type']=='way' and item['id']==682893309)
    axis=LineString([ll2xz(item['lat'],item['lon']) for item in way['geometry']])
    rotation=np.array([[frame.cos,frame.sin],[-frame.sin,frame.cos]])
    def site(station,offset):
        center=np.array(axis.interpolate(station).coords[0]); tangent=np.array(axis.interpolate(station+.1).coords[0])-center
        tangent/=np.linalg.norm(tangent)
        local=(center+offset*np.array([-tangent[1],tangent[0]])-[frame.x,frame.z])@rotation
        direction=tangent@rotation
        floor=frame.ground(*local)-deck_level(local[0])
        return local,direction,floor
    for side in (-1,1):
        for station in np.arange(80,159,1.):
            corners=[]
            for along in (station,station+1):
                for across in (side*9,side*9.55):
                    local,_,floor=site(along,across)
                    top=min(-.22,frame.ground(*local)-deck_level(local[0])+.3)
                    corners.extend([(local[0],floor-.04,local[1]),(local[0],max(top,floor+.32),local[1])])
            model.mesh(corners,[[0,4,5],[0,5,1],[2,3,7],[2,7,6],[1,5,7],[1,7,3]],'stone',True)
        station=91 if side<0 else 147
        local,direction,floor=site(station,side*7.7)
        angle=np.arctan2(-direction[0],direction[1])+(np.pi if side<0 else 0)
        model.pose=(local[0],floor,local[1],angle)
        model.box(0,-.035,0,.08,2.55,.08,'granite',True)
        model.box(0,1.87,0,1.26,.46,.07,'sign')
        letters(model,'限高 2.5 m',(0,1.95,.041),1.16,.28,'white')
        model.pose=(0,0,0,0)
