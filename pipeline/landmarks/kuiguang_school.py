"""奎光学校：临街建筑外观与原创校园，不生成门洞内景。"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from c_kit import (ATLAS, RECTS, Builder, _font, banyan, box, cylinder,
                   export_landmark, solid, tri_count)


def atlas():
    image = Image.new('RGB', (ATLAS, ATLAS), '#ededdf')
    brush = ImageDraw.Draw(image)
    colors = {'steel':'#959c9c', 'glass':'#536870', 'cream':'#e0c7c1',
              'graytile':'#57575a', 'ashlar':'#bebbb6',
              'vermilion':'#b74438', 'brick':'#a05e48', 'foliage':'#63835a',
              'bark':'#756554', 'glaze':'#52998a', 'wood':'#3e76a0',
              'granite':'#848780', 'yellow':'#d8b65a', 'lattice':'#474d50'}
    for key, color in colors.items():
        left, top, width, height = RECTS[key]
        brush.rectangle((left, top, left+width-1, top+height-1), fill=color)
    left, top, width, height = RECTS['sign_school']
    brush.text((left+width/2,top+height/2), '桂林市奎光学校', font=_font(64, bold=True), anchor='mm', fill='#ab3733')
    return image


def build(builder):
    mesh = builder.parts['atlas']

    def block(center, size, color, collides=False):
        box(mesh, center, size, color, None)
        if collides and builder.collide:
            solid(builder.hit, center, size, cell=4)

    block((0, 10.2, 17), (30, 10.4, 9), 'cream', True)
    block((0, 2.5, 16.4), (30, 5, 7.8), 'granite', True)
    for floor in range(3):
        height = 6.1 + floor*3.25
        for column in range(-12,13,4):
            block((column, height, 21.55), (1.5, 1.45, 0.15), 'glass')
            if builder.detail:
                for offset in (-.5,0,.5):
                    block((column+offset, height, 21.67), (.05, 1.45, .08), 'steel')
                block((column, height, 21.67), (1.5,.06,.08), 'steel')
                if column % 8 == 0:
                    block((column+1.25,height-.48,21.75),(.78,.52,.45),'ashlar')
        block((0, height-1.04, 21.62), (30.2, 0.24, 0.6), 'white')
    for side in (-1, 1):
        block((side*9.6,2.5,20.91),(10.8,5,1.28),'granite',True)
        block((side*4.54,1.9,21.61),(.43,2.65,.09),'cream')
        block((side*9.2, 1.75, 21.6), (9.6, 3.5, 0.16), 'wood')
        if builder.detail:
            for row in range(1,14):
                block((side*9.2,row/4,21.72),(9.6,0.045,0.05),'steel')
    block((0, 2.0, 20.4), (8.3, 4, 0.2), 'lattice')
    for column in range(-8,9):
        block((column*0.48,1.65,20.54),(0.07,3.3,0.09),'steel')
    block((0,4.35,21.62),(9.6,1.5,1.65),'ashlar')
    mesh.face([(-4.7,3.65,22.46),(4.7,3.65,22.46),(4.7,5.05,22.46),(-4.7,5.05,22.46)],
              (0,0,1),'sign_school',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])
    for side in (-1,1):
        cylinder(mesh,(side*3.55,2.62,22.03),0.34,0.61,'vermilion',10)
        cylinder(mesh,(side*3.55,2.49,22.03),0.06,0.14,'yellow',6)
    block((0,.07,22.65),(30,.14,2.2),'ashlar')
    block((0,.035,26.15),(30,.07,4.8),'graytile')
    for side in (-1,1):
        for stripe in range(8):
            block((side*(7.9+.24*stripe),.13,23.3),(.24,.12,.42),
                  'yellow' if stripe%2 else 'lattice')
    for offset in range(-6,7,2):
        for sign in (-1,1):
            start, end = offset-sign*1.7, offset+sign*1.7
            mesh.face([(start-.06,.08,23.85),(start+.06,.08,23.85),(end+.06,.08,28.35),(end-.06,.08,28.35)],(0,1,0),'yellow',None)

    block((-16,1.05,4),(14,2.1,.6),'brick',True)
    block((-16,.68,5),(14,1.36,1.4),'foliage')
    for index, east in enumerate((-24,-11,3)):
        banyan(mesh,(east,0,7),6.2,3.5,403+index,builder.detail)


if __name__ == '__main__':
    output = Path(sys.argv[1]); image = atlas()
    image.save(output/'atlas.png')
    near, far = Builder(0,True), Builder(1,False)
    for lod in (near,far):
        build(lod)
    export_landmark(output/'kuiguang_school.glb',image,(('lod0',near),('lod1',far)))
    print(f'kuiguang_school: {tri_count(near)} / {tri_count(far)} triangles')
