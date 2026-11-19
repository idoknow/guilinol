from PIL import Image, ImageDraw

from c_kit import RECTS, _font, box, solid, stairs, ring, tube, railing, extrude
from rong_solids import banyan, align_front


def signs(image):
    draw = ImageDraw.Draw(image)
    draw.rectangle((384,640,511,767),fill='#81493c')
    for name,rect,text,size in [('inn',(768,640,64,128),'涵栅雅居',23),('rong',(832,640,192,96),'RONG HOTEL',23)]:
        RECTS[name]=rect
        left,top,width,height=rect
        draw.rectangle((left,top,left+width-1,top+height-1),fill='#322a28')
        if name=='inn':
            for index,char in enumerate(text):
                draw.text((left+width/2,top+(index+.5)*height/4),char,anchor='mm',font=_font(size),fill='white')
        else:
            draw.text((left+width/2,top+height/2),text,font=_font(size),anchor='mm',fill='white')
    sign=Image.new('RGB',(128,512),'#171819')
    brush=ImageDraw.Draw(sign)
    for index,char in enumerate('涵栅雅居'):
        brush.text((64,64+128*index),char,font=_font(107),anchor='mm',fill='#fffaf0')
    RECTS['inn']=RECTS['sign_school']
    image.paste(sign.transpose(Image.Transpose.ROTATE_90),(512,768))


from c_kit import landmark_surface


def shops(builder):
    for east,south,width,length,floors,kind in [(10,-51,17,24,4,'rong'),(10,-86,26.3,8.5,3,'inn'),(32,-115,15,19,3,'hall')]:
        base = landmark_surface('gunanmen').ground(east,south)
        with align_front(builder, (east, south), -21.92):
            shop(builder, east, base, south, width, length, floors, kind)


def shop(builder, east, base, south, width, length, floors, kind):
        stone,glass=builder.parts['atlas'],builder.parts['lit']
        height=floors*3.25
        center=(east,base+height/2,south)
        size=(width,height,length)
        if kind=='rong':
            ring_xz=[(-.1,3.2),(-13.3,3.8),(-13.7,-7.1),(-4.1,-7.5),(-4.2,-10.4),(8.5,-11),(9.4,13.4),(.3,13.8)]
            outline=[(east+dx,south+dz) for dx,dz in ring_xz]
            extrude(stone,outline,base,base+height,'brick')
            if builder.collide:extrude(builder.hit,outline,base,base+height,'brick')
        else:
            box(stone,center,size,'rubble' if kind=='hall' else 'brick')
            if builder.collide:solid(builder.hit,center,size,'brick')
        face=east+width/2
        if kind=='hall':
            box(glass,(face+.15,base+5,south),(.3,9.8,6.2),'glass',None)
            for offset in (-3,-1,1,3):
                box(stone,(face+.33,base+5,south+offset),(.14,10,.11),'steel')
            for offset in (-3.5,3.5):
                box(stone,(face+1.2,base+2,south+offset),(2.5,3.8,.31),'vermilion')
            box(stone,(face+1.2,base+4,south),(2.6,.38,7.5),'vermilion')
            stairs(stone,(face+5,base,south),(face+.5,base+1.15,south),8.8,7,'granite')
            return
        for row in range(floors):
            for side in (-1,1):
                for bay in (-.28,0,.28):
                    box(glass,(east+bay*width,base+1.66+row*3.25,south+side*(length/2+.06)),(width*.21,1.53,.12),'glass',None)
                box(stone,(east,base+(row+1)*3.25,south+side*length/2),(width+.24,.16,.42),'brick')
            for bay in (-.32,0,.32):
                box(glass,(east-width/2-.06,base+1.66+row*3.25,south+bay*length),(.12,1.53,length*.23),'glass',None)
            for col in (-1,1):
                level=base+1.66+row*3.25
                offset=south+col*length*.245
                box(stone,(face+.08,level,offset),(.18,1.8,length*.44),'wood')
                box(glass,(face+.2,level,offset),(.09,1.53,length*.42),'glass',None)
        span,high=(9,1.15) if kind=='rong' else (1.55,5.8)
        offset=south+length*.36 if kind=='inn' else south
        level=base+3.2
        coords=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)]
        if kind=='inn': coords=[(v,1-u) for u,v in coords]
        stone.face([(face+.3,level-high/2,offset+span/2),(face+.3,level-high/2,offset-span/2),(face+.3,level+high/2,offset-span/2),(face+.3,level+high/2,offset+span/2)],(1,0,0),kind,uvs=coords)


def scooter(mesh,east,base,south,color):
    for offset in (-.56,.56):
        for depth in (-.06,.06):
            ring(mesh,(east+offset,base+.24,south+depth),.24,.14,'blacktile',sides=8)
    box(mesh,(east,base+.40,south),(.98,.18,.34),color)
    box(mesh,(east-.26,base+.71,south),(.51,.17,.34),'blacktile')
    tube(mesh,(east+.53,base+.24,south),(east+.43,base+1.06,south),.06,'steel',5)
    tube(mesh,(east+.43,base+1.06,south-.24),(east+.43,base+1.06,south+.24),.045,'blacktile',4)


def approach(builder):
    mesh=builder.parts['atlas']
    ground = landmark_surface('gunanmen').ground
    path=[(18,-30),(23,-45),(31,-60),(37,-76),(44,-93),(51,-110),(57,-126)]
    for index,(east,south) in enumerate(path):
        base = ground(east+5,south)+.12
        box(mesh,(east+5,base,south),(2.3,.24,2.3),'granite')
        banyan(mesh,(east+5,base+.12,south),9+index%3,4.9,77+index,builder.detail)
        for offset in range(7 if builder.detail else 3):
            scooter(mesh,east+5,ground(east+5,south+2+offset*.77),south+2+offset*.77,('steel','vermilion','cream')[offset%3])
    for index in range(6):
        box(mesh,(15+index*.95,ground(15+index*.95,-24)+.035,-24),(.5,.07,4.3),'white')
    for index in range(5):
        for sign in (-1,1):
            tube(mesh,(16+index,1.1,-31),(16+index+sign*3.4,1.32,-34.4),.085,'yellow',4)
    railing(mesh,(12,-23),(9,-16),.25,.95,'white',1.6,stone=True)
