"""Rock 01–21. Origin (-600,-150); each row follows a mapped pedestrian way."""
import math
import numpy as np
import trimesh
from jingjiang import Model,generate
from shop_lettering import letters
from dongxi_layout import registered_market


def row(model, first, last, count, side, depth=6, arcade=False, gap=3.45,tall=False):
    dx, dz = last[0]-first[0], last[1]-first[1]
    angle = math.atan2(dz,dx)
    pitch = math.hypot(dx,dz)/count
    for index in range(count):
        center = (index+.5)/count
        height=9.1 if tall or index%3==1 else 6.4
        key=(arcade,height)
        matrix=trimesh.transformations.rotation_matrix(-angle+(math.pi if side<0 else 0),[0,1,0])
        matrix[:3,3]=[first[0]+dx*center-math.sin(angle)*side*gap,0,first[1]+dz*center+math.cos(angle)*side*gap]
        matrix[:3,0]*=pitch/7;matrix[:3,2]*=depth/5
        model.placements.append((key,matrix))
        if key not in model.templates:
            template=Model(model.detail);shop(template,height,arcade);model.templates[key]=template


def shop(model,height,arcade):
        pitch,depth,side,gap=7,5,1,0
        back=depth/2
        model.box(0,0,back,pitch-.16,height,depth,'brick',True)
        if arcade:
            model.box(0,height,back,pitch+.1,.48,depth+.8,'white')
        else:
            model.swept_roof(0,height,back,pitch+.4,depth+1.5,1.65)
            for step in range(3):
                model.box(-pitch/2,height+step*.42,back,.36,.47,depth-step*1.4,'brick')
        model.box(0,3.05,side*(gap-.35),pitch,.35,1.9,'wood')
        for pier in (-.38,.38):
            model.box(pier*pitch,0,side*(gap-.9),.3,3.1,.31,'wood',True)
        if not model.detail: return
        for division in (-1,0,1):
            east=division*pitch/3
            model.box(east,.32,side*(gap-.06),pitch/3-.28,2.05,.12,'glass')
            model.box(east,2.48,side*(gap-.12),pitch/3-.45,.5,.16,'sign' if division else 'red')
            model.box(east,3.62,side*(gap-.09),pitch/3-.34,1.85,.18,'glass')
            model.box(east,3.5,side*(gap-.98),.13,.85,.13,'wood')
            for bar in (-.6,0,.6):model.box(east+bar,3.64,side*(gap-.21),.12,1.8,.12,'wood')
        model.box(0,4.3,side*(gap-.98),pitch,.14,.18,'wood')


def slab(model,first,last,width,level):
    dx,dz=last[0]-first[0],last[1]-first[1]
    model.pose=((first[0]+last[0])/2,0,(first[1]+last[1])/2,math.atan2(dz,dx))
    model.box(0,level-.1,0,math.hypot(dx,dz)+1,.1,width,'pave')


def screen_house(model):
    model.pose=(-22,0,7,-.39)
    model.box(0,0,0,22,10.7,9,'brick',True)
    for floor in range(3):
        level=floor*3.45
        for column in range(-4,5):
            model.box(column*2.35,level+.4,4.56,2.14,2.4,.15,'glass')
            model.box(column*2.35-1.1,level,5,.22,3.2,.3,'wood')
        model.box(0,level+3.06,4.85,23,.3,1.8,'wood')
        if floor:model.roof(0,level+2.6,4.9,23,2.8,.8)
    model.box(0,2.4,5.23,13,.68,.22,'sign');letters(model,'STARBUCKS COFFEE',(0,2.5,5.36),11,.42,'white')
    model.swept_roof(0,10.7,0,24.2,12,2.5)
    model.box(0,7.0,5.35,12.8,5.05,.38,'sign');model.box(0,7.29,5.58,12.23,4.47,.12,'glass')
    letters(model,'桂林 · 东西巷',(0,8.7,5.66),9,1.15,'gold')
    model.box(0,0,7.1,16,.45,3.3,'wood',True)
    model.pose=(-15,0,16,-.3)
    shell=trimesh.creation.icosphere(subdivisions=1)
    model.mesh(shell.vertices*[1.12,.48,.65]+[0,.72,0],shell.faces,'red')
    for side in (-1,1):
        for leg in range(3):model.beam([side*.8,.58,(leg-1)*.27],[side*1.55,.13,(leg-1)*.46],.085,'red')
        model.beam([side*.76,.75,.3],[side*1.35,1.25,.69],.16,'red')
        for claw in (-1,1):model.beam([side*1.35,1.25,.69],[side*(1.35+claw*.16),1.57,.7],.085,'red')


def seated_roof(model,height,width,depth,rise):
    corners=np.array([[-width/2,0,-depth/2],[width/2,0,-depth/2],[width/2,0,depth/2],[-width/2,0,depth/2],[-width*.27,rise,0],[width*.27,rise,0]])
    base=corners[:4].copy();base[:,1]=-.18
    faces=[[0,4,5],[0,5,1],[1,5,2],[2,5,4],[2,4,3],[3,4,0],[6,7,8],[6,8,9]]
    for side in range(4):
        end=(side+1)%4;faces.extend([[side,end,end+6],[side,end+6,side+6]])
    model.mesh(np.vstack((corners,base))+[0,height,0],faces,'tile')


def market(model):
    for first,last,width,level in [((-28,22),(6,25),22,.10),
        ((-6,24),(5,-15),10,.13),((0,28),(54,39),9,.12),((54,39),(63,-4),10,.14),
        ((63,-4),(3,-13),10,.15),((5,-14),(13,-62),32,.16),((58,18.5),(7,3.8),9,.17)]:slab(model,first,last,width,level)
    for east,south in [(-92,19.5),(-72,24.5),(-52,29.25),(-35,33.25)]:
        model.pose=(east,0,south,0);model.beam([0,0,0],[0,4.2,0],.22,'wood',8,True)
        crown=trimesh.creation.icosphere(subdivisions=1);model.mesh(crown.vertices*[2.3,2.15,2.55]+[0,5.2,0],crown.faces,'leaf')
    slab(model,(56,39),(85,50.5),8,.14)
    registered_market(model)
    model.pose=(-4.7,0,17,.14)
    for east,top in [(-6.5,5.15),(-3.4,6.6),(3.4,6.6),(6.5,5.15)]:
        model.box(east,0,0,.66,top,.78,'white',True)
        model.box(east,0,0,1,.54,1.15,'granite',True)
    for east,width,top in [(-5,3.3,4.6),(0,7.35,5.85),(5,3.3,4.6)]:
        model.box(east,top-.76,0,width,.78,.8,'white')
        model.box(east,top+.07,0,width+.48,.23,1.02,'granite')
    model.box(0,5.18,.45,2.95,.61,.12,'sign')
    letters(model,'东西巷',(0,5.26,.52),2.3,.43,'gold')
    for gateway in [(62,0,41,-1.39),(42,0,13.9,-1.29)]:
        model.pose=gateway
        if gateway[0]==62:
            for side in (-1,1):
                model.box(side*4.1,0,0,.65,4.25,4.8,'brick',True)
            model.box(0,4.25,0,8.85,3.1,4.8,'white',True)
            for side in (-1,1):
                for column in (-2.9,-1,1,2.9):
                    model.box(column,5.12,side*2.43,1.24,1.42,.13,'wood')
                    model.box(column,5.22,side*2.5,.96,1.22,.08,'glass')
                    model.box(column,5.22,side*2.56,.08,1.22,.06,'wood')
            seated_roof(model,7.35,9.65,5.7,1.15)
            continue
        for east in (-3.9,3.9):model.box(east,0,0,.74,6.7,1.1,'brick',True)
        model.box(0,4.4,0,8.5,2.2,1.1,'wood');model.roof(0,6.55,0,9.4,3.4,1.3)
        for side in (-1,1):letters(model,'东西巷',(0,4.9,side*.59),4.7,1.05,'gold',side)
    for east,south in [(7+index*1.05+side*10,-18-index*6.1) for side in (-1,1) for index in range(6)]:
        if south < -48:continue
        model.pose=(east,0,south,.14)
        model.box(0,0,0,3.1,1.03,1.8,'wood',True)
        for post in (-1.46,1.46):model.box(post,1,-.64,.11,1.35,.11,'wood')
        seated_roof(model,2.29,4.15,3.6,.52)


if __name__=='__main__':
    generate('wangcheng_market',market,dict(brick='#7a7d7b',white='#e8e4da',tile='#3b3e42',
             wood='#5a3a22',sign='#282420',pave='#8f8f88'))
