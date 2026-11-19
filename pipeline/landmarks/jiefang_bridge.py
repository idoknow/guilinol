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
        for east in np.linspace(-length/2,length/2,max(2,int(length/(step if model.detail else step*6)))):
            model.box(east,height,south,.24,1.1,.24,'stone' if stone else 'granite',True)
            if model.detail:
                model.box(east,height+1.08,south,.31,.12,.31,'white')
        if model.detail:
            model.box(0,height+.35,south,length,.11,.12,'granite')


def pillar(model, x, z, tone):
    # Open rectangular lantern tower, with nested peaked outlines in 37/42/45.
    model.box(x,0,z,3.4,.44,2.4,'granite',True)
    for depth in (-.72,.72):
        for offset in (-1.2,1.2):
            model.box(x+offset,.44,z+depth,.22,6.8,.21,tone,True)
            model.beam([x+offset,7.24,z+depth],[x,8.48,z+depth],.15,tone)
        model.box(x,6.3,z+depth,2.45,.2,.18,'granite')
    for y in np.arange(1.45,6,.8):
        model.box(x,y,z,.55,.5,.35,'lamp')


def pendant(model, x, y, z):
    model.beam([x,y,z],[x,y+4.6,z],.095,'granite',8)
    model.beam([x,y+4.15,z],[x+.8,y+4.6,z],.075,'granite')
    model.box(x+.8,y+3.72,z,.38,.65,.38,'lamp')
    model.box(x+.8,y+4.37,z,.55,.14,.55,'wood')
    model.box(x+.8,y+3.66,z,.46,.09,.46,'wood')


def west_bank(model):
    # Both paths leave the deck tangentially, descend around the planted
    # islands, and meet the straight lower promenade at x=-116.
    for side, tone in ((-1,'jade'),(1,'violet')):
        for x in (-139,-126):
            pillar(model,x,side*19,tone)
        points=[]
        for angle in np.linspace(0,math.pi*1.5,37 if model.detail else 17):
            t=angle/(math.pi*1.5)
            x=-140-24*math.sin(angle)
            z=side*(41-24*math.cos(angle))
            y=.18+2*math.sin(math.pi*t)-4.1*t
            points.append((x,y,z))
        for index,(a,b) in enumerate(zip(points,points[1:])):
            def edge(point, at, sign):
                angle=at/(len(points)-1)*math.pi*1.5
                return [point[0]-sign*2.5*math.sin(angle),point[1],point[2]-sign*side*2.5*math.cos(angle)]
            left,right=edge(a,index,-1),edge(a,index,1)
            far_left,far_right=edge(b,index+1,-1),edge(b,index+1,1)
            model.mesh([left,right,far_right,far_left],[[0,1,2],[0,2,3],[2,1,0],[3,2,0]],'pave',True)
            model.beam(np.add(right,[0,.93,0]),np.add(far_right,[0,.93,0]),.09,'granite',6,True)
            model.beam(right,np.add(right,[0,1,0]),.075,'granite')
            if model.detail and index in (6,17,29):
                pendant(model,*left)
        model.box(-151,1.3,side*42,9,.65,13,'leaf')
        model.beam([-143,.2,side*12],[-143,5.2,side*12],.14,'granite')
        model.box(-143,4.3,side*12,.48,1.23,.4,'sign')
        model.box(-143.26,5.12,side*12,.08,.25,.25,'red')
    model.box(-116,-4.25,0,5,.33,82,'pave',True)
    model.box(-113.6,-3.92,0,.25,.38,82,'granite',True)
    model.box(-113.6,-3.05,0,.12,.12,82,'granite',True)
    for z in range(-40,41,4):
        model.box(-113.6,-3.54,z,.16,.6,.16,'granite')
        if abs(z)>22 and z%12==0:
            pendant(model,-118.3,-3.92,z)


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
            model.beam([east,6,side*18],[east,6.65,side*16.4],.09,'granite')
            model.box(east,6.55,side*16.4,.35,.17,.9,'lamp')
    for pier in (-92,0,92):
        model.box(pier,-8,0,4.4,6.85,width-2,'stone')
        for side in (-1,1):
            model.beam([pier,-8,side*(width/2-1)],[pier,-1.1,side*(width/2-1)],2.2,'stone',10)
    for side in (-1,1):
        model.box(0,-.65,side*21.4,length,.12,.15,'lamp')
        for east in np.linspace(-136,136,35 if model.detail else 13):
            model.box(east,1.26,side*21.1,.55,.24,.39,'lamp')
    for start,end in ((-92,0),(0,92),(92,140.5)):
        arch(model,(start+end)/2,(end-start)/2,width-2,-5.5,4.1,-1.2)
    rail(model,length,21.1,.18,2.1)
    west_bank(model)


if __name__=='__main__':generate('jiefang_bridge',bridge,lift=lambda east:5.62-east*1.3/281)
