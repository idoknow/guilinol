"""North entrance paving. The bell tower has its own surveyed anchor."""
import math
import numpy as np
from jingjiang import generate
from c_kit import landmark_surface


def boulevard(model):
    model.ground_offset = landmark_surface('zhengyang').ground
    model.pose=(0,0,0,.16)
    for block in range(4):
        center=block*25
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
            model.box(side*7.6,.14,center,1.3,.04,25,'granite')


if __name__=='__main__':generate('zhengyang',boulevard)
