from PIL import ImageDraw

from c_kit import RECTS, _font, box, solid, stairs, ring, tube, railing, extrude
from rong_solids import banyan, align_front


def signs(image):
    draw = ImageDraw.Draw(image)
    draw.rectangle((384,640,511,767),fill='#81493c')
    RECTS['rong'] = (832,640,192,96)
    draw.rectangle((832,640,1023,735),fill='#322a28')
    draw.text((928,688),'RONG HOTEL',font=_font(23),anchor='mm',fill='white')
    # Reserve a full plaque panel for the two lines on the projecting sign.
    RECTS['inn_board'] = (512,768,320,128)
    draw.rectangle((512,768,831,895),fill='#161f24')
    draw.rectangle((516,772,827,891),outline='#e9ebdf',width=2)
    for row,label in enumerate(('涵栅雅居','民宿酒店')):
        draw.text((672,800+row*57),label,anchor='mm',font=_font(50),fill='#fffaf0')


def shops(builder):
    # IMG_1302, east sidewalk of Rongyin Road (way/221349761). Only model
    # the visible street frontage where the snapshot has no building outline.
    with align_front(builder, (63,-116), -111.9):
        mesh, glass = builder.parts['atlas'], builder.parts['lit']
        box(mesh, (63,10.1,-117.8), (14.4,14.2,3.6), 'cream')
        box(mesh, (63,5.9,-115.85), (12.4,.85,.36), 'wood')
        for east in (58,61.3,64.7,68):
            box(glass,(east,4.5,-115.9),(2.8,2.6,.24),'glass')
        for level in (7.4,10.6,13.8,16):
            for east in (57.6,68.4):
                box(glass,(east,level,-115.87),(2.9,1.85,.25),'glass')
        if builder.collide:
            solid(builder.hit,(63,10.1,-117.8),(14.4,14.2,3.6),'cream')
    # The small street-facing volume on way/521248452 stands in front of the hotel.
    with align_front(builder, (-4.5, -43.6), -20):
        mesh = builder.parts['atlas']
        box(mesh, (-4.5, 6.1, -43.6), (7.25, 9.6, 6.65), 'brick')
        for level in (2.7, 6.1, 9.15):
            for east in (-6.25, -2.75):
                box(builder.parts['lit'], (east, level, -40.2), (2.65, 1.82, .14), 'glass')
        if builder.collide:
            solid(builder.hit, (-4.5, 6.1, -43.6), (7.25, 9.6, 6.65), 'brick')
    for east,base,south,width,length,floors,kind in [(10,1.7,-51,17,24,4,'rong'),(10,1.08,-86,26.3,8.5,3,'inn'),(32,3.8,-115,15,19,3,'hall')]:
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
        if kind == 'rong':
            # The south return of way/521248450 faces the approach in IMG_1307.
            for floor in range(floors):
                for dx in (1.8, 5, 8):
                    box(glass, (east+dx, base+1.7+floor*3.25, south+13.7),
                        (2.45, 1.7, .16), 'glass')
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
        if kind == 'inn':
            # The sidewalk descends south with Rongyin Road. The east doorway
            # opens at this grade, about 3 m below the old constant shop datum.
            def grade(z):
                return 1.38 - .041*(z-south)
            for col in range(5):
                a = face + col*1.8
                for row in range(8):
                    c = south-5.6 + row*2
                    corners = [(a,c),(a+1.8,c),(a+1.8,c+2),(a,c+2)]
                    vertices = [(x,grade(z),z) for x,z in corners]
                    stone.face(vertices,(0,1,0),'plaza_stone')
                    if builder.collide:
                        builder.hit.face(vertices,(0,1,0),'ashlar')
            for stall in range(5 if builder.detail else 3):
                z = south-length*.4+1.28*stall
                scooter(stone,face+1.25,grade(z),z,('steel','cream','vermilion')[stall%3])
            corner = south+length/2
            start,end = face+.28,face+2.08
            for level in (base+2.31,base+3.10):
                box(stone,(face+.42,level,corner),(.84,.075,.09),'steel')
            box(stone,((start+end)/2,base+2.69,corner),(end-start,.90,.14),'steel')
            for side in (-1,1):
                z = corner + side*.084
                left,right = (start,end) if side==1 else (end,start)
                stone.face([(left,base+2.26,z),(right,base+2.26,z),
                            (right,base+3.12,z),(left,base+3.12,z)],
                           (0,0,side),'inn_board',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])
            return
        offset,level = south,base+3.2
        stone.face([(face+.3,level-.575,offset+4.5),(face+.3,level-.575,offset-4.5),
                    (face+.3,level+.575,offset-4.5),(face+.3,level+.575,offset+4.5)],
                   (1,0,0),'rong',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])


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
    path=[(18,1,-30),(23,1.9,-45),(31,2.9,-60),(37,3.9,-76),(44,4.5,-93),(51,4,-110),(57,3.4,-126)]
    for index,(east,base,south) in enumerate(path):
        box(mesh,(east+5,base,south),(2.3,.24,2.3),'granite')
        banyan(mesh,(east+5,base+.12,south),9+index%3,4.9,77+index,builder.detail,lobed=False)
        for offset in range(7 if builder.detail else 3):
            scooter(mesh,east+5,base,south+2+offset*.77,('steel','vermilion','cream')[offset%3])
    for index in range(5):
        for sign in (-1,1):
            tube(mesh,(16+index,1.1,-31),(16+index+sign*3.4,1.32,-34.4),.085,'yellow',4)
    railing(mesh,(12,-23),(9,-16),.25,.95,'white',1.6,stone=True)
