import math

import numpy as np

from c_kit import box, cylinder, tube, yaw_box, ramp
from rong_surface import ground, bank_top, island_top
from rong_solids import oval, banyan


NINE_BENDS = [(75.2,38.2),(76.9,45.3),(88.7,53.5),(103.1,49.9),(109.4,63.1),
              (99.5,73),(101.7,88.1),(89.6,97.3),(92.9,111.4),(110,123.4)]


def section_edges(path, widths):
    centers = np.array(path)
    directions = np.diff(centers,axis=0)
    directions /= np.linalg.norm(directions,axis=1)[:,None]
    normals = directions[:,[1,0]] * [-1,1]
    for index,(center,width) in enumerate(zip(centers,widths)):
        before,after = normals[max(0,index-1)],normals[min(index,len(normals)-1)]
        bisector = (before+after)/(1+np.dot(before,after))
        yield center-bisector*width/2,center+bisector*width/2


def crossing(builder,path,widths,heights,arch_segment=None):
    stone = builder.parts['atlas']
    sections = list(section_edges(path,widths))
    for index,((left,right),(end_left,end_right)) in enumerate(zip(sections,sections[1:])):
        length = math.dist(path[index],path[index+1])
        count = math.ceil(length/(1.65 if builder.detail else 4.5))
        arched = index == arch_segment
        for panel in range(count):
            def section(fraction):
                rise = math.sin(math.pi*fraction)*2.15 if arched else 0
                height = heights[index]*(1-fraction)+heights[index+1]*fraction+rise
                return [np.array([pos[0],height,pos[1]]) for pos in
                        (left*(1-fraction)+end_left*fraction,right*(1-fraction)+end_right*fraction)]
            near_left,near_right = section(panel/count)
            far_left,far_right = section((panel+1)/count)
            surface = [near_left,near_right,far_right,far_left]
            stone.face(surface,(0,1,0),'granite',1.4)
            if arched:
                def underside(fraction):
                    return -4.9+3.72*math.sqrt(max(0,1-((fraction-.5)/.39)**2))
                soffit=[point.copy() for point in surface]
                for corner,point in enumerate(soffit):
                    point[1]=underside((panel+int(corner>=2))/count)
                stone.face(soffit,(0,-1,0),'ashlar',1.1)
                for first,last in ((0,3),(1,2)):
                    outward=surface[first]-surface[1-first]
                    stone.face([soffit[first],soffit[last],surface[last],surface[first]],outward,'white',None)
            if builder.collide:
                builder.hit.face(surface,(0,1,0),'granite',None)
            for start,end,side in ((near_left,far_left,-1),(near_right,far_right,1)):
                normal = (near_right-near_left)*side
                stone.face([start-[0,.55,0],end-[0,.55,0],end,start],normal,'ashlar',1.2)
                panel_face = [start+[0,.12,0],end+[0,.12,0],end+[0,.81,0],start+[0,.81,0]]
                stone.face(panel_face,normal,'white',1.2)
                stone.face(panel_face,-normal,'white',1.2)
                tube(stone,start+[0,.89,0],end+[0,.89,0],.095,'white',4)
                if builder.collide:
                    builder.hit.face([start,end,end+[0,.98,0],start+[0,.98,0]],-normal,'ashlar',None)
                high = 1.17 if panel==0 else .99
                box(stone,start+[0,high/2,0],(.24,high,.24),'white')
                box(stone,start+[0,high,0],(.31,.12,.31),'white')
            if not arched and panel%3==0:
                middle = (near_left+near_right)/2
                x, top, z = middle
                bed = min(ground(x,z)-.15, top-.56)
                cylinder(stone,(x,bed,z),.42,top-bed,'ashlar',6)


def nine_bends(builder):
    lengths = np.r_[0, np.cumsum(np.linalg.norm(np.diff(NINE_BENDS,axis=0),axis=1))]
    near, far = bank_top(*NINE_BENDS[0]), island_top()
    crossing(builder,NINE_BENDS,[2.8,2.8,2.8,2.8,4.2,4.2,2.8,2.8,2.8,2.8],
             near+(far-near)*lengths/lengths[-1],5)


def ancient_bridge(builder):
    stone = builder.parts['atlas']
    axis = np.array([-.51,.86]); axis /= np.linalg.norm(axis)
    side = np.array([axis[1],-axis[0]])
    yaw = math.atan2(*axis)
    def point(distance,level,offset=0):
        east,south = [31.4,82.1]+axis*distance+side*offset
        return np.array([east,level,south])
    north, south = [bank_top(*point(d,0)[::2]) for d in (-17,17)]
    def grade(distance):
        return north+(south-north)*min(1,max(0,(distance+17)/34))
    def height(distance):
        return grade(distance)+6.6*max(0,1-(abs(distance)/17)**1.55)
    def soffit(distance):
        return min(ground(*point(distance,0)[::2])-.15, grade(distance)-1.8)+math.sqrt(max(0,7.45**2-distance**2))
    count = 64 if builder.detail else 24
    for index in range(count):
        start,end = -17+34*index/count,-17+34*(index+1)/count
        middle = (start+end)/2
        top = height(middle)
        yaw_box(stone,point(middle,top-.10),(6.8,.2,end-start+.015),yaw,'granite')
        if builder.collide:
            ramp(builder.hit,point(start,height(start)),point(end,height(end)),6.8)
        inside_start,inside_end = soffit(start),soffit(end)
        stone.face([point(start,inside_start,-3.4),point(end,inside_end,-3.4),point(end,inside_end,3.4),point(start,inside_start,3.4)],(0,-1,0),'ashlar')
        for sign in (-1,1):
            edge=sign*3.4
            stone.face([point(start,inside_start,edge),point(end,inside_end,edge),point(end,top,edge),point(start,top,edge)],(sign*side[0],0,sign*side[1]),'white')
            tube(stone,point(start,height(start)+.92,edge),point(end,height(end)+.92,edge),.12,'white',5)
            if index%2==0:
                box(stone,point(start,height(start)+.48,edge),(.27,.96,.27),'white')
        if abs(middle)>9:
            yaw_box(stone,point(middle,top+.19),(.85,.38,end-start+.02),yaw,'rubble')
            yaw_box(stone,point(middle,top+.45),(.76,.16,end-start+.02),yaw,'foliage')
    for sign in (-1,1):
        yaw_box(stone,point(sign*19,grade(sign*19)-.225),(9,.45,4.4),yaw,'granite')
    for offset in (-7,7):
        banyan(stone,point(-20,ground(*point(-20,0,offset)[::2]),offset),9,5,32+offset,builder.detail)
    colors=('lantern_red','lantern_gold','lantern_cyan','lantern_pink','lantern_orange')
    for strand in range(4):
        previous=None
        count=15 if builder.detail else 7
        for index in range(count):
            fraction=index/(count-1)
            knot=point(-23+strand*1.65,3.8-1.15*math.sin(math.pi*fraction),-7+14*fraction)
            if previous is not None: tube(stone,previous,knot,.025,'wood',4)
            center=knot-[0,.32,0]
            tube(stone,knot,center,.026,'wood',4)
            oval(builder.parts['lit'],center,(.24,.24,.24),colors[(index+strand*2)%len(colors)],8 if builder.detail else 5)
            previous=knot
