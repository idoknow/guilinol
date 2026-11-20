"""North entrance paving. The bell tower has its own surveyed anchor."""
import math
from pathlib import Path
import sys
import numpy as np
from jingjiang import generate
from c_kit import landmark_surface


def boulevard(model):
    frame = landmark_surface('zhengyang')
    model.ground_offset = frame.ground
    model.pose=(0,0,0,.16)
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from seam_streets import Streets
    streets = Streets(frame.surface)
    cosine,sine = math.cos(.16),math.sin(.16)
    def entrance_grade(x,z):
        station = -sine*x+cosine*z
        ground = frame.ground(x,z)
        end,direction = (-12.5,-1) if station<0 else (87.5,1)
        weight = max(0,1-abs(station-end)/4.5)
        if not weight: return ground
        offset = end-station+direction*.04
        road,_ = streets.at(frame.x+x-sine*offset,frame.z+z+cosine*offset)
        return ground + weight*(road-frame.y-.14-ground)
    for block in range(4):
        center=block*25
        model.ground_offset = entrance_grade
        for station in np.linspace(center-12.5,center+12.5,17)[:-1]:
            model.box(0,0,station+25/32,18,.14,25/16,'pave',True)
        for stripe in (-5.6,0,5.6):
            for zz in np.linspace(center-12.5,center+12.5,17)[:-1]:
                strip=[]
                for station in (zz,zz+25/16):
                    offset=stripe+.82*math.sin(station*math.pi/9)
                    strip.extend([(offset-.27,.146,station),(offset+.27,.146,station)])
                model.mesh(strip,[[0,2,3],[0,3,1]],'tile')
        for side in (-1,1):
            for station in np.linspace(center-12.5,center+12.5,17)[:-1]:
                model.box(side*7.6,.14,station+25/32,1.3,.04,25/16,'granite')


if __name__=='__main__':generate('zhengyang',boulevard)
