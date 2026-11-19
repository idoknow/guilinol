"""Schematic schoolyard; dimensions and colors are game design choices."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from c_kit import ATLAS, RECTS, Builder, _font, arch_wall, banyan, box, cylinder, export_landmark, solid, tube

def generate(identifier, catalog):
    school = next(item for item in json.loads(catalog.read_text()) if item['id'] == identifier)
    image = Image.new('RGB', (ATLAS, ATLAS), '#e6e5dc')
    draw = ImageDraw.Draw(image)
    athletics = school.get('sports') == 'athletics'
    colors = dict(glass='#5b737b', steel='#979c9d', brick='#af6960', foliage='#637d56',
                  bark='#796957', glaze='#66978b', granite='#92938a', vermilion='#b2504c', wood=school['band'])
    for key, color in colors.items():
        left, top, width, height = RECTS[key]
        draw.rectangle((left, top, left+width-1, top+height-1), fill=color)
    if athletics:
        RECTS['athletics'] = (0, 0, 768, 256)
        draw.rectangle((0,0,767,255), fill='#bcc0b5')
        draw.rounded_rectangle((102,7,665,248), radius=119, fill='#ac5549')
        for inset in (5,11,17):
            draw.rounded_rectangle((102+inset,7+inset,665-inset,248-inset),radius=119-inset,outline='#dfb3a0',width=2)
        draw.rounded_rectangle((127,32,640,223),radius=94,fill='#62875a')
        for stripe in range(10):
            draw.rectangle((205+stripe*36,42,240+stripe*36,213),fill=('#739963','#66885c')[stripe%2])
        draw.rectangle((205,42,564,213),outline='white',width=2)
        draw.line((384,42,384,213),fill='white',width=2)
        draw.ellipse((361,105,407,151),outline='white',width=2)
        for left in (4,668):
            draw.rectangle((left,43,left+94,212),fill='#517fa2')
            draw.rectangle((left+5,49,left+89,206),outline='#efeadc',width=2)
            draw.line((left+5,128,left+89,128), fill='#efeadc',width=2)
            draw.ellipse((left+32,112,left+62,142),outline='#efeadc',width=2)
    RECTS['schematic_plaque'] = (0, 768, ATLAS, 256)
    left, top, width, height = RECTS['schematic_plaque']
    title = '三教楼' if school.get('heritage') else school['name'].split('（')[0]
    scale = school['scale']
    half_width = (2.4 if school.get('heritage') else 6.8 if athletics else 5)*scale
    half_height = 1.1 if athletics else .62
    plaque = Image.new('RGB',(round(height*half_width/half_height),height),'#e6e5dc')
    font = _font(min(height-36, (plaque.width-48)//len(title)), bold=True)
    ImageDraw.Draw(plaque).text((plaque.width/2,height/2), title, anchor='mm', fill='#68241e', font=font)
    image.paste(plaque.resize((width,height), Image.Resampling.LANCZOS), (left,top))
    near, far = Builder(0, True), Builder(1, False)
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
            block((east,height/2,south),(length,height,7),'brick' if athletics and east<0 else 'white',True)
            for floor in range(floors):
                sill = floor*3.2+1.8
                for side in (-1,1):
                    block((east,sill,south+side*3.54),(length-1,1.45,.1),'glass')
                    block((east,sill-1,south+side*3.64),(length,.25,.35),'wood')
                    if builder.detail:
                        for offset in range(2,int(length)-1,3):
                            block((east-length/2+offset,sill,south+side*3.65),(.2,1.55,.16),'white')
            block((east,height+.15,south),(length+1,.3,8),'granite')
            if school.get('arcade') and (east,south) == tuple(school['blocks'][0][:2]):
                bays = 8
                pitch = length * scale / bays
                for floor in range(floors):
                    level = floor * 3.2
                    block((east,level+.1,south+4.5),(length,.2,2.2),'white')
                    for bay in range(bays):
                        position = ((east-length/2)*scale+(bay+.5)*pitch,level,(south+5.45)*scale)
                        arch_wall(mesh,position,pitch,3.2,.32,min(4.8,pitch*.83),3,'wood',6 if builder.detail else 3,None)
        if not school.get('heritage'):
            if school.get('paved'):
                rear = min(row[1] for row in school['blocks']) - 4.5
                depth = 17 - rear
                middle = (rear+17)/2
                block((0,.015,middle),(38,.03,depth),'granite')
                block((0,.045,14),(36,.03,3),'foliage')
                for side in (-1,1):
                    block((side*19,.6,middle),(.36,1.2,depth),'white',True)
                    block((side*19,1.28,middle),(.42,.16,depth),'steel')
                    start = 18 if school.get('notice_wall') else 14.5
                    block((side*(start+19)/2,.7,17),(19-start,1.4,.45),'white',True)
                block((0,.6,rear),(38,1.2,.36),'white',True)
                block((0,1.28,rear),(38,.16,.42),'steel')
            if athletics:
                mesh.face([(east*scale,.085,south*scale) for east,south in [(-18,-4),(18,-4),(18,12),(-18,12)]],(0,1,0),'athletics',uvs=[(.001,.001),(.999,.001),(.999,.999),(.001,.999)])
            else:
                block((10,.08,2),(14,.16,19),'glaze')
                for side in (-1,1):
                    block((10+side*6.5,.17,2),(.1,.02,18),'white')
                    block((10,.17,2+side*9),(13,.02,.1),'white')
                block((10,.17,2),(13,.02,.1),'white')
            for side in (-1,1):
                block((side*5,2.35,17),(1,4.7,1),'granite',True)
                if school.get('notice_wall'):
                    block((side*12,1,17),(13,2,.48),'cream',True)
                    for pier in (6,10,14,18):
                        block((side*pier,1.25,17),(.72,2.5,.78),'brick')
                        block((side*pier,2.54,17),(.85,.12,.87),'granite')
                    for panel in (8,12,16):
                        block((side*panel,1.15,17.27),(2.9,1.4,.12),'steel')
                        block((side*panel,1.15,17.36),(2.65,1.16,.08),'glass')
                        for sheet in (-.7,0,.7):
                            block((side*panel+sheet,1.15,17.42),(.5,.76,.04),'white')
                else:
                    block((side*10,.7,17),(9,1.4,.45),'white',True)
            block((0,1.0,17),(9.1,1.9,.24),'steel',True)
            if builder.detail:
                for column in range(-4,4):
                    for bottom,top in ((.25,1.75),(1.75,.25)):
                        tube(mesh,(column*scale,bottom,17.18*scale),((column+1)*scale,top,17.18*scale),.045,'glass',4)
            board_z, board_y = 17.7, 4.25
            block((0,board_y,17),(14 if athletics else 11,2.3 if athletics else 1.35,.8),'white')
            cylinder(mesh,(-6*scale,0,7*scale),.09,7.5,'steel',6)
            block((-5,6.8,7),(2,1.2,.06),'vermilion')
        else:
            board_z, board_y = school['blocks'][0][1]+3.8, 2.2
        mesh.face([(-half_width,board_y-half_height,board_z*scale),(half_width,board_y-half_height,board_z*scale),
                   (half_width,board_y+half_height,board_z*scale),(-half_width,board_y+half_height,board_z*scale)],
                  (0,0,1),'schematic_plaque',uvs=[(.001,.999),(.999,.999),(.999,.001),(.001,.001)])
        if not school.get('heritage'):
            for index in range(3):
                banyan(mesh,((-16+index*5)*scale,0,10*scale),6,2,811+index,builder.detail)
    output = Path(sys.argv[1]); image.save(output/'atlas.png')
    export_landmark(output/f'{identifier}.glb',image,(('lod0',near),('lod1',far)))
