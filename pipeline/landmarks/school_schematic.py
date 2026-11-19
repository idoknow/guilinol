"""Schematic schoolyard; dimensions and colors are game design choices."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from c_kit import ATLAS, RECTS, Builder, _font, banyan, box, cylinder, export_landmark, solid, tube

CATALOG = Path(__file__).resolve().parents[1] / 'schools-g1.json'


def generate(identifier, catalog=CATALOG):
    school = next(item for item in json.loads(catalog.read_text()) if item['id'] == identifier)
    image = Image.new('RGB', (ATLAS, ATLAS), '#e6e5dc')
    draw = ImageDraw.Draw(image)
    colors = dict(glass='#5b737b', steel='#979c9d', brick='#af6960', foliage='#637d56',
                  bark='#796957', glaze='#66978b', granite='#92938a', vermilion='#b2504c', wood=school['band'])
    for key, color in colors.items():
        left, top, width, height = RECTS[key]
        draw.rectangle((left, top, left+width-1, top+height-1), fill=color)
    RECTS['schematic_plaque'] = (0, 768, ATLAS, 256)
    left, top, width, height = RECTS['schematic_plaque']
    title = '三教楼' if school.get('heritage') else school['name'].split('（')[0]
    font = _font(min(height-36, (width-48)//len(title)), bold=True)
    draw.text((left+width/2, top+height/2), title, anchor='mm', fill='#87342e', font=font)
    near, far = Builder(0, True), Builder(1, False)
    scale = school['scale']
    for builder in (near, far):
        mesh = builder.parts['atlas']

        def block(center, size, material, collision=False):
            pos = (center[0]*scale, center[1], center[2]*scale)
            dim = (size[0]*scale, size[1], size[2]*scale)
            box(mesh, pos, dim, material, None)
            if collision and builder.collide:
                solid(builder.hit, pos, dim, cell=4)

        for east, south, length, floors in school['blocks']:
            height = floors * 3.2
            block((east,height/2,south),(length,height,7),'white',True)
            for floor in range(floors):
                sill = floor*3.2+1.8
                for side in (-1,1):
                    block((east,sill,south+side*3.54),(length-1,1.45,.1),'glass')
                    block((east,sill-1,south+side*3.64),(length,.25,.35),'wood')
                    if builder.detail:
                        for offset in range(2,int(length)-1,3):
                            block((east-length/2+offset,sill,south+side*3.65),(.2,1.55,.16),'white')
            block((east,height+.15,south),(length+1,.3,8),'granite')
        if not school.get('heritage'):
            block((10,.08,2),(14,.16,19),'glaze')
            for side in (-1,1):
                block((10+side*6.5,.17,2),(.1,.02,18),'white')
                block((10,.17,2+side*9),(13,.02,.1),'white')
            block((10,.17,2),(13,.02,.1),'white')
            for side in (-1,1):
                block((side*5,2.35,17),(1,4.7,1),'granite',True)
                block((side*10,.7,17),(9,1.4,.45),'white',True)
            block((0,1.0,17),(9.1,1.9,.24),'steel',True)
            if builder.detail:
                for column in range(-4,4):
                    for bottom,top in ((.25,1.75),(1.75,.25)):
                        tube(mesh,(column*scale,bottom,17.18*scale),((column+1)*scale,top,17.18*scale),.045,'glass',4)
            board_z, board_y = 17.7, 4.25
            block((0,board_y,17),(11,1.35,.8),'white')
            cylinder(mesh,(-6*scale,0,7*scale),.09,7.5,'steel',6)
            block((-5,6.8,7),(2,1.2,.06),'vermilion')
        else:
            board_z, board_y = school['blocks'][0][1]+3.8, 2.2
        half_width = (2.4 if school.get('heritage') else 5)*scale
        mesh.face([(-half_width,board_y-.62,board_z*scale),(half_width,board_y-.62,board_z*scale),
                   (half_width,board_y+.62,board_z*scale),(-half_width,board_y+.62,board_z*scale)],
                  (0,0,1),'schematic_plaque',uvs=[(.001,.999),(.999,.999),(.999,.001),(.001,.001)])
        if not school.get('heritage'):
            for index in range(3):
                banyan(mesh,((-16+index*5)*scale,0,10*scale),6,2,811+index,builder.detail)
    output = Path(sys.argv[1]); image.save(output/'atlas.png')
    export_landmark(output/f'{identifier}.glb',image,(('lod0',near),('lod1',far)))
