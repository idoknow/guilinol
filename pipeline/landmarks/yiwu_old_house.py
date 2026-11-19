"""Unplaced photo study. Do not register a footprint until Rock confirms it."""
import math
import numpy as np
from xiaoyao_tower import generate


def house(model):
    model.box(0,-.3,0,16,11.9,9,'brick',True)
    for level in range(3):
        base=.76+level*3.6
        model.box(0,base-.4,0,16.3,.23,9.25,'earth')
        for east in (-5.8,-2.9,0,2.9,5.8):
            model.box(east,base,-4.54,1.65,2.12,.12,'sign')
            for side in (-1,1):model.box(east+side*.88,base,-4.65,.18,1.72,.27,'earth')
            for idx in range(9):
                angles=np.linspace(0,math.pi,10)[idx:idx+2]
                points=[(east+radius*math.cos(angle),base+1.70+radius*math.sin(angle),-4.78) for radius,angle in [(.79,angles[0]),(.99,angles[0]),(.99,angles[1]),(.79,angles[1])]]
                model.mesh(points,[[0,1,2],[0,2,3]],'earth')
            model.box(east,base,-4.64,.085,2.08,.08,'wood')
    for east in (-7.9,7.9):model.box(east,0,-4.52,.68,11.5,.55,'brick',True)
    for idx in range(3):model.box(0,11.4+idx*.16,0,16.3+idx*.26,.18,9.3+idx*.26,'granite')
    for east in range(-7,8):model.box(east,11.1,-4.76,.24,.39,.36,'gold')
    for east in np.arange(-3,3.1,.24):model.box(east,0,-7.1,.045,1.9+.32*math.cos(east),.06,'tile')
    for height in (.4,1.6):model.box(0,height,-7.1,6.2,.09,.08,'tile')
    for east in (-3.2,3.2):
        model.box(east,0,-7.1,.48,2.45,.5,'brick',True)
        model.box(east,2.45,-7.1,.63,.14,.62,'granite')
    for east in np.arange(-2.8,3,.4):
        angle=np.linspace(0,math.tau,9)
        scroll=[(east+.17*math.cos(t),1.2+.31*math.sin(t),-7.16) for t in angle]
        for start,end in zip(scroll,scroll[1:]):model.beam(start,end,.024,'tile',4)


if __name__=='__main__':generate('yiwu_old_house',house,colors=dict(brick='#53595c',tile='#292b2c',earth='#98523e'))
