"""Mingyue Peak, node 4780961462, within park 188580617. Stair elevations
sample the existing mountain; the turns and wind-cave location are inferred,
not surveyed. The summit pavilion is scaled to a ~1.7 m visitor.
"""
import math
import numpy as np
from fubo import mountain,pavilion,grotto
from xiaoyao_tower import generate


def build(model):
    rings,tip=mountain('明月峰');count=rings.shape[1]
    def point(progress):
        height=1+10*progress;phase=(.14+1.16*progress)*count
        index=int(phase)%count;fraction=phase%1
        strip=rings[:,index]*(1-fraction)+rings[:,(index+1)%count]*fraction
        layer=min(10,int(height));fraction=height-layer
        position=strip[layer]*(1-fraction)+strip[layer+1]*fraction
        radial=position[[0,2]]-tip[[0,2]];radial/=np.linalg.norm(radial)
        position[[0,2]]+=radial*1.7
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
    location=point(.34);direction=point(.342)-location
    model.pose=(*location,math.atan2(direction[2],direction[0])-math.pi/2);grotto(model,2.9,3.1,5.8)
    model.pose=(*tip,0);pavilion(model,6.25,3.8)
    model.box(0,3.1,2.55,2.1,.55,.14,'sign')


if __name__=='__main__':generate('diecai',build,'F')
