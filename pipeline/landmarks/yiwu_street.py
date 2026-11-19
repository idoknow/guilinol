"""Yiwu Road street furniture: local x follows the street north from Ronghu."""
import math

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

from c_kit import landmark_surface
from xiaoyao_tower import generate


def canopy(model, station, side):
    lateral = side * 6.4
    model.beam([station, -.08, lateral], [station, 5.6, lateral], .32, 'wood', 8, True)
    sphere = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for reach in (-2.3, 1.8):
        tip = [station + reach, 6.2, lateral - side * 2.4]
        model.beam([station, 3.4, lateral], tip, .22, 'wood')
        model.mesh(sphere.vertices * [4.4, 2.7, 4.3] + tip, sphere.faces, 'leaf')


def palm(model, station):
    model.beam([station, 0, -11], [station+.3, 7.2, -11], .24, 'wood', 8)
    for angle in np.linspace(0, 2*math.pi, 11, endpoint=False):
        radial = np.array([math.cos(angle),0,math.sin(angle)])
        cross = np.array([-radial[2],0,radial[0]])
        base = np.array([station+.3,7.2,-11])
        crest = base + 1.9*radial + [0,1.25,0]
        model.mesh([base,crest+cross*.65,crest,crest-cross*.65,base+3.1*radial],
                   [[0,1,2],[0,2,3],[1,4,2],[2,4,3]], 'green')


def scooter(model, station, paint):
    for position in (-7.25,-6.25):
        model.beam([station-.09,.34,position],[station+.09,.34,position],.23,'tile',10)
    model.box(station,.39,-6.74,.38,.25,1.18,paint)
    model.box(station,.64,-7,.4,.19,.62,'sign')
    model.box(station,.56,-6.22,.36,.48,.16,paint)
    model.box(station,.99,-6.2,.68,.055,.08,'tile')


def directions(model):
    station = 89
    model.box(station,0,5.5,.14,3.65,.14,'granite',True)
    font=ImageFont.truetype('NotoSansCJK-Regular.ttc',22)
    for index,text in enumerate(('↑ 解放西路','← 丽君路','三多路 →')):
        bottom=3.12-index*.57
        model.box(station-.09,bottom,5.5,.12,.51,2.54,'glass')
        if not model.detail:continue
        image=Image.new('1',(126,26));draw=ImageDraw.Draw(image)
        draw.text((63,12),text,font=font,anchor='mm',fill=1)
        for row,pixels in enumerate(np.asarray(image)):
            for left,right in np.flatnonzero(np.diff(np.r_[False,pixels,False])).reshape(-1,2):
                z0,z1=5.5+(left-63)*.019,5.5+(right-63)*.019
                top=bottom+.50-row*.019
                model.mesh([(station-.17,top,z0),(station-.17,top,z1),(station-.17,top-.019,z1),(station-.17,top-.019,z0)],[[0,1,2],[0,2,3]],'white')


def street(model):
    for station in range(-65,86,5):
        model.box(station,-.06,-7.3,5,.22,4.4,'tile',True)
        model.box(station,.16,-8.1,5,.018,.32,'yellow')
        model.box(station,.16,-6.0,5,.012,.10,'white')
        for left,right in ((station-2.5,min(station+2.5,52.5)),(max(station-2.5,79),station+2.5)):
            if right>left:model.box((left+right)/2,-.25,-9.45,right-left,.93,.5,'brick',True)
        if not 52.5<station<79:
            model.box(station,.68,-9.45,.48,1.55,.48,'granite',True)
            model.box(station,2.20,-9.45,.69,.14,.69,'tile')
            model.roof(station,2.34,-9.45,.75,.75,.24)
        for height in (.82,1.88):
            for left,right in ((station,min(station+5,52.5)),(max(station,79),station+5)):
                if right>left:model.box((left+right)/2,height,-9.45,right-left,.08,.08,'tile')
        if model.detail:
            for offset in np.arange(.4,4.8,.38):
                if 52.5<station+offset<79:continue
                model.box(station+offset,.71,-9.45,.055,1.32,.055,'tile')
    model.box(65.75,-.2,-10.96,26.5,.36,2.92,'pave',True)
    for station in range(-60,85,12):
        for side in (-1,1):
            canopy(model,station+(10 if station==84 and side>0 else 3 if side>0 else 0),side)
    for station in (-51,-29,4,32,65):
        palm(model,station)
        if station==65:continue
        for index,paint in enumerate(['white','earth','glass','tile'] if model.detail else ['white']):
            scooter(model,station+index*.96,paint)
    directions(model)


if __name__ == '__main__':
    generate('yiwu_street',street,colors=dict(granite='#626971',glass='#185693'),
             terrain_offset=landmark_surface('yiwu_street').ground)
