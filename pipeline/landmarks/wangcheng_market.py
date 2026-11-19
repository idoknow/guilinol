"""Rock 01–21. Origin (-600,-150); each row follows a mapped pedestrian way."""
import math
from jingjiang import generate


def row(model, first, last, count, side, depth=6, arcade=False):
    dx, dz = last[0]-first[0], last[1]-first[1]
    angle = math.atan2(dz,dx)
    pitch = math.hypot(dx,dz)/count
    for index in range(count):
        center = (index+.5)/count
        model.pose = (first[0]+dx*center,0,first[1]+dz*center,angle)
        back = side*(4.8+depth/2)
        height = 6.4 + (index%3==1)*2.7
        model.box(0,0,back,pitch-.16,height,depth,'brick',True)
        if arcade:
            model.box(0,height,back,pitch+.1,.48,depth+.8,'white')
        else:
            model.swept_roof(0,height,back,pitch+.4,depth+1.5,1.65)
            for step in range(3):
                model.box(-pitch/2,height+step*.42,back,.36,.47,depth-step*1.4,'brick')
        model.box(0,3.05,side*4.65,pitch,.35,2.8,'wood')
        for pier in (-.38,.38):
            model.box(pier*pitch,0,side*3.8,.3,3.1,.31,'wood',True)
        if not model.detail: continue
        for division in (-1,0,1):
            east=division*pitch/3
            model.box(east,.32,side*4.77,pitch/3-.28,2.05,.12,'glass')
            model.box(east,2.48,side*4.68,pitch/3-.45,.5,.16,'sign' if division else 'red')
            model.box(east,3.62,side*4.72,pitch/3-.34,1.85,.18,'glass')
            model.box(east,3.5,side*3.7,.13,.85,.13,'wood')
        model.box(0,4.3,side*3.7,pitch,.14,.18,'wood')


def market(model):
    row(model,(-101,23),(-39,37),7,-1,8,True)
    row(model,(9,30),(51,40),6,-1)
    row(model,(5,30),(51,40),6,1,4.3)
    row(model,(61,36),(65,2),4,1)
    row(model,(55,-6),(9,-12),5,1)
    model.pose=(-32,0,-2,.19)
    model.box(0,0,0,20,7.8,9,'brick',True)
    model.swept_roof(0,7.8,0,22,12,2.4)
    model.box(0,1.1,4.6,14,6,.28,'wood')
    model.box(0,1.45,4.8,13.3,5.3,.15,'glass')
    model.box(0,0,6,17,.46,3,'wood',True)
    model.pose=(-3,0,9,.14)
    for east,top in [(-6.5,5.15),(-3.4,6.6),(3.4,6.6),(6.5,5.15)]:
        model.box(east,0,0,.66,top,.78,'white',True)
        model.box(east,0,0,1,.54,1.15,'granite',True)
    for east,width,top in [(-5,3.3,4.6),(0,7.35,5.85),(5,3.3,4.6)]:
        model.box(east,top-.76,0,width,.78,.8,'white')
        model.box(east,top+.07,0,width+.48,.23,1.02,'granite')
    model.box(0,5.18,.45,2.95,.61,.12,'sign')
    for east,south in [(-18,-17),(22,-28),(-19,-37),(23,-47)]:
        model.pose=(east,0,south,.14)
        model.box(0,0,0,3.1,1.03,1.8,'wood',True)
        for post in (-1.46,1.46):model.box(post,1,-.64,.11,1.35,.11,'wood')
        model.roof(0,2.29,0,3.8,2.6,.52)


if __name__=='__main__': generate('wangcheng_market',market)
