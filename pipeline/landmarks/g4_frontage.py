from pathlib import Path
import sys

from PIL import Image, ImageDraw
from c_kit import ATLAS, RECTS, Builder, _font, box, export_landmark, tube


def generate(identifier):
    technical = identifier == 'guilin_technical'
    title = '桂林技师学院' if technical else '桂林市旅游职业中等专业学校'
    image = Image.new('RGB', (ATLAS, ATLAS), '#d5d4cf')
    paint = ImageDraw.Draw(image)
    for region, color in {'granite':'#9b9991', 'steel':'#b2b8b7', 'brick':'#733e3c', 'glass':'#6b7981'}.items():
        left, top, width, height = RECTS[region]
        paint.rectangle((left,top,left+width-1,top+height-1),fill=color)
    RECTS['name'] = (0,768,1024,192)
    paint.rectangle((0,768,1023,959),fill='#773e3c' if technical else '#c6c7c4')
    paint.text((512,864),title,font=_font(min(110,980//len(title)),True),anchor='mm',fill='#ebe0c2' if technical else '#973d37')
    builders = []
    for lod in (0,1):
        builder = Builder(lod)
        mesh = builder.parts['atlas']
        def block(center,size,region):
            box(mesh,center,size,region,None)
        for side in (-1,1):
            block((side*7.1,2.1,0),(1.0,4.2,1.1),'granite')
            block((side*10.8,.82,-.15),(6.5,1.64,.48),'brick' if technical else 'white')
        if technical:
            block((11.2,1.65,.2),(8,2.6,.92),'brick')
            center,height,half,front = 11.2,1.7,3.8,.67
        else:
            block((0,4.65,0),(16.2,1.45,1.5),'granite')
            block((0,5.42,0),(16.7,.15,1.8),'white')
            center,height,half,front = 0,4.65,7.7,.76
        mesh.face([(center-half,height-.62,front),(center+half,height-.62,front),
                   (center+half,height+.62,front),(center-half,height+.62,front)],(0,0,1),'name',
                  uvs=[(0,1),(1,1),(1,0),(0,0)])
        for level in (.3,1.38):
            block((0,level,.05),(13.4,.075,.1),'steel')
        bays = 16 if lod == 0 else 8
        for index in range(bays):
            start = -6.7+13.4*index/bays
            end = start+13.4/bays
            for low,high in ((.25,1.5),(1.5,.25)):
                tube(mesh,(start,low,.05),(end,high,.05),.045,'steel',4)
        builders.append((f'lod{lod}',builder))
    export_landmark(Path(sys.argv[1])/f'{identifier}.glb',image,builders)
