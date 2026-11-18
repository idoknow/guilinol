"""OSM 693451306 and its two road axes: ~281 m long, ~43 m wide.
The 2001 six-lane crossing (not the narrow 1972 bridge) has broad walks.
Heights follow the baked west/east road approaches; pier spacing and fascia
are estimates from bank views, not engineering sections.
"""
import math
import numpy as np
from xiaoyao_tower import generate


def arch(model, center, radius, width, spring, rise, top, blocks=False):
    count = 24 if model.detail else 8
    for idx in range(count):
        angles=np.pi*np.array([idx,idx+1])/count
        ends=center+radius*np.cos(angles); lows=spring+rise*np.sin(angles)
        corners=[(east,height,side*width/2) for side in (-1,1) for east,height in
                 [(ends[0],lows[0]),(ends[1],lows[1]),(ends[1],top),(ends[0],top)]]
        model.mesh(corners,[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1]],'stone')
        if blocks and model.detail:
            for side in (-1,1):
                face=[(center+(radius+dr)*math.cos(angle),spring+(rise+dr)*math.sin(angle),side*(width/2+.04))
                      for angle,dr in [(angles[0],0),(angles[1],0),(angles[1],.42),(angles[0],.42)]]
                model.mesh(face,[[0,1,2],[0,2,3]],'white' if idx%4==0 else 'granite')


def rail(model, length, offset, height, step, stone=False):
    for side in (-1,1):
        south=side*offset
        model.box(0,height+.92,south,length,.16,.2,'white' if stone else 'granite',True)
        for east in np.linspace(-length/2,length/2,max(2,int(length/(step if model.detail else step*4)))):
            model.box(east,height,south,.24,1.1,.24,'stone' if stone else 'granite',True)
            if model.detail:
                model.box(east,height+1.08,south,.31,.12,.31,'white')
        if model.detail:
            model.box(0,height+.35,south,length,.11,.12,'granite')


def bridge(model):
    length=281; width=43
    model.box(0,-1.22,0,length,1.22,width,'stone',True)
    model.box(0,-.03,0,length,.08,23,'tile')
    for side in (-1,1):
        model.box(0,0,side*16.5,length,.18,9.8,'pave',True)
        if model.detail:
            for lane in (3.7,7.4):
                for east in np.arange(-135,138,9):model.box(east,.055,side*lane,3,.02,.13,'white')
        for east in np.arange(-126,127,21 if model.detail else 42):
            model.beam([east,.18,side*18],[east,6.2,side*18],.14,'wood',8 if model.detail else 4)
            for arm in (-1,1):
                if not model.detail and arm<0:continue
                model.beam([east,5.8,side*18],[east+arm*1.05,6.48,side*18],.08,'wood')
                model.box(east+arm*1.05,6.48,side*18,.55,.28,.42,'lamp')
    for pier in (-92,0,92):
        model.box(pier,-8,0,4.4,6.85,width-2,'stone')
        for side in (-1,1):
            model.beam([pier,-8,side*(width/2-1)],[pier,-1.1,side*(width/2-1)],2.2,'stone',10)
    for start,end in zip((-140.5,-92,0,92),(-92,0,92,140.5)):
        arch(model,(start+end)/2,(end-start)/2,width-2,-5.5,4.1,-1.2)
    rail(model,length,21.1,.18,2.1)


if __name__=='__main__':generate('jiefang_bridge',bridge,lift=lambda east:5.62-east*1.3/281)
