"""North blocks of pedestrian ways 221821082/258909992. Arcade spans ~5 m,
three ~3.4 m floors; 2018 references for balustrades and four-faced clock.
Clock placement/height approximate. No unverified underground entrance.
"""
import math
import numpy as np
from jingjiang import generate


def clock(model):
    for east in (-1,1):
        for south in (-1,1):
            model.beam([east*2,0,south*2],[east*.82,12,south*.82],.18,'red',6,True)
            if model.detail:
                for level in range(4):
                    low=2-level*.27;high=low-.27
                    model.beam([east*low,level*2.8,south*low],[-east*high,(level+1)*2.8,south*high],.08,'red')
    model.box(0,11.8,0,2.4,2.4,2.4,'red')
    for side in (-1,1):
        model.box(side*1.23,12.1,0,.12,1.85,1.85,'clock');model.box(0,12.1,side*1.23,1.85,1.85,.12,'clock')
    model.roof(0,14.2,0,3,3,1.15)


def boulevard(model):
    model.pose=(0,0,0,.16);clock(model)
    for block in range(-3,4):
        center=block*25
        model.box(0,0,center,18,.14,25,'pave',True)
        for side in (-1,1):
            model.box(side*7.6,.14,center,1.3,.04,25,'granite')
            model.box(side*14.4,0,center,7.4,10.2,22,'white' if block%2==0 else 'earth',True)
            for floor in (3.35,6.65):model.box(side*10.1,floor,center,3.5,.32,22.3,'white')
            for offset in np.linspace(-10,10,5 if model.detail else 2):
                model.box(side*8.7,.12,center+offset,.6,3.3,.62,'granite',True)
                if model.detail:
                    for floor in (.3,3.9,7.2):model.box(side*10.64,floor,center+offset,.18,2.25,3.3,'glass')
            if model.detail:
                for floor in (3.68,6.98):
                    model.box(side*8.59,floor+.84,center,.26,.19,22,'white')
                    for offset in np.linspace(-10.6,10.6,19):
                        zz=center+offset
                        model.beam([side*8.59,floor,zz],[side*8.59,floor+.68,zz],.14,'white',6)
                        model.box(side*8.59,floor+.65,zz,.18,.2,.18,'white')
            if block%2==0:
                east=side*6;zz=center+8
                model.beam([east,0,zz],[east,6.5,zz],.23,'wood',7,True)
                for leaf in range(9 if model.detail else 4):
                    angle=leaf*2.4;dx,dz=math.cos(angle),math.sin(angle)
                    model.mesh([(east,6.4,zz),(east+1.6*dx+.5*dz,7.4,zz+1.6*dz-.5*dx),(east+3.4*dx,5.8,zz+3.4*dz),(east+1.6*dx-.5*dz,7.4,zz+1.6*dz+.5*dx)],[[0,1,2],[0,2,3]],'leaf')


if __name__=='__main__':generate('zhengyang',boulevard)
