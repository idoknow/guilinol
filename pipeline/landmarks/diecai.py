"""Mingyue Peak, node 4780961462, within park 188580617. Stair elevations
sample the existing mountain; the turns and wind-cave location are inferred,
not surveyed. The summit pavilion is scaled to a ~1.7 m visitor.
"""
import math
import numpy as np
import sys
from pathlib import Path
from fubo import mountain,pavilion
from c_kit import landmark_surface
from xiaoyao_tower import generate
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wind_cave import PORTALS, RING, trail


def build(model):
    rings,tip=mountain('明月峰')
    route = trail(rings,tip)
    surface = landmark_surface('diecai')
    def point(progress):
        p = route(progress)
        if progress < .20:
            p[1] = max(p[1],surface.ground(p[0],p[2])+.08)
        return p
    steps=470 if model.detail else 52
    for index in range(steps):
        start=point(index/steps);end=point((index+1)/steps);delta=end-start
        angle=math.atan2(delta[2],delta[0]);model.pose=(*((start+end)/2),angle)
        length=np.hypot(delta[0],delta[2])+.18
        if index/steps < .05:
            model.foundation(surface,0,-1.85,0,length,1.98,2.85,'stone')
        else:
            model.box(0,-1.85,0,length,1.98,2.85,'stone')
        if model.detail:
            model.box(0,.11,0,length,.1,2.75,'pave')
            sections=[]
            for waypoint in (index,index+1):
                forward=point(min(1,(waypoint+1)/steps))-point(max(0,(waypoint-1)/steps))
                normal=np.array([-forward[2],0,forward[0]])
                normal*=1.42/np.linalg.norm(normal)
                center=point(waypoint/steps)+[0,.2,0]
                sections.extend([center-normal,center+normal])
            model.solid.append(np.asarray(sections)[[[0,1,2],[2,1,3]]])
            if index%4==0:model.box(0,.2,-1.3,.17,.94,.17,'granite')
    model.pose=(0,0,0,0)
    loops=[]
    for index in PORTALS:
        strip=rings[RING:RING+2,index-1:index+2]
        loops.append(np.concatenate((strip[0],strip[1,::-1])))
    loops[1]=loops[1][[2,1,0,5,4,3]]
    previous=None
    for fraction in np.linspace(0,1,25 if model.detail else 7):
        current=(1-fraction)*loops[0]+fraction*loops[1]
        current[3:,1]-=2.35*math.sin(fraction*math.pi)
        section=[]
        for side in range(6):
            for edge in np.arange(4)/4:
                vertex=(1-edge)*current[side]+edge*current[(side+1)%6]
                inset=.1+.14*math.sin(fraction*33+side*7+edge*6)
                if side>=2:vertex+=(current.mean(axis=0)-vertex)*inset
                section.append(vertex)
        if previous is not None:
            for side in range(len(section)):
                following=(side+1)%len(section)
                model.mesh([previous[side],previous[following],section[following],section[side]],[[0,1,2],[0,2,3]],'granite' if side%7 else 'stone',True)
        previous=section
    start=point(.015);direction=point(.016)-start
    model.pose=(*start,math.atan2(direction[2],direction[0])-math.pi/2)
    model.arcade(0,0,9,1.5,4.4,[0],2,'brick');model.box(0,4.28,0,10.4,.23,3.4,'wood');model.swept_roof(0,4.4,0,10.4,3.4,1.4)
    model.pose=(*tip,0);pavilion(model,6.25,3.8,landmark_surface('diecai'))
    model.box(0,3.1,2.55,2.1,.55,.14,'sign')


if __name__=='__main__':generate('diecai',build,'F')
