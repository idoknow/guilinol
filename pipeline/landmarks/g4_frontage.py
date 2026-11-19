import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from c_kit import ATLAS, RECTS, Builder, _font, box, cylinder, export_landmark, solid, tube


def atlas(technical):
    image = Image.new('RGB', (ATLAS, ATLAS), '#f2f1ec')
    paint = ImageDraw.Draw(image)
    colors = dict(white='#f5f4ed', mint='#a9d8d8', blue='#497ba1', glass='#698fa5',
                  granite='#99978d', steel='#bac0bf', red='#923e38', gold='#ead394',
                  black='#282b2d', lantern='#c43c32')
    for index,(name,color) in enumerate(colors.items()):
        left = 16*index
        RECTS[name] = (left,0,16,16)
        paint.rectangle((left,0,left+15,15),fill=color)
    title = '桂林技师学院' if technical else '桂林市旅游职业中等专业学校'
    RECTS['vertical'] = (0,32,128,960)
    paint.rectangle((0,32,127,991),fill=colors['black' if technical else 'white'])
    start = 200 if technical else 50
    pitch = (970-start)/len(title)
    if technical:
        paint.ellipse((19,53,109,143),outline=colors['gold'],width=5)
        paint.polygon([(31,117),(58,78),(68,93),(79,74),(98,117)],fill=colors['gold'])
    for index,glyph in enumerate(title):
        paint.text((64,start+(index+.5)*pitch),glyph,anchor='mm',font=_font(min(96,int(pitch)-2),True),fill=colors['gold' if technical else 'black'])
    for name,top,bg,fg in [('stoneSign',32,'red','gold'),('brass',174,'gold','black'),('roof',316,'white','lantern')]:
        RECTS[name]=(160,top,848,128)
        paint.rectangle((160,top,1007,top+127),fill=colors[bg])
        paint.text((584,top+64),title,font=_font(min(100,805//len(title)),True),anchor='mm',fill=colors[fg])
    return image


UV = [(.002,.998),(.998,.998),(.998,.002),(.002,.002)]


def street_skin(mesh,technical):
    start,end = ((-11.36,-29.47),(9.97,-28.62)) if technical else ((-43.48,-79.43),(-24.1,-83.3))
    def panel(left,right,low,high,offset,region):
        def point(fraction,height):
            return (start[0]+fraction*(end[0]-start[0]),height,start[1]+fraction*(end[1]-start[1])+offset)
        mesh.face([point(left,low),point(right,low),point(right,high),point(left,high)],(0,0,1),region,uvs=UV)
    panel(0,1,.04,21.7,.25,'white')
    for floor in range(7):
        bottom = floor*3.1+.85
        for bay in range(10):
            left,right = (bay+.12)/10,(bay+.88)/10
            panel(left,right,bottom,bottom+1.75,.31,'blue' if technical else 'mint')
            panel(left+.006,right-.006,bottom+.11,bottom+1.62,.34,'glass')
    if technical:
        panel(.39,.61,.2,21.3,.4,'glass')
        for fraction in (.38,.45,.52,.59):
            panel(fraction,fraction+.008,.2,21.3,.42,'blue')
        panel(.23,.77,21.55,23.1,.45,'roof')


def generate(identifier):
    technical = identifier=='guilin_technical'
    image = atlas(technical)
    builders = []
    for lod in (0,1):
        builder = Builder(lod,collide=lod==0)
        mesh = builder.parts['atlas']
        def block(center,size,region,hit=False):
            box(mesh,center,size,region,None)
            if hit and builder.collide:
                solid(builder.hit,center,size,cell=2)
        def plaque(left,right,bottom,top,depth,region):
            mesh.face([(left,bottom,depth),(right,bottom,depth),(right,top,depth),(left,top,depth)],(0,0,1),region,uvs=UV)
        if technical:
            block((-11.4,1.26,0),(8.8,2.52,.9),'granite',True)
            plaque(-14.9,-8.3,.85,1.93,.465,'brass')
            block((7.5,2.85,.12),(1.35,5.7,1.05),'black',True)
            plaque(6.86,8.14,.45,5.42,.66,'vertical')
            steps=32 if lod==0 else 12
            def arc(fraction):
                return (8.18+11.6*fraction,.3-2.9*fraction**2,3.45-1.05*fraction)
            for index in range(steps):
                first,second=index/steps,(index+1)/steps
                left,front,top=arc(first);right,back,high=arc(second)
                mesh.face([(left,0,front),(right,0,back),(right,high,back),(left,top,front)],(0,0,1),'stoneSign',uvs=[(.002+.996*first,.998),(.002+.996*second,.998),(.002+.996*second,.002),(.002+.996*first,.002)])
                mesh.face([(left,top,front),(right,high,back),(right,high,back-.65),(left,top,front-.65)],(0,1,0),'red')
                mesh.face([(left,0,front-.65),(right,0,back-.65),(right,high,back-.65),(left,top,front-.65)],(0,0,-1),'red')
                if builder.collide:
                    solid(builder.hit,((left+right)/2,(top+high)/4,(front+back)/2-.33),(right-left,(top+high)/2,.66),cell=2)
        else:
            for side in (-1,1):
                block((side*11.2,1.72,-.25),(8.2,3.44,.65),'mint',True)
                block((side*11.2,3.51,-.22),(8.45,.18,.88),'white')
                block((side*7.1,2.3,0),(1,4.6,1),'white',True)
            block((-.9,4.9,.9),(19.4,.6,4.4),'white')
            outline=[(-9.3,0),(-7.55,0),(-7.55,7.3),(-8.12,10.45),(-9.3,11.15)]
            for depth,normal in ((.7,1),(-.6,-1)):
                mesh.face([(east,up,depth) for east,up in outline],(0,0,normal),'white')
            for first,second in zip(outline,outline[1:]+outline[:1]):
                mesh.face([(*first,-.6),(*second,-.6),(*second,.7),(*first,.7)],(second[1]-first[1],first[0]-second[0],0),'white')
            if builder.collide:
                solid(builder.hit,(-8.42,3.5,.05),(1.72,7,1.3))
            plaque(-8.84,-8.04,.5,5.7,.72,'vertical')
            block((10.9,3.78,.16),(6.5,.62,.19),'black')
            block((10.9,3.79,.265),(6.1,.27,.04),'lantern')
            for east in (-4,0,4):
                cylinder(mesh,(east,4.03,1.6),.035,.57,'gold',8)
                for band in range(8):
                    radius=.3*math.sin(math.pi*(band+.5)/8)**.58
                    cylinder(mesh,(east,3.48+band*.071,1.6),radius,.074,'lantern',16 if lod==0 else 8)
                cylinder(mesh,(east,3.31,1.6),.05,.18,'gold',8)
        for height in (.28,1.45):
            block((0,height,.05),(13.6,.075,.12),'steel')
        if builder.collide:
            solid(builder.hit,(0,.8,.05),(13.8,1.6,.3))
        bays = 24 if lod==0 else 10
        for index in range(bays):
            left=-6.8+13.6*index/bays;right=left+13.6/bays
            for low,high in ((.22,1.48),(1.48,.22)):
                tube(mesh,(left,low,.05),(right,high,.05),.045,'steel',8 if lod==0 else 4)
        street_skin(mesh,technical)
        builders.append((f'lod{lod}',builder))
    export_landmark(Path(sys.argv[1])/f'{identifier}.glb',image,builders)
