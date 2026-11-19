"""Schematic schoolyard; dimensions and colors are game design choices."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from c_kit import ATLAS, RECTS, Builder, _font, arch_wall, banyan, box, cylinder, export_landmark, solid, tube

def generate(identifier, catalog):
    school = next(item for item in json.loads(catalog.read_text()) if item['id'] == identifier)
    if identifier != 'wangcheng_teaching':
        raise ValueError('Only the mapped heritage teaching buildings use this generator')
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
    if school.get('worldGround'):
        font = _font(min(height-36, (width-48)//len(title)), bold=True)
        draw.text((left+width/2, top+height/2), title, anchor='mm', fill='#87342e', font=font)
    else:
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
            depth = school.get('blockDepth',7)
            block((east,height/2,south),(length,height,depth),'brick' if athletics and east<0 else 'white',True)
            for floor in range(floors):
                sill = floor*3.2+1.8
                for side in (-1,1):
                    block((east,sill,south+side*(depth/2+.04)),(length-1,1.45,.1),'glass')
                    block((east,sill-1,south+side*(depth/2+.14)),(length,.25,.35),'wood')
                    if builder.detail:
                        for offset in range(2,int(length)-1,3):
                            block((east-length/2+offset,sill,south+side*(depth/2+.15)),(.2,1.55,.16),'white')
            block((east,height+.15,south),(length+1,.3,depth+1),'granite')
        board_z, board_y = school['blocks'][0][1]+depth/2+.3, 2.2
        mesh.face([(-half_width,board_y-half_height,board_z*scale),(half_width,board_y-half_height,board_z*scale),
                   (half_width,board_y+half_height,board_z*scale),(-half_width,board_y+half_height,board_z*scale)],
                  (0,0,1),'schematic_plaque',uvs=[(.001,.999),(.999,.999),(.999,.001),(.001,.001)])
    output = Path(sys.argv[1]); image.save(output/'atlas.png')
    export_landmark(output/f'{identifier}.glb',image,(('lod0',near),('lod1',far)))
