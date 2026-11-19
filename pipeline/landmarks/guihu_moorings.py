"""Two moored passenger boats seen between Lize and Guanyi; not navigable craft."""
from xiaoyao_tower import generate


def cruisers(model):
    for station in (-13,13):
        model.pose=(0,2.0,station,0)
        perimeter=[(-1.9,6.6),(1.9,6.6),(2.05,-4.7),(.95,-7.0),(0,-7.45),(-.95,-7.0),(-2.05,-4.7)]
        count=len(perimeter)
        hull=[(east*scale,height,south*scale) for scale,height in [(.82,-.32),(1,.75)] for east,south in perimeter]
        for edge in range(count):
            following=(edge+1)%count
            model.mesh(hull,[[edge,following,following+count],[edge,following+count,edge+count]],'white')
        model.mesh(hull,[[count,count+edge,count+edge+1] for edge in range(1,count-1)],'earth')
        for height in (.77,2.28):
            model.box(0,height,0,3.55,1.23,10.8,'glass')
            model.box(0,height+1.23,0,3.98,.24,12,'white' if height<1 else 'earth')
            for side in (-1,1):
                for south in range(-5,6):
                    model.box(side*1.79,height,south,.08,1.24,.11,'white')
        model.box(0,3.75,-4,.05,1.15,.05,'granite')
        model.box(.28,4.47,-4,.55,.35,.025,'red')
    model.box(3,-.5,0,.20,2.3,2,'wood',True)


if __name__=='__main__':generate('guihu_moorings',cruisers)
