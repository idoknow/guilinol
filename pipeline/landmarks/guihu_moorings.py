"""Two moored passenger boats seen between Lize and Guanyi; not navigable craft."""
import math
from xiaoyao_tower import generate


def cruisers(model):
    for east,station,yaw in [(-83.015,-70.074,.488),(-88.105,-54.923,.264),
                             (-92.539,-38.511,.264),(2.944,64.129,-3.019)]:
        small=station>0
        model.pose=(east,2.0,station,yaw)
        perimeter=[(-1.9,6.6),(1.9,6.6)]+[(2.05*math.cos(angle*math.pi/12),-4.7-2.75*math.sin(angle*math.pi/12)) for angle in range(13)]
        count=len(perimeter)
        hull=[(east*scale,height,south*scale) for scale,height in [(.82,-.32),(1,.75)] for east,south in perimeter]
        for edge in range(count):
            following=(edge+1)%count
            model.mesh(hull,[[edge,following,following+count],[edge,following+count,edge+count]],'white')
        model.mesh(hull,[[count,count+edge,count+edge+1] for edge in range(1,count-1)],'white')
        if not small:
            stripe=[(east*scale,height,south*scale) for scale,height in [(.954,.45),(.99,.65)] for east,south in perimeter]
            for edge in range(count):
                following=(edge+1)%count
                model.mesh(stripe,[[edge,following,following+count],[edge,following+count,edge+count]],'green')
        for height in ((.77,) if small else (.77,2.28)):
            model.box(0,height,0,3.55,.43,10.8,'white')
            if not small: model.box(0,height+.43,0,3.36,.8,10.5,'glass')
            model.box(0,height+1.23,0,3.98,.24,12,'earth' if small else 'white')
            for side in (-1,1):
                if not small: model.box(side*1.79,height+.12,0,.06,.18,10.8,'green')
                for south in range(-5,6):
                    model.box(side*1.79,height,south,.08,1.24,.11,'white')
        if small:
            model.box(0,2.24,-4,.05,1.42,.05,'granite')
            model.box(.43,3.08,-4,.86,.56,.025,'red')
            model.box(.19,3.43,-4,.09,.09,.031,'yellow')
    model.pose=(0,0,0,0)
    model.box(3,-.5,0,.20,2.3,2,'wood',True)


if __name__=='__main__':generate('guihu_moorings',cruisers,colors=dict(earth='#dc92ab',green='#133d73'))
