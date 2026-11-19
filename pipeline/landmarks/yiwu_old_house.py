"""Yiwu Road brick house, centered on way/702352880; -z faces the street."""
import math
import numpy as np
from xiaoyao_tower import generate


def house(model):
    model.pose=(0,0,5.9,0)
    model.box(0,-.3,-1.8,16,11.9,5.4,'brick',True)
    for level in range(3):
        base=.76+level*3.6
        model.box(0,base-.4,-1.8,16.3,.23,5.65,'earth')
        for east in (-5.8,-2.9,0,2.9,5.8):
            opening=2.46 if level else 1.7
            model.box(east,base,-4.54,1.65,opening,.12,'sign')
            for side in (-1,1):model.box(east+side*.88,base,-4.65,.18,opening,.27,'earth')
            if level:
                model.box(east,base+opening,-4.65,1.95,.22,.28,'earth')
                model.box(east,base-.14,-4.65,2.0,.14,.32,'earth')
            for idx in range(0 if level else 9):
                angles=np.linspace(0,math.pi,10)[idx:idx+2]
                points=[(east+radius*math.cos(angle),base+1.70+radius*math.sin(angle),-4.78) for radius,angle in [(.79,angles[0]),(.99,angles[0]),(.99,angles[1]),(.79,angles[1])]]
                model.mesh(points,[[0,1,2],[0,2,3]],'earth')
                model.mesh([(east,base+1.70,-4.60),*[(east+.80*math.cos(angle),base+1.70+.80*math.sin(angle),-4.60) for angle in angles]],[[0,1,2]],'sign')
            model.box(east,base,-4.64,.085,2.45,.08,'wood')
    for east in (-7.9,7.9):model.box(east,0,-4.52,.68,11.5,.55,'brick',True)
    for idx in range(3):model.box(0,11.4+idx*.16,-1.8,16.3+idx*.26,.18,5.7+idx*.26,'granite')
    for east in range(-7,8):model.box(east,11.1,-4.76,.24,.39,.36,'gold')
    model.box(0,0,-5.01,15.4,.32,.57,'granite')
    model.box(0,.32,-5.01,15.18,.13,.43,'leaf')
    model.pose=(-10.1,0,7.9,0)
    for east in np.arange(-1.6,1.61,.20):model.box(east,0,-7.1,.045,1.9+.32*math.cos(east),.06,'tile')
    for height in (.4,1.6):model.box(0,height,-7.1,3.4,.09,.08,'tile')
    for east in (-1.8,1.8):
        model.box(east,0,-7.1,.48,2.45,.5,'brick',True)
        model.box(east,2.45,-7.1,.63,.14,.62,'granite')
    for east in np.arange(-1.4,1.6,.4):
        angle=np.linspace(0,math.tau,9)
        scroll=[(east+.17*math.cos(t),1.2+.31*math.sin(t),-7.16) for t in angle]
        for start,end in zip(scroll,scroll[1:]):model.beam(start,end,.024,'tile',4)


if __name__=='__main__':generate('yiwu_old_house',house,colors=dict(brick='#57534d',tile='#292b2c',earth='#98523e'))
