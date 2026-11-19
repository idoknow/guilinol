"""North blocks of pedestrian ways 221821082/258909992. Arcade spans ~5 m,
three ~3.4 m floors; 2018 references for balustrades and four-faced clock.
Clock placement/height approximate. No unverified underground entrance.
"""
import math
import numpy as np
from jingjiang import generate


def clock(model):
    model.beam([0,.16,0],[0,.27,0],4.4,'granite',40,True)
    for east in (-1,1):
        for south in (-1,1):
            model.box(east*2.25,.27,south*2.25,1.25,.82,1.25,'granite',True)
            model.beam([east*2.25,1.09,south*2.25],[east*.95,8.1,south*.95],.25,'red',5,True)
            model.beam([east*.95,8.1,south*.95],[0,14.85,0],.19,'red',5)
    for index in range(4):
        theta=index*math.pi/2; outward=np.array([math.cos(theta),0,math.sin(theta)]);horizontal=np.array([-math.sin(theta),0,math.cos(theta)]);up=np.array([0,1,0]);center=outward*1.15+up*8.2
        model.beam(center,center+outward*.24,1.35,'clock',32)
        face=center+outward*.27
        for hour in range(12):
            angle=hour*math.pi/6;direction=horizontal*math.sin(angle)+up*math.cos(angle);model.beam(face+direction*.96,face+direction*1.18,.045,'white',4)
        model.beam(face,face+horizontal*.52+up*.41,.07,'white');model.beam(face,face-horizontal*.58+up*.64,.055,'white')


def boulevard(model):
    model.pose=(0,0,0,.16);clock(model)
    for block in range(4):
        center=block*25
        model.box(0,0,center,18,.14,25,'pave',True)
        for stripe in (-5.6,0,5.6):
            for zz in np.linspace(center-12.5,center+12.5,17)[:-1]:
                strip=[]
                for station in (zz,zz+25/16):
                    offset=stripe+.82*math.sin(station*math.pi/9)
                    strip.extend([(offset-.27,.155,station),(offset+.27,.155,station)])
                model.mesh(strip,[[0,2,3],[0,3,1]],'tile')
        for side in (-1,1):
            model.box(side*7.6,.14,center,1.3,.04,25,'granite')
            model.box(side*14.4,0,center,7.4,10.2,22,'white' if block%2==0 else 'earth',True)
            for floor in (3.35,6.65):model.box(side*10.1,floor,center,3.5,.32,22.3,'white')
            for offset in np.linspace(-10,10,5 if model.detail else 2):
                model.box(side*8.7,.12,center+offset,.6,3.3,.62,'granite',True)
                if model.detail:
                    for floor in (.3,3.9,7.2):model.box(side*10.64,floor,center+offset,.18,2.25,3.3,'glass')
                    model.box(side*10.48,.18,center+offset,.16,2.45,1.16,'wood');model.box(side*10.36,.52,center+offset,.12,1.8,.91,'glass')
                    model.box(side*10.42,2.56,center+offset,.24,.65,3.85,['red','earth','tile'][block%3])
                    for glyph in (-.9,0,.9):model.box(side*10.25,2.72,center+offset+glyph,.1,.32,.26,'white')
            if model.detail:
                for floor in (3.68,6.98):
                    model.box(side*8.59,floor+.84,center,.26,.19,22,'white')
                    for offset in np.linspace(-10.6,10.6,15):
                        zz=center+offset
                        model.beam([side*8.59,floor,zz],[side*8.59,floor+.68,zz],.10,'white',6)
                        model.beam([side*8.59,floor+.21,zz],[side*8.59,floor+.44,zz],.17,'white',5)
                        model.box(side*8.59,floor+.65,zz,.18,.2,.18,'white')
            if block%2==0:
                east=side*6;zz=center+8
                model.beam([east,0,zz],[east,6.5,zz],.23,'wood',7,True)
                for leaf in range(9 if model.detail else 4):
                    angle=leaf*2.4;dx,dz=math.cos(angle),math.sin(angle)
                    model.mesh([(east,6.4,zz),(east+1.6*dx+.5*dz,7.4,zz+1.6*dz-.5*dx),(east+3.4*dx,5.8,zz+3.4*dz),(east+1.6*dx-.5*dz,7.4,zz+1.6*dz+.5*dx)],[[0,1,2],[0,2,3]],'leaf')


if __name__=='__main__':generate('zhengyang',boulevard)
