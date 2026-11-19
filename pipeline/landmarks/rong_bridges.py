import math

import numpy as np

from c_kit import box, cylinder, tube


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
                rise = math.sin(math.pi*fraction)*.85 if arched else 0
                height = heights[index]*(1-fraction)+heights[index+1]*fraction+rise
                return [np.array([pos[0],height,pos[1]]) for pos in
                        (left*(1-fraction)+end_left*fraction,right*(1-fraction)+end_right*fraction)]
            near_left,near_right = section(panel/count)
            far_left,far_right = section((panel+1)/count)
            surface = [near_left,near_right,far_right,far_left]
            stone.face(surface,(0,1,0),'granite',1.4)
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
                cylinder(stone,middle-[0,4,0],.42,3.8,'ashlar',6)


def nine_bends(builder):
    crossing(builder,NINE_BENDS,[2.8,2.8,2.8,2.8,4.2,4.2,2.8,2.8,2.8,2.8],
             [.12,.55,.55,.55,.55,.55,.55,.55,.55,.25],5)
