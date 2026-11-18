"""OSM 1432324255 (octagonal tower footprint), 686005456 (East Town Gate)
and the through road 686005455. Wall runs across, not along, that road.
Roof tiers, crenellations and stair rises are visual estimates; the gate
is 4.3 m lower than the pagoda base in the world heightfield.
"""
import math
import numpy as np
from xiaoyao_tower import generate


def pagoda(model):
    model.beam([0,-.6,0],[0,.8,0],6.1,'stone',8,True)
    base=.8
    for tier in range(7):
        radius=6.5-tier*.43;height=5.15-tier*.27
        model.beam([0,base,0],[0,base+height,0],radius*.67,'brick',8,True)
        for face in range(8):
            angle=face*math.pi/4;cosine,sine=math.cos(angle),math.sin(angle)
            east,south=radius*.84*cosine,radius*.84*sine
            if model.detail:
                model.beam([east,base,south],[east,base+height-.45,south],.17,'red',8)
            if model.detail:
                model.pose=(radius*.64*cosine,base,radius*.64*sine,angle-math.pi/2)
                model.box(0,.45,0,radius*.44,height*.6,.15,'wood')
                for offset in np.linspace(-.16,.16,5):model.box(offset*radius,.58,.11,.075,height*.51,.09,'red')
                model.pose=(0,0,0,0)
            for outer,inner,low,high in [(1.28,1.28,-.35,0),(1.28,1.03,0,.26),(1.03,.56,.26,1.68)]:
                ends=np.array([[math.cos(theta),math.sin(theta)] for theta in (angle,angle+math.pi/4)])
                section=[]
                for along in np.linspace(0,1,7 if model.detail else 3):
                    direction=(1-along)*ends[0]+along*ends[1]
                    for scale,level in ((outer,low),(inner,high)):
                        east,south=radius*scale*direction
                        lift=.57*abs(2*along-1)**4*(scale/1.28)**4
                        section.append([east,base+height+level+lift,south])
                faces=[[i,i+1,i+2] for i in range(len(section)-2)]
                for i in range(1,len(faces),2):faces[i].reverse()
                model.mesh(section,faces,'wood' if low<0 else 'tile')
            if model.detail:
                model.pose=(radius*.78*cosine,base,radius*.78*sine,angle-math.pi/2)
                model.box(0,.8,0,radius*.65,.12,.16,'red')
                for baluster in np.linspace(-.29,.29,6):model.box(radius*baluster,0,0,.08,.8,.1,'wood')
                model.pose=(0,0,0,0)
        base+=height+.75
    model.beam([0,base,0],[0,base+3.6,0],.26,'gold',8)


def build(model):
    pagoda(model)
    model.pose=(112.565,-4.3,-127.411,1.26)
    model.arcade(0,0,15,11.8,6.6,[0],2.6,'stone')
    model.box(0,6.6,0,15.6,.48,12.2,'pave',True)
    model.box(0,7.08,0,7.2,3.2,5.4,'red',True)
    model.swept_roof(0,10.28,0,10.5,8,2.55)
    model.box(0,5.35,5.98,2.6,.65,.14,'sign')
    for side in (-1,1):
        length=32 if side<0 else 21;center=side*(7.5+length/2)
        model.box(center,-.55,0,length,7.15,6,'stone',True)
        model.box(center,6.6,0,length,.48,6.1,'pave',True)
        for bank in (-1,1):
            sections=[(center-length/2,center+length/2)]
            if side<0 and bank>0:
                sections=[(center-length/2,-26.2),(-23.5,center+length/2)]
            for start,end in sections:
                model.box((start+end)/2,7.08,bank*2.78,end-start,.55,.42,'brick',True)
                for east in np.arange(start+.55,end-.45,1.8 if model.detail else 5.4):model.box(east,7.63,bank*2.78,.95,.74,.42,'stone')
    steps=42 if model.detail else 10
    for step in range(steps):
        model.box(-39.5+step*14.28/steps,-.1,4.25,14.28/steps+.01,.1+(step+1)*7.08/steps,2.45,'pave',True)
    model.box(-24.85,6.75,3.6,1.2,.33,2.8,'pave',True)


if __name__=='__main__':generate('mulong',build,'F')
