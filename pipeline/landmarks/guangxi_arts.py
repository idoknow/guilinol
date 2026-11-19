"""Republican-era arts hall, OSM 682942533. Local -z faces Jiefang West Rd."""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from xiaoyao_tower import generate


def lettering(model):
    image=Image.new('1',(120,20)); draw=ImageDraw.Draw(image)
    draw.text((0,-2),'廣西省立藝術館',font=ImageFont.truetype('NotoSansCJK-Regular.ttc',16),fill=1)
    for row,pixels in enumerate(np.asarray(image)):
        edges=np.flatnonzero(np.diff(np.r_[False,pixels,False]))
        for left,right in edges.reshape(-1,2):
            x0,x1=4-left*.072,4-right*.072;top=4.92-row*.06
            model.mesh([(x0,top,-24.88),(x1,top,-24.88),(x1,top-.06,-24.88),(x0,top-.06,-24.88)],[[0,1,2],[0,2,3]],'sign')


def window(model,x,y,z,width,height):
    model.box(x,y,z,width,height,.20,'white')
    model.box(x,y+.18,z-.12,width-.38,height-.36,.14,'sign')
    if model.detail:
        for offset in (-.24,0,.24):model.box(x+offset*width,y+.21,z-.21,.055,height-.42,.06,'wood')
        model.box(x,y+height*.55,z-.21,width-.39,.08,.06,'wood')


def hall(model):
    model.box(0,-.6,0,22,1.25,37,'brick',True)
    model.box(0,.65,4.6,21.6,7.2,28,'red',True)
    model.roof(0,7.85,4.6,22.65,29,3.1)
    model.box(0,.65,-13.1,15.6,10.25,9.0,'red',True)
    for station in (-9,9):
        model.box(station,.65,-13.2,5.8,4.6,9.3,'red',True)
        model.roof(station,5.25,-13.2,6.3,10,1.9)
        window(model,station,1.1,-17.92,3.8,2.9)
    for station in np.arange(-6,6.1,2):window(model,station,8.8,-17.68,1.50,1.38)
    for station in (-7.25,7.25):model.box(station,.66,-17.73,.55,10.2,.26,'white')
    for station in (-5.2,-2.1,2.1,5.2):model.box(station,.4,-18.5-math.sqrt(6.2**2-station**2),.64,3.65,.64,'red',True)
    for idx in range(12):
        angles=np.linspace(0,math.pi,13)[idx:idx+2]
        front=[(6.2*math.cos(angle),-18.5-6.2*math.sin(angle)) for angle in angles]
        verts=[(x,height,z) for height in (4.0,5.03) for x,z in [(0,-17.65),*front]]
        model.mesh(verts,[[0,1,2],[3,5,4],[1,4,5],[1,5,2]],'white')
    model.box(0,4.03,-24.06,9.8,.99,1.60,'white')
    if model.detail:lettering(model)
    for side in (-1,1):
        model.beam([side*4.53,4.55,-24.83],[side*4.53,4.55,-24.91],.28,'gold',20)
        model.pose=(side*10.86,0,0,side*math.pi/2)
        for station in range(-14,17,5):
            window(model,station,1.3,0,3.7,4.2)
            model.box(station-2.3,.6,-.06,.33,6.9,.36,'white')
            model.box(station-2.3,5.8,-.30,.53,.53,.12,'granite')
        model.pose=(0,0,0,0)
    for row in range(7):
        for col in range(10):model.box(-12.3,.24+row*.31,-7+col*.85+(row%2)*.35,.35,.30,.66,'earth')
    for ring in range(4):
        for idx in range(24):
            angles=np.linspace(0,math.tau,25)[idx:idx+2]
            points=[(radius*math.cos(angle),.40,-29+radius*math.sin(angle)) for radius,angle in [(ring+.02,angles[0]),(ring+.98,angles[0]),(ring+.98,angles[1]),(ring+.02,angles[1])]]
            model.mesh(points,[[0,1,2],[0,2,3]],'earth' if (idx+ring)%3 else 'pave')


if __name__=='__main__':generate('guangxi_arts',hall,colors=dict(red='#7a2a26',sign='#282323',earth='#a45443'))
