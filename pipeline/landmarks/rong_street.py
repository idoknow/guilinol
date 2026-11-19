from PIL import ImageDraw

from c_kit import RECTS, _font, box, solid, stairs


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
