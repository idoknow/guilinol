"""Republican-era arts hall, OSM 682942533. Local -z faces Jiefang West Rd."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from c_kit import landmark_surface
from xiaoyao_tower import generate


def arc(offset,height,radius):
    angle=offset/6.2
    return (radius*math.sin(angle),height,-17.7-radius*math.cos(angle))


def drum(model,radius,bottom,top,color):
    for start,end in zip(np.linspace(-math.pi/2,math.pi/2,33)[:-1],np.linspace(-math.pi/2,math.pi/2,33)[1:]):
        front=[arc(angle*6.2,level,radius) for level in (bottom,top) for angle in (start,end)]
        model.mesh(front+[(0,top,-17.7),(0,bottom,-17.7)],[[0,1,3],[0,3,2],[4,2,3],[5,1,0]],color)


def lettering(model):
    image=Image.new('1',(120,20)); draw=ImageDraw.Draw(image)
    draw.text((0,-2),'廣西省立藝術館',font=ImageFont.truetype('NotoSansCJK-Regular.ttc',16),fill=1)
    for row,pixels in enumerate(np.asarray(image)):
        edges=np.flatnonzero(np.diff(np.r_[False,pixels,False]))
        for left,right in edges.reshape(-1,2):
            x0,x1=4-left*.072,4-right*.072;top=4.92-row*.045
            model.mesh([arc(offset,level,6.223) for offset,level in [(x0,top),(x1,top),(x1,top-.045),(x0,top-.045)]],[[0,1,2],[0,2,3]],'sign')


def window(model,x,y,z,width,height):
    model.box(x,y,z,width,height,.20,'white')
    model.box(x,y+.34,z-.13,width-.66,height-.72,.14,'glass')
    if model.detail:
        for offset in (-.22,0,.22):model.box(x+offset*width,y+.34,z-.24,.095,height-.72,.08,'wood')
        for fraction in (.36,.64):model.box(x,y+height*fraction,z-.24,width-.66,.10,.08,'wood')


def hall(model):
    surface = landmark_surface('guangxi_arts')
    model.foundation(surface,0,-.6,0,22,1.25,37,'brick')
    model.box(0,.65,4.6,21.6,7.2,28,'brick',True)
    model.roof(0,7.85,4.6,22.65,29,3.1)
    model.box(0,.65,-13.1,15.6,10.25,9.0,'brick',True)
    for station in (-9,9):
        model.box(station,.65,-13.2,5.8,4.6,9.3,'brick',True)
        model.roof(station,5.25,-13.2,6.3,10,1.9)
        window(model,station,1.1,-17.92,3.8,2.9)
    for station in (-7.15,7.15):model.box(station,.65,-17.87,.87,10.25,.52,'white')
    for angle in (-1.18,-.40,.40,1.18):
        east,_,south=arc(angle*6.2,0,5.75)
        model.box(east,.4,south,.72,3.65,.72,'red',True)
    drum(model,6.2,4.,5.08,'white');drum(model,5.28,5.08,7.5,'brick');drum(model,5.45,7.5,7.68,'white')
    for angle in np.linspace(-1.28,1.28,9):
        east,_,south=arc(angle*6.2,0,5.32);model.pose=(east,0,south,angle)
        model.box(0,5.87,0,.88,1.02,.14,'white');model.box(0,6.01,-.1,.65,.75,.09,'glass')
    model.pose=(0,0,0,0)
    if model.detail:lettering(model)
    for side in (-1,1):
        model.beam(arc(side*4.8,4.55,6.19),arc(side*4.8,4.55,6.29),.28,'gold',20)
        model.pose=(side*10.86,0,0,side*math.pi/2)
        for station in range(-14,17,5):
            window(model,station,1.15,-.18,4.05,4.45)
            model.box(station-2.3,.6,-.19,.59,7.2,.54,'white')
            model.box(station-2.3,5.8,-.30,.53,.53,.12,'granite')
        model.pose=(0,0,0,0)
    for row in range(7):
        for col in range(10):
            z=-7+col*.85+(row%2)*.35
            start=max(-7.435,z-.435)
            end=min(1.085,z+.435)
            model.ground_offset=surface.ground
            model.box(-12.3,row*.30,(start+end)/2,.35,.30,end-start,'earth')
    model.ground_offset=None
    for index in range(64):
        start,end=math.tau*index/64,math.tau*(index+1)/64
        points=[(radius*math.cos(angle),.42,-29+radius*math.sin(angle)) for radius,angle in [(3.85,start),(3.85,end),(4.25,end),(4.25,start)]]
        points = [(x,surface.ground(x,z)+.035,z) for x,_,z in points]
        model.mesh([(0,surface.ground(0,-29)+.035,-29),*points[:2]],[[0,1,2]],'brick')
        model.mesh(points,[[0,1,2],[0,2,3]],'white' if index%2 else 'granite')


if __name__=='__main__':generate('guangxi_arts',hall,smooth=('red',),colors=dict(brick='#5e2522',red='#6c2a27',white='#e9dfcc',glass='#343434',wood='#5c4235',sign='#282323',earth='#a45443'))
