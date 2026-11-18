"""Mingyue Peak, node 4780961462, within park 188580617. Stair elevations
sample the existing mountain; the turns and wind-cave location are inferred,
not surveyed. The summit pavilion is scaled to a ~1.7 m visitor.
"""
import math
import numpy as np
import sys
from pathlib import Path
from fubo import mountain,pavilion
from xiaoyao_tower import generate
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wind_cave import PORTALS, RING, mouths


def build(model):
    rings,tip=mountain('明月峰');count=rings.shape[1]
    first,last=mouths(rings)
    def point(progress):
        if .32 <= progress <= .42:
            return first+(last-first)*(progress-.32)/.1
        if progress < .32:
            part=progress/.32; height=1+(RING-1)*part;phase=PORTALS[0]-(1-part)*50
        else:
            part=min(1,(progress-.42)/.54);height=RING+(11-RING)*part;phase=PORTALS[1]+part*80
        index=math.floor(phase)%count;fraction=phase%1
        strip=rings[:,index]*(1-fraction)+rings[:,(index+1)%count]*fraction
        layer=min(10,int(height));fraction=height-layer
        position=strip[layer]*(1-fraction)+strip[layer+1]*fraction
        radial=position[[0,2]]-tip[[0,2]];radial/=np.linalg.norm(radial)
        position[[0,2]]+=radial*1.4*min(1,abs(progress-(.32 if progress<.32 else .42))*90)
        if progress>.96:
            position+=(tip-position)*((progress-.96)/.04)
        return position
    steps=470 if model.detail else 52
    for index in range(steps):
        start=point(index/steps);end=point((index+1)/steps);delta=end-start
        angle=math.atan2(delta[2],delta[0]);model.pose=(*((start+end)/2),angle)
        length=np.hypot(delta[0],delta[2])+.18
        model.box(0,-1.85,0,length,1.98,2.85,'stone',True)
        if model.detail:
            model.box(0,.11,0,length,.1,2.75,'pave',True)
            if index%4==0:model.box(0,.2,-1.3,.17,.94,.17,'granite')
    model.pose=(0,0,0,0)
    loops=[]
    for index in PORTALS:
        strip=rings[RING:RING+2,index-1:index+2]
        loops.append(np.concatenate((strip[0],strip[1,::-1])))
    loops[1]=loops[1][[2,1,0,5,4,3]]
    previous=loops[0]
    for fraction in np.linspace(0,1,15)[1:]:
        current=(1-fraction)*loops[0]+fraction*loops[1]
        current[3:,1]-=2.35*math.sin(fraction*math.pi)
        for side in range(6):
            following=(side+1)%6
            model.mesh([previous[side],previous[following],current[following],current[side]],[[0,1,2],[0,2,3]],'granite',True)
        previous=current
    start=point(0);model.pose=(*start,0)
    model.arcade(0,0,9,1.5,4.4,[0],2,'brick');model.swept_roof(0,4.4,0,10.4,3.4,1.4)
    model.pose=(*tip,0);pavilion(model,6.25,3.8)
    model.box(0,3.1,2.55,2.1,.55,.14,'sign')


if __name__=='__main__':generate('diecai',build,'F')
