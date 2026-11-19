"""Teaching blocks 3/4/5: fit axes and spans to their individual footprints."""
import math
import sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon
from jingjiang import generate
from wangcheng_plan import PalacePlan

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz,load_osm


def teaching(model):
    anchor=np.asarray(ll2xz(25.2854676,110.2934274))
    plan=PalacePlan()
    anchor_ground=plan.height(*(plan.forward.T @ (anchor-plan.origin)))
    for way in load_osm():
        if way['type']!='way' or way['id'] not in (674165595,674165596,674165597,679734456,679734455,679734418):continue
        outline=Polygon([ll2xz(vertex['lat'],vertex['lon']) for vertex in way['geometry']])
        rectangle=outline.minimum_rotated_rectangle
        edges=np.diff(np.asarray(rectangle.exterior.coords),axis=0)
        spans=np.linalg.norm(edges,axis=1)
        axis=edges[spans.argmax()]; width,depth=spans.max(),spans.min()
        center=np.array(rectangle.centroid.coords[0])-anchor
        angle=math.atan2(axis[1],axis[0])
        if way['id'] in (679734418,679734455,679734456):
            # The chunk renderer supplies the walls and their exact collision outlines.
            level=plan.height(*(plan.forward.T @ (np.array(outline.representative_point().coords[0])-plan.origin)))
            roof=level-anchor_ground+(9.6 if way['id']==679734456 else 3.2)
            model.pose=(center[0],roof,center[1],angle)
            if way['id']==679734456:
                model.tiled_roof(0,0,0,width+1,depth+1,3.3,'earth',gable=False)
            else:
                # Twin transverse wings flank a narrower longitudinal range.
                model.tiled_roof(0,0,0,width-15,13.4,2.9,'earth',gable=False)
                for side in (-1,1):
                    wing=center+side*(width/2-4.45)*axis/width
                    model.pose=(wing[0],roof,wing[1],angle+math.pi/2)
                    model.tiled_roof(0,0,0,depth+.8,9.6,2.9,'earth',gable=False)
            continue
        model.pose=(center[0],0,center[1],angle)
        model.box(0,0,0,width,9.65,depth,'white',True)
        model.tiled_roof(0,9.65,0,width+1.6,depth+1.2,3.3,'earth',gable=False)
        for side in (-1,1):
            for floor in range(3):
                level=floor*3.2
                model.box(0,level+.05,side*(depth/2+.1),width,.28,.55,'wood')
                for column in np.linspace(-width*.45,width*.45,14 if model.detail else 7):
                    model.box(column,level+.9,side*(depth/2+.02),2.45,1.65,.14,'glass')
                    if model.detail:model.box(column,level+.9,side*(depth/2+.11),.12,1.65,.12,'white')


if __name__=='__main__':generate('wangcheng_teaching',teaching)
