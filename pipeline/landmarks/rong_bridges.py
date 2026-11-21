import math

import numpy as np

from c_kit import box, cylinder, tube, yaw_box, ramp, segment_wall
from rong_paving import pave
from rong_ground import BANK, BANK_EDGE, BANK_Y, FORECOURT, BRIDGE_AXIS, BRIDGE_SIDE, bridge_xz
from rong_solids import oval, loft
from rong_surface import ground, bank_top, island_top


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
                rise = 2.15*min(fraction/.48, (1-fraction)/.26, 1) if arched else 0
                height = heights[index]*(1-fraction)+heights[index+1]*fraction+rise
                return [np.array([pos[0],height,pos[1]]) for pos in
                        (left*(1-fraction)+end_left*fraction,right*(1-fraction)+end_right*fraction)]
            near_left,near_right = section(panel/count)
            far_left,far_right = section((panel+1)/count)
            surface = [near_left,near_right,far_right,far_left]
            if arched:
                # Level stone treads over a continuous walkable ramp.
                steps = 4 if builder.detail else 2
                for tread in range(steps):
                    a0,a1 = section((panel+tread/steps)/count)
                    b0,b1 = section((panel+(tread+1)/steps)/count)
                    y = max(a0[1],b0[1])
                    lip = [np.array([pt[0],y+.02,pt[2]]) for pt in (a0,a1,b1,b0)]
                    stone.face(lip,(0,1,0),'granite',1.4)
                    stone.face([a0,a1,lip[1],lip[0]],a0-b0,'ashlar')
                    stone.face([b1,b0,lip[3],lip[2]],b0-a0,'ashlar')

                def underside(point,fraction):
                    arch = math.sqrt(max(0,1-((fraction-.5)/.39)**2))
                    bed = ground(point[0],point[2])-.06
                    return bed+(point[1]-.50-bed)*arch
                soffit=[point.copy() for point in surface]
                for corner,point in enumerate(soffit):
                    point[1]=underside(point,(panel+int(corner>=2))/count)
                stone.face(soffit,(0,-1,0),'ashlar',1.1)
                for first,last in ((0,3),(1,2)):
                    outward=surface[first]-surface[1-first]
                    stone.face([soffit[first],soffit[last],surface[last],surface[first]],outward,'white',None)
            else:
                stone.face(surface,(0,1,0),'granite',1.4)
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
            # The two straight spans at the island landing bear on the bend
            # piers and the island abutment; keep their midspans open.
            pier_station = panel==0 if index>=len(path)-3 else panel%3==0
            if not arched and pier_station:
                middle = (near_left+near_right)/2
                x, top, z = middle
                bed = min(ground(x,z)-.15, top-.56)
                start=len(stone.pos)
                cylinder(stone,(x,bed,z),.42,top-bed,'ashlar',6)
                for i in range(start,len(stone.pos)):
                    px,py,pz=stone.pos[i]
                    if abs(py-bed)<.01:
                        stone.pos[i]=(px,ground(px,pz)-.08,pz)


def nine_bends(builder):
    lengths = np.r_[0, np.cumsum(np.linalg.norm(np.diff(NINE_BENDS,axis=0),axis=1))]
    near, far = ground(*NINE_BENDS[0])+.07, island_top()
    # Landward end of way/684946201, meeting the first deck of way/221475379.
    stone = builder.parts['atlas']
    pave(builder,BANK,lambda x,z: ground(x,z)+.05)
    bank_start=len(stone.pos)
    for start,end in zip(BANK_EDGE,BANK_EDGE[1:]):
        segment_wall(stone,start,end,BANK_Y-1.15,BANK_Y,.3,'ashlar')
    for i,(x,z) in enumerate(((79,39.6),(82,38.6),(85,37.8),(90,33.3),(94,30))):
        # Layered, low limestone outcrops straddle the mapped waterline.
        reach = 1.65+i%2*.35
        loft(stone,[(x,BANK_Y-1.1,z+1.3,reach,1.1),
                    (x-.15,BANK_Y-.3,z+.9,reach+.4,1.35),
                    (x+.18,BANK_Y+.12,z+.7,reach,.95),
                    (x+.38,BANK_Y+.3+i%3*.16,z+.5,reach*.52,.55)],'rubble',9)
    for i in range(bank_start,len(stone.pos)):
        x,y,z=stone.pos[i]
        bottom=y<BANK_Y-1
        stone.pos[i]=(x,ground(x,z)+(-.06 if bottom else y-BANK_Y+.40),z)
    ramp(stone,(75.1,ground(75.1,34.4)+.05,34.4),(75.2,near,38.2),2.8)
    if builder.collide:
        ramp(builder.hit,(75.1,ground(75.1,34.4)+.05,34.4),(75.2,near,38.2),2.8)
    crossing(builder,NINE_BENDS,[2.8,2.8,2.8,2.8,2.9,2.9,2.8,2.8,2.8,2.8],
             near+(far-near)*lengths/lengths[-1],5)


def ancient_bridge(builder):
    stone = builder.parts['atlas']
    axis, side = BRIDGE_AXIS, BRIDGE_SIDE
    yaw = math.atan2(*axis)
    def point(distance,level,offset=0):
        east,south = bridge_xz(distance,offset)
        return np.array([east,level,south])
    north, south = [bank_top(*point(d,0)[::2])+.16 for d in (-17,17)]
    toe = ground(*bridge_xz(-17, 0)) + .05
    north = max(north, toe + .48)
    def grade(distance):
        return north+(south-north)*min(1,max(0,(distance+17)/34))
    def height(distance):
        if distance < -14:
            return toe+(north-toe)*max(0,(distance+17)/3)
        span = 14 if distance < 0 else 15.4
        return grade(distance)+6.6*max(0,1-(abs(distance)/span)**1.55)
    def soffit(distance,edge):
        return ground(*point(distance,0,edge)[::2])-.09+math.sqrt(max(0,7.45**2-distance**2))
    count = 136
    for index in range(count):
        start,end = -17+34*index/count,-17+34*(index+1)/count
        middle = (start+end)/2
        top = height(middle)
        landing = abs(middle)>13.25
        for offset in (() if middle < -14 else (0,) if landing else (-2.65,2.65)):
            width = 9.3 if landing else 4.0
            yaw_box(stone,point(middle,top-.14,offset),(width,.28,end-start+.02),yaw,'granite')
            edge_station = start if middle < 0 else end
            yaw_box(stone,point(edge_station,top-.015,offset),(4.04,.055,.075),yaw,'limestone')
        if not landing:
            yaw_box(stone,point(middle,top+.10),(1.4,.46,end-start+.025),yaw,'ashlar')
            yaw_box(stone,point(middle,top+.43),(1.26,.36,end-start+.03),yaw,'foliage')
        if not landing and index % (6 if builder.detail else 12) == 0:
            oval(stone,point(middle,top+.62),(.66,.26,.78),'foliage',7)
        if builder.collide and middle >= -14:
            for offset in ((0,) if landing else (-2.65,2.65)):
                ramp(builder.hit,point(start,height(start),offset),point(end,height(end),offset),9.3 if landing else 4.0)
            if not landing:
                yaw_box(builder.hit,point(middle,top+.21),(1.4,.68,end-start+.03),yaw,'ashlar')
        stone.face([point(d,soffit(d,e),e) for d,e in ((start,-4.65),(end,-4.65),(end,4.65),(start,4.65))],(0,-1,0),'ashlar')
        for sign in (-1,1):
            if not landing:
                tube(stone,point(start,height(start)+.48,sign*.78),
                     point(end,height(end)+.48,sign*.78),.11,'white',5)
            edge=sign*4.65
            inside_start,inside_end=soffit(start,edge),soffit(end,edge)
            stone.face([point(start,inside_start,edge),point(end,inside_end,edge),point(end,top,edge),point(start,top,edge)],(sign*side[0],0,sign*side[1]),'white')
            tube(stone,point(start,height(start)+.92,edge),point(end,height(end)+.92,edge),.12,'white',5)
            if index%4==0:
                box(stone,point(start,height(start)+.48,edge),(.27,.96,.27),'white')
    pave(builder,FORECOURT,lambda x,z: ground(x,z)+.05)
    riser = (north-toe)/3
    for step in range(3):
        start = -17+step
        level = toe + riser*(step+1)
        half_width = (13-step)/2
        corners = [(start,-half_width),(start,half_width),
                   (start+1,half_width),(start+1,-half_width)]
        upper = [point(d,level,w) for d,w in corners]
        lower = [point(d,ground(*bridge_xz(d,w))-.06,w) for d,w in corners]
        stone.face(upper,(0,1,0),'granite')
        for i in range(4):
            j = (i+1)%4
            outward = (upper[i]+upper[j])/2 - point(start+1,level)
            stone.face([lower[i],lower[j],upper[j],upper[i]],outward,'ashlar')
        if builder.collide:
            ramp(builder.hit,point(start,level-riser),
                 point(start+1,level),half_width*2)
    planter = ground(*bridge_xz(-18.7,0))+.05
    yaw_box(stone,point(-18.7,planter+.23),(2.1,.52,2.6),yaw,'ashlar')
    for offset in (-.55,0,.55):
        oval(stone,point(-18.7,planter+.77,offset),(.52,.55,1.22),'foliage',9)
    if builder.collide:
        yaw_box(builder.hit,point(-18.7,planter+.39),(2.1,.8,2.6),yaw,'ashlar')
    # Tie the full landing into the bank, including the crown between its edges.
    def landing_vertex(station,lateral):
        x,_,z = point(station,0,lateral)
        fraction = (station-17)/4.2
        return point(station,(1-fraction)*grade(17)+fraction*ground(x,z),lateral)
    for start,end in ((17,19.1),(19.1,21.2)):
        for left,right in ((-4.5,-2.25),(-2.25,0),(0,2.25),(2.25,4.5)):
            top = [landing_vertex(s,l) for s,l in ((start,left),(start,right),(end,right),(end,left))]
            builder.parts['sidewalk'].face(top,(0,1,0),'granite')
            if builder.collide: builder.hit.face(top,(0,1,0),'granite')
            for outside,a,c in zip((start==17,right==4.5,end==21.2,left==-4.5),top,top[1:]+top[:1]):
                if outside:
                    stone.face([a,c,c-[0,.45,0],a-[0,.45,0]],(a+c)/2-point(19,0),'ashlar')
    colors=('lantern_red','lantern_gold','lantern_cyan','lantern_pink','lantern_orange')
    for strand in range(4):
        previous=None
        count=15 if builder.detail else 7
        for index in range(count):
            fraction=index/(count-1)
            knot=point(-23+strand*1.65,toe+4.5-1.15*math.sin(math.pi*fraction),-7+14*fraction)
            if index in (0,count-1):
                x,y,z=knot
                bed=ground(x,z)-.05
                cylinder(stone,(x,bed,z),.14,y-bed+.06,'wood',6)
            if previous is not None: tube(stone,previous,knot,.055,'wood',6)
            center=knot-[0,.32,0]
            tube(stone,knot,center,.055,'wood',6)
            oval(builder.parts['lit'],center,(.24,.24,.24),colors[(index+strand*2)%len(colors)],8 if builder.detail else 5)
            previous=knot
