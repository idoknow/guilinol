import math

import numpy as np

from c_kit import box, cylinder, tube, yaw_box, ramp, segment_wall
from rong_paving import pave
from rong_ground import BANK, BANK_EDGE, BANK_Y, FORECOURT, FORECOURT_Y, BRIDGE_AXIS, BRIDGE_SIDE, bridge_xz
from rong_solids import oval, loft


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
                # Rock's bridge views show the water through two stone rails.
                for level in (.36,.89):
                    tube(stone,start+[0,level,0],end+[0,level,0],.095,'white',4)
                if builder.collide:
                    builder.hit.face([start,end,end+[0,.98,0],start+[0,.98,0]],-normal,'ashlar',None)
                high = 1.17 if panel==0 else .99
                box(stone,start+[0,high/2,0],(.24,high,.24),'white')
                box(stone,start+[0,high,0],(.31,.12,.31),'white')
            if not arched and panel%3==0:
                middle = (near_left+near_right)/2
                cylinder(stone,middle-[0,4,0],.42,3.8,'ashlar',6)


def nine_bends(builder):
    # Landward end of way/684946201, meeting the first deck of way/221475379.
    stone = builder.parts['atlas']
    pave(builder,BANK,BANK_Y)
    for start,end in zip(BANK_EDGE,BANK_EDGE[1:]):
        segment_wall(stone,start,end,BANK_Y-1.15,BANK_Y,.3,'ashlar')
    for i,(x,z) in enumerate(((79,39.6),(82,38.6),(85,37.8),(90,33.3),(94,30))):
        # Layered, low limestone outcrops straddle the mapped waterline.
        reach = 1.65+i%2*.35
        loft(stone,[(x,BANK_Y-1.1,z+1.3,reach,1.1),
                    (x-.15,BANK_Y-.3,z+.9,reach+.4,1.35),
                    (x+.18,BANK_Y+.12,z+.7,reach,.95),
                    (x+.38,BANK_Y+.3+i%3*.16,z+.5,reach*.52,.55)],'rubble',9)
    ramp(stone,(75.1,BANK_Y,34.4),(75.2,-3.9,38.2),2.8)
    if builder.collide:
        ramp(builder.hit,(75.1,BANK_Y,34.4),(75.2,-3.9,38.2),2.8)
    crossing(builder,NINE_BENDS,[2.8,2.8,2.8,2.8,4.2,4.2,2.8,2.8,2.8,2.8],
             [-3.9,-2.75,-2.55,-2.4,-1.9,-1.9,-1.65,-1.1,-.65,.25],5)


def ancient_bridge(builder):
    stone = builder.parts['atlas']
    axis, side = BRIDGE_AXIS, BRIDGE_SIDE
    yaw = math.atan2(*axis)
    def point(distance,level,offset=0):
        east,south = bridge_xz(distance,offset)
        return np.array([east,level,south])
    def height(distance):
        return -3.05+6.6*max(0,1-(abs(distance)/17)**1.55)
    def soffit(distance):
        return -4.85+math.sqrt(max(0,7.45**2-distance**2))
    count = 64 if builder.detail else 24
    for index in range(count):
        start,end = -17+34*index/count,-17+34*(index+1)/count
        middle = (start+end)/2
        top = height(middle)
        for offset in (-2.65,2.65):
            yaw_box(stone,point(middle,top-.14,offset),(4.0,.28,end-start+.02),yaw,'granite')
            edge_station = start if middle < 0 else end
            yaw_box(stone,point(edge_station,top-.015,offset),(4.04,.055,.075),yaw,'limestone')
        yaw_box(stone,point(middle,top+.10),(1.4,.46,end-start+.025),yaw,'ashlar')
        yaw_box(stone,point(middle,top+.43),(1.26,.36,end-start+.03),yaw,'foliage')
        if index % (3 if builder.detail else 2) == 0:
            oval(stone,point(middle,top+.62),(.66,.26,.78),'foliage',7)
        if builder.collide:
            for offset in (-2.65,2.65):
                ramp(builder.hit,point(start,height(start),offset),point(end,height(end),offset),4.0)
            yaw_box(builder.hit,point(middle,top+.21),(1.4,.68,end-start+.03),yaw,'ashlar')
        inside_start,inside_end = soffit(start),soffit(end)
        stone.face([point(start,inside_start,-4.65),point(end,inside_end,-4.65),point(end,inside_end,4.65),point(start,inside_start,4.65)],(0,-1,0),'ashlar')
        for sign in (-1,1):
            tube(stone,point(start,height(start)+.48,sign*.78),
                 point(end,height(end)+.48,sign*.78),.11,'white',5)
            edge=sign*4.65
            stone.face([point(start,inside_start,edge),point(end,inside_end,edge),point(end,top,edge),point(start,top,edge)],(sign*side[0],0,sign*side[1]),'white')
            tube(stone,point(start,height(start)+.92,edge),point(end,height(end)+.92,edge),.12,'white',5)
            if index%2==0:
                box(stone,point(start,height(start)+.48,edge),(.27,.96,.27),'white')
    pave(builder,FORECOURT,FORECOURT_Y)
    for step in range(3):
        start = -23+step*2
        level = FORECOURT_Y + (height(-17)-FORECOURT_Y)*(step+1)/3
        yaw_box(stone,point(start+1,(level+FORECOURT_Y)/2),
                (13.0-step,level-FORECOURT_Y,2.03),yaw,'granite')
    yaw_box(stone,point(-18.2,height(-17)+.23),(2.1,.52,2.6),yaw,'ashlar')
    for offset in (-.55,0,.55):
        oval(stone,point(-18.2,height(-17)+.77,offset),(.52,.55,1.22),'foliage',9)
    if builder.collide:
        yaw_box(builder.hit,point(-18.2,height(-17)+.39),(2.1,.8,2.6),yaw,'ashlar')
        ramp(builder.hit,point(-23,FORECOURT_Y),point(-17,height(-17)),11)
    yaw_box(stone,point(19,-3.22),(9,.45,4.4),yaw,'granite')
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
