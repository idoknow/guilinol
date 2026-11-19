from PIL import ImageDraw

from c_kit import RECTS, _font, box, solid, stairs, ring, tube, banyan, railing


def signs(image):
    draw = ImageDraw.Draw(image)
    for name,rect,text,size in [('inn',(768,640,64,128),'涵栅雅居',23),('rong',(832,640,192,96),'RONG HOTEL',23)]:
        RECTS[name]=rect
        left,top,width,height=rect
        draw.rectangle((left,top,left+width-1,top+height-1),fill='#322a28')
        if name=='inn':
            for index,char in enumerate(text):
                draw.text((left+width/2,top+(index+.5)*height/4),char,anchor='mm',font=_font(size),fill='white')
        else:
            draw.text((left+width/2,top+height/2),text,font=_font(size),anchor='mm',fill='white')


def shops(builder):
    stone,glass=builder.parts['atlas'],builder.parts['lit']
    for east,base,south,width,length,floors,kind in [(10,2.07,-51,14,20,4,'rong'),(10,4.62,-86,11,16,3,'inn'),(32,8.49,-115,15,19,3,'hall')]:
        height=floors*3.25
        center=(east,base+height/2,south)
        size=(width,height,length)
        box(stone,center,size,'rubble' if kind=='hall' else 'brick')
        if builder.collide:
            solid(builder.hit,center,size,'brick')
        face=east+width/2
        for row in range(floors):
            for col in (-1,0,1):
                level=base+1.66+row*3.25
                offset=south+col*length*.3
                box(stone,(face+.08,level,offset),(.18,2.68,length*.25),'vermilion' if kind=='hall' else 'wood')
                box(glass,(face+.2,level,offset),(.09,2.41,length*.23),'glass')
        if kind=='hall':
            stairs(stone,(face+3,base,south),(face,base+.8,south),6,5,'granite')
            continue
        span,high=(8,.95) if kind=='rong' else (1,5.2)
        offset=south+length*.36 if kind=='inn' else south
        level=base+3.2
        stone.face([(face+.3,level-high/2,offset+span/2),(face+.3,level-high/2,offset-span/2),(face+.3,level+high/2,offset-span/2),(face+.3,level+high/2,offset+span/2)],(1,0,0),kind,uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])


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
    path=[(18,.8,-30),(23,1.6,-45),(31,2.5,-60),(37,3.8,-76),(44,5.6,-93),(51,6.9,-110),(57,7.9,-126)]
    for index,(east,base,south) in enumerate(path):
        box(mesh,(east-6,base,south),(2.3,.24,2.3),'granite')
        banyan(mesh,(east-6,base+.12,south),10+index%3,7.6,77+index,builder.detail)
        for offset in range(3 if builder.detail else 1):
            scooter(mesh,east-5.6,base,south+3+offset*.76,('steel','vermilion','cream')[offset])
    for index in range(6):
        box(mesh,(17+index*.9,.37,-24),(.49,.035,4.3),'white')
    for index in range(5):
        for sign in (-1,1):
            tube(mesh,(20+index,.89,-31),(20+index+sign*3.4,.89,-34.4),.05,'yellow',4)
    railing(mesh,(12,-23),(9,-16),.25,.95,'white',1.6,stone=True)
