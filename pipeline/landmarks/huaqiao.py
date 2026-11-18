"""OSM 246520676 describes ~71 m of the water crossing, NW to SE, not
the entire approach. Four provisional water arches; no inferred dry spans.
Dimensions from OSM and pedestrian scale: covered walk ~6 m, posts ~3 m.
"""
import numpy as np
from jiefang_bridge import arch,rail
from xiaoyao_tower import generate


def bridge(model):
    for center in (-26.4,-8.8,8.8,26.4):
        arch(model,center,8.25,7.2,-4.6,3.85,-.42,True)
    for east in np.linspace(-35.2,35.2,5):
        model.box(east,-5,0,1.16,4.6,7.2,'stone')
    model.box(0,-.45,0,70.6,.55,7.35,'pave',True)
    rail(model,70.5,3.45,.1,2,True)
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
