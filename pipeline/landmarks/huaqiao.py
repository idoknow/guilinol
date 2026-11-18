"""OSM 246520676 describes ~71 m of the water crossing, NW to SE, not
the entire approach. IDOK-22: four covered water arches and seven open
dry arches. The latter follow the NW approach (OSM way 191185434).
Dimensions from OSM and pedestrian scale: covered walk ~6 m, posts ~3 m.
"""
import numpy as np
from jiefang_bridge import arch,rail
from xiaoyao_tower import generate


def bridge(model):
    water = np.linspace(-35.2,35.2,5)
    dry = np.linspace(-89.8,water[0],8)
    piers = np.r_[dry[:-1],water]
    for left,right in zip(piers,piers[1:]):
        wet = left >= water[0]
        center = (left+right)/2
        spring = -4.9 if wet else -3.75
        arch(model,center,(right-left)/2-.48,7.2,spring,-spring-.98,-.38,True)
        for side in (-1,1):
            model.box(center,-1.02,side*3.65,.56,.67,.24,'granite')
    for east in piers:
        model.box(east,-6,0,.98,5.62,7.2,'stone')
        if water[0] < east < water[-1]:
            for side in (-1,1):
                nose=[(east+dx,y,side*z) for y in (-5.8,-1.6) for dx,z in ((-.55,3.6),(.55,3.6),(0,5.15))]
                model.mesh(nose,[[0,1,4],[0,4,3],[1,2,5],[1,5,4],[2,0,3],[2,3,5],[3,4,5]],'granite')
    center=(piers[0]+piers[-1])/2
    model.box(center,-.4,0,125,.5,7.35,'pave',True)
    model.pose=(center,0,0,0)
    rail(model,125,3.45,.1,2,True)
    model.pose=(0,0,0,0)
    for east in np.linspace(-33.8,33.8,19 if model.detail else 9):
        for side in (-1,1):
            model.beam([east,.1,side*2.72],[east,3.45,side*2.72],.19,'red',8 if model.detail else 4,True)
            if model.detail:
                for tier in range(3):model.box(east,2.85+tier*.17,side*2.72,.42+tier*.28,.17,.45+tier*.25,'wood')
        model.box(east,3.37,0,.3,.34,6.65,'wood')
    for center in (-23.5,0,23.5):
        model.swept_roof(center,3.57,0,24.2,8.25,1.82)
        if model.detail:
            for east in np.arange(center-10.7,center+11,.45):
                for side in (-1,1):model.beam([east,3.8,side*3.6],[east,5.29,side*.35],.07,'tile',4)


if __name__=='__main__':generate('huaqiao',bridge,'F',lambda east:np.interp(east,[-35,0,35],[4.02,4.02,3.02]))
