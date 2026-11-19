"""Stone promenades flanking the original paired Jiefang West Road decks."""
import math
import numpy as np
import trimesh
from xiaoyao_tower import generate


def monument(model, station, lateral):
    for bottom,width,height in [(0,2.1,.3),(.3,1.85,.25),(.55,1.55,1.35),(1.9,1.7,.22),(2.12,1.25,4.8),(6.92,1.55,.25),(7.17,1.8,.3),(7.47,2.0,.2)]:
        model.box(station,bottom,lateral,width,height,width,'stone',True)
    for east in (-.62,.62):
        for south in (-.62,.62):
            model.box(station+east,2.1,lateral+south,.19,4.8,.19,'granite')
    for side in (-1,1):
        model.beam([station+side*.61,5.1,lateral],[station+side*.70,5.1,lateral],.41,'gold',12)


def promenade(model,side):
    for station in range(-50,51,2):
        for row in range(4):
            model.box(station,-.5,side*(13+row*2),2,.66,2,'pave' if (station//2+row)%2 else 'granite',True)
        model.box(station,.16,side*20,2,1.0,.30,'white',True)
        model.box(station,1.16,side*20,2,.18,.42,'stone')
        if station%4==0:
            model.box(station,.14,side*20,.45,1.34,.48,'stone',True)
        elif model.detail:
            for shift in (-.45,.45):
                angles=np.linspace(0,math.pi*1.6,6)
                points=[[station+shift+.28*math.cos(angle),.72+.20*math.sin(angle),side*19.82] for angle in angles]
                for start,end in zip(points,points[1:]):model.beam(start,end,.04,'granite',4)
    for station in (-35,0,35):
        points=[[station,0,side*17.4],[station,4.2,side*17.4],[station,5.0,side*17.1],[station,5.45,side*16.3],[station,5.50,side*15.6]]
        for start,end in zip(points,points[1:]):model.beam(start,end,.09,'tile')
        model.box(station,5.4,side*15.55,.33,.14,.62,'lamp')


def bridge(model):
    for side in (-1,1):
        promenade(model,side)
        monument(model,side*50,side*17.3)
    shrub=trimesh.creation.icosphere(subdivisions=1)
    model.mesh(shrub.vertices*[4,.95,1.8]+[59,.4,0],shrub.faces,'leaf')
    model.box(58,0,2.8,.14,4.1,.14,'granite')
    model.box(58,2.85,2.8,.11,1.0,2.4,'clock')
    model.box(60,0,4.7,.16,4.5,.16,'tile')
    model.box(60,3.9,4.7,.35,.97,.35,'tile')


if __name__=='__main__':
    generate('guanyi_bridge',bridge,lift=lambda station:np.interp(station,[-51,-30,0,30,51],[152.7,153.5,154.85,156.0,155.2])-147.5)
