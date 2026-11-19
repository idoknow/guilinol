"""OSM 693451306 and its two road axes: ~281 m long, ~43 m wide.
The 2001 six-lane crossing (not the narrow 1972 bridge) has broad walks.
Heights follow the baked west/east road approaches; pier spacing and fascia
are estimates from bank views, not engineering sections.
"""
import math
import numpy as np
import trimesh
from jiefang_materials import generate_bridge
from jiefang_roads import interchange


def arch(model, center, radius, width, spring, rise, top, blocks=False):
    count = 24 if model.detail else 8
    for idx in range(count):
        angles=np.pi*np.array([idx,idx+1])/count
        ends=center+radius*np.cos(angles); lows=spring+rise*np.sin(angles)
        corners=[(east,height,side*width/2) for side in (-1,1) for east,height in
                 [(ends[0],lows[0]),(ends[1],lows[1]),(ends[1],top),(ends[0],top)]]
        model.mesh(corners,[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1]],'stone')
        if blocks and model.detail:
            for side in (-1,1):
                face=[(center+(radius+dr)*math.cos(angle),spring+(rise+dr)*math.sin(angle),side*(width/2+.04))
                      for angle,dr in [(angles[0],0),(angles[1],0),(angles[1],.42),(angles[0],.42)]]
                model.mesh(face,[[0,1,2],[0,2,3]],'white' if idx%4==0 else 'granite')


def river_ribs(model, start, end, width):
    # Paired ribs branch out above each springing in the river views (41/49).
    count = 28 if model.detail else 10
    for side in (-1,1):
        z=side*(width/2-.35)
        for idx in range(count):
            span=np.array([idx,idx+1])/count
            x=start+(end-start)*span
            low=-6.35+4.15*(1-(2*span-1)**2)
            section=[(px,py+dy,z+dz) for dz in (-.65,.65)
                     for px,py,dy in ((x[0],low[0],0),(x[1],low[1],0),
                                      (x[1],low[1],1.35),(x[0],low[0],1.35))]
            model.mesh(section,[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[2,6,7],[2,7,3]],'white')
            edge=[(px,py+dy,z+side*.665) for px,py,dy in
                  ((x[0],low[0],.04),(x[1],low[1],.04),(x[1],low[1],.22),(x[0],low[0],.22))]
            model.mesh(edge,[[0,1,2],[0,2,3]],'ice')
        for t in (.09,.19,.31,.69,.81,.91):
            x=start+(end-start)*t
            y=-5.55+4.15*(1-(2*t-1)**2)+.5
            model.box(x,y,z,.34,-1.2-y,.65,'white')


def rail(model, length, offset, height, step, stone=False):
    for side in (-1,1):
        south=side*offset
        model.box(0,height+.92,south,length,.16,.2,'white' if stone else 'granite',True)
        for east in np.linspace(-length/2,length/2,max(2,int(length/(step if model.detail else step*6)))):
            model.box(east,height,south,.24,1.1,.24,'stone' if stone else 'granite',True)
            if model.detail:
                model.box(east,height+1.08,south,.31,.12,.31,'white')
        if model.detail:
            model.box(0,height+.35,south,length,.11,.12,'granite')


def lantern(model,x,y,z,size):
    # Six light panes between dark brass rims, suspended from a finial.
    angles=np.arange(7)*math.pi/3
    def rim(radius,height):
        return np.array([x+radius*size*np.cos(angles),np.full(7,y+height*size),z+radius*size*np.sin(angles)]).T
    for bottom,top,color in ((rim(.18,-.53),rim(.36,-.38),'wood'),(rim(.36,-.38),rim(.42,.32),'lamp'),
                              (rim(.5,.32),rim(.18,.55),'wood')):
        vertices=np.concatenate([bottom,top])
        faces=[[i,i+1,i+8] for i in range(6)]+[[i,i+8,i+7] for i in range(6)]
        model.mesh(vertices,faces,color)
    for radius,level in ((.18,-.53),(.18,.55),(.5,.32)):
        cap = rim(radius,level)
        model.mesh([*cap[:6],(x,y+level*size,z)],[[6,i,(i+1)%6] for i in range(6)],'wood')
    if model.detail:
        for angle in angles[:-1]:
            face=[(x+r*size*math.cos(angle+d),y+h*size,z+r*size*math.sin(angle+d)) for r,h,d in
                  ((.36,-.38,-.055),(.36,-.38,.055),(.42,.32,.055),(.42,.32,-.055))]
            model.mesh(face,[[0,1,2],[0,2,3]],'wood')


def pillar(model,tone,flat=False):
    for width,depth,y in ((3.5,2.7,-.18),(3.15,2.4,.02),(2.82,2.12,.22)):
        model.box(0,y,0,width,.2,depth,'stone',True)
    model.box(0,.42,0,2.44,1.72,1.76,'stone',True)
    model.box(0,2.08,0,2.48,.16,1.78,'granite')
    # Four tinted faces enclose the hanging lamps above a continuous plinth.
    model.box(0,2.24,0,2.24,5.15,1.44,'glazing',True)
    if flat:
        model.box(0,7.39,0,2.48,.25,1.70,'granite')
        model.box(0,7.64,0,2.39,.10,1.61,tone)
    for x in (-1.12,1.12):
        model.box(x,.42,0,.48,.48,1.85,'granite',True)
        for z in (-.72,.72):
            model.box(x,.88,z,.22,6.52,.2,'white',True)
            model.box(x+np.sign(x)*.10,.88,z+np.sign(z)*.105,.16,6.54,.16,tone)
            if flat:continue
            model.beam([x,7.39,z],[0,8.56,z],.13,'white',6)
            model.beam([x,7.39,z+np.sign(z)*.15],[0,8.56,z+np.sign(z)*.15],.105,tone,6)
    if not flat:
        for x in (-1.12,1.12):
            slope=[(x,7.39,-.72),(0,8.56,-.72),(0,8.56,.72),(x,7.39,.72)]
            model.mesh(slope,[[0,1,2],[0,2,3]],'glazing')
        model.beam([0,8.56,-.75],[0,8.56,.75],.08,tone,6)
        for z in (-.72,.72):
            model.mesh([(-1.12,7.39,z),(1.12,7.39,z),(0,8.56,z)],[[0,1,2]],'glazing')
    for z in (-.71,.71):
        diamond=[(0,7.28,z),(.58,6.73,z),(0,6.16,z),(-.58,6.73,z),(0,7.28,z)]
        for a,b in zip(diamond,diamond[1:]):model.beam(a,b,.047,'granite',5)
        model.box(0,5.94,z,2.16,.14,.14,'white')
    model.box(0,5.96,0,2.25,.12,1.46,'wood')
    for i,x in enumerate((-.65,0,.65)):
        count=(3,4,3)[i] if model.detail else 2
        model.beam([x,6.02,0],[x,5.26-(count-1)*.72,0],.025,'wood',5)
        for j in range(count):
            lantern(model,x,5.6-j*.72,0,.61)


def pendant(model, x, y, z):
    model.box(x,y,z,.35,.4,.35,'stone')
    model.beam([x,y,z],[x,y+4.85,z],.115,'white',8)
    for dx in (-.42,.88):
        model.beam([x,y+4.13,z],[x+dx,y+4.77,z],.065,'white')
        model.beam([x+dx,y+4.77,z],[x+dx,y+4.44,z],.05,'granite')
    lantern(model,x+.88,y+4.03,z,.82)


def stone_balustrade(model,start,end):
    count=max(1,round((end-start)/(3.8 if model.detail else 6)))
    for side in (-1,1):
        z=side*21.1
        for y,h,d in ((.18,.18,.44),(1.12,.16,.38)):
            model.box((start+end)/2,y,z,end-start,h,d,'white',True)
        for x in np.linspace(start,end,count+1):
            model.box(x,.35,z,.31,.84,.32,'granite',True)
        # Two carved wave bands leave open sky between the stone cap and sill.
        for x0,x1 in zip(np.linspace(start,end,count+1)[:-1],np.linspace(start,end,count+1)[1:]):
            for invert in (-1,1):
                xs=np.linspace(x0,x1,7 if model.detail else 4)
                ys=.73+invert*.24*np.cos(2*np.pi*(xs-x0)/(x1-x0))
                for i in range(len(xs)-1):
                    face=[(xs[k],ys[k]+h,z) for k,h in ((i,0),(i+1,0),(i+1,.105),(i,.105))]
                    model.mesh(face,[[0,1,2],[0,2,3]],'white')


def lamp_post(model,x,side):
    z=side*18.9
    model.beam([x,.18,z],[x,7.25,z],.13,'granite',8)
    for reach,h in ((-2.25,7.05),(1.37,6.25)):
        tip=z+side*reach
        model.beam([x,h-.65,z],[x,h,tip],.10,'granite',8)
        model.box(x,h,tip,.36,.18,.78,'white')
        model.box(x,h-.06,tip,.3,.06,.67,'lamp')
    if model.detail:
        knot=z-side*.52
        model.beam([x,4.65,z],[x,4.65,knot],.06,'granite')
        model.beam([x,4.65,knot],[x,3.77,knot],.035,'knot')
        model.box(x,3.77,knot,.14,.10,.34,'knot')
        for dy,r in ((0,.27),(-.31,.20)):
            pts=[[x,4.48+dy,knot],[x,4.48+dy-r,knot+r],[x,4.48+dy-2*r,knot],[x,4.48+dy-r,knot-r],[x,4.48+dy,knot]]
            for a,b in zip(pts,pts[1:]):model.beam(a,b,.063,'knot',4)
        for dz in (-.11,.11):model.box(x,3.16,knot+dz,.08,.66,.1,'knot')


def west_bank(model):
    # Photo-matched platforms beside the OSM river-bank paths.
    for side, tone in ((-1,'violet'),(1,'jade')):
        # The lower intersection looks across the carriageway at three towers.
        if side==1:
            model.box(-110.8,-5.83,36.8,7.8,.82,21,'stone',True)
            model.box(-110.8,-5.01,36.8,7.8,.10,21,'pave',True)
            model.box(-107,-4.91,38.55,.36,.57,17.5,'stone',True)
            model.beam([-107,-4,29.8],[-107,-4,47.3],.085,'white',8,True)
            for z in (30.4,36.8,43.2):
                model.pose=(-109.5,-4.90,z,{30.4:-.67,36.8:0,43.2:.99}[z])
                pillar(model,'violet',flat=z==36.8)
        # Bank lookouts project toward the water; the end tower frames the span.
        model.pose=(0,0,0,0)
        model.box(-97,-5.5,side*61,25,.98,14,'stone',True)
        model.box(-97,-4.52,side*61,25,.16,14,'pave',True)
        # A sloping footway joins the lower landing to the viewing terrace.
        corners=[(-118,-5.11,side*41),(-114,-5.11,side*41),
                 (-102,-4.36,side*57),(-107,-4.36,side*57)]
        model.mesh(corners,[[0,1,2],[0,2,3],[2,1,0],[3,2,0]],'pave',True)
        for z in (side*54.2,side*67.8):
            model.box(-94,-4.36,z,19,.54,.36,'stone',True)
            model.beam([-103.5,-3.49,z],[-84.5,-3.49,z],.08,'white',8,True)
            for x in range(-103,-84,3):
                model.beam([x,-3.9,z],[x,-3.47,z],.055,'white')
        model.box(-84.7,-4.36,side*61,.34,.59,14,'stone',True)
        model.beam([-84.7,-3.46,side*54],[-84.7,-3.46,side*68],.09,'white',8,True)
        for z in (54,57.5,61,64.5,68):
            model.beam([-84.7,-3.84,side*z],[-84.7,-3.46,side*z],.06,'white')
        model.pose=(-90.7,-4.36,side*57.1,math.pi*.14*side)
        pillar(model,'aqua' if side==1 else 'jade')
        model.pose=(0,0,0,0)
        model.beam([-143,.04,side*12],[-143,5.2,side*12],.14,'granite')
        model.box(-143,4.3,side*12,.48,1.23,.4,'sign')
        model.box(-143.26,5.12,side*12,.08,.25,.25,'red')
    model.pose=(0,-1.5,0,0)
    # Two-way lower road, alongside the 5 m pedestrian landing.
    # A paved crossing, with signals on the approach and an unobstructed view
    # of the three river-side lantern towers from the opposite kerb.
    for x in np.arange(-125,-118.4,1):
        model.box(x,-3.73,36,.48,.035,3.4,'white')
    model.beam([-113.9,-3.8,38.35],[-113.9,1.7,38.35],.14,'granite')
    model.beam([-113.9,1.65,38.35],[-113.9,1.65,39.05],.1,'granite')
    model.box(-113.9,.55,39.05,.42,1.25,.42,'sign')
    model.box(-114.14,1.4,39.05,.09,.28,.28,'knot')
    pendant(model,-114.35,-3.72,29.4)
    for z in (-36,-24,24):
        pendant(model,-118.3,-3.92,z)
    model.pose=(0,0,0,0)


def bridge(model):
    from c_kit import landmark_surface
    surface = landmark_surface('jiefang_bridge')
    length=281; width=43
    # The west portal has a curved soffit and a thinner slab above the crown.
    for left,right,depth in ((-140.5,-136,1.22),(-136,-103,.36),(-103,140.5,1.22)):
        model.box((left+right)/2,-depth,0,right-left,depth,width,'stone',True)
    model.box(0,-.03,0,length,.08,32.2,'tile')
    for side in (-1,1):
        model.box(0,0,side*18.8,length,.18,5.25,'pave',True)
        model.box(0,.05,side*16.16,length,.15,.3,'granite',True)
        model.box(0,.055,side*12,length,.018,.15,'white')
        model.box(0,.055,side*.18,length,.015,.13,'yellow')
        model.box(0,.182,side*16.93,length,.018,.46,'granite')
        if model.detail:
            for offset in (-.13,0,.13):
                model.box(0,.20,side*16.93+offset,length,.014,.036,'white')
            for lane in (3.7,7.4):
                for east in np.arange(-135,138,9):model.box(east,.055,side*lane,3,.02,.13,'white')
        for east in np.arange(-126,127,21 if model.detail else 42):
            lamp_post(model,east,side)
    springings=(-92,-46,0,46,92,140.5)
    for pier in springings[:-1]:
        # The two rib feet bear on short cutwaters. Open water between them
        # stays visible through the arch from the oblique bank stations.
        for side in (-1,1):
            z=side*(width/2-.35)
            bed, water = surface.sample(pier,z)
            base = bed-(5.62-pier*1.3/281)-.12
            if base < -5.63:
                model.beam([pier,base,z],[pier,-5.63,z],1.84,'stone',10)
            model.box(pier,-5.69,z,3.65,.5,3.2,'granite')

    for side in (-1,1):
        model.box(0,-.28,side*21.4,length,.12,.15,'lamp')
        for east in np.linspace(-136,136,35 if model.detail else 13):
            model.box(east,1.26,side*21.1,.55,.24,.39,'lamp')
    for start,end in zip(springings,springings[1:]):
        river_ribs(model,start,end,width)
    for pier in springings[1:-1]:
        for side in (-1,1):
            z=side*21.28
            xs=np.linspace(-10,10,14 if model.detail else 6)
            for a,b in zip(xs,xs[1:]):
                face=[(pier+x,-1.63-1.65*(x/10)**2+h,z) for x,h in ((a,0),(b,0),(b,.28),(a,.28))]
                model.mesh(face,[[0,1,2],[0,2,3]],'white')
    model.box(-138,-5.35,0,3.4,4.13,width-1,'stone',True)
    for start,end in ((-140.5,-100),(-96,140.5)):
        stone_balustrade(model,start,end)
    # Shallow barrel vault over Binjiang Road; road and walk pass below its crown.
    for xa,xb in zip(np.linspace(-136,-103,19)[:-1],np.linspace(-136,-103,19)[1:]):
        def soffit(x):
            u=(x+119.5)/16.5
            return -.47-1.55*u*u-.85*u**4
        face=[(x,soffit(x),z) for x,z in ((xa,-21.45),(xb,-21.45),(xb,21.45),(xa,21.45))]
        model.mesh(face,[[0,1,2],[0,2,3]],'concrete',True)
        for side in (-1,1):
            z=side*21.45
            model.mesh([(xa,soffit(xa),z),(xb,soffit(xb),z),(xb,-.36,z),(xa,-.36,z)],[[0,1,2],[0,2,3]],'white')
    west_bank(model)
    interchange(model)


if __name__=='__main__':
    generate_bridge(bridge)
