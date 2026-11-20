"""North blocks of pedestrian ways 221821082/258909992. Frontages are owned by wangcheng_market and wangcheng_mall.
2018 references show the four-faced clock.
Clock placement/height approximate. No unverified underground entrance.
"""
import math
import numpy as np
from jingjiang import generate
from c_kit import landmark_surface


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
    model.ground_offset = landmark_surface('zhengyang').ground
    model.pose=(-11.5,0,71,.16);clock(model)
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
