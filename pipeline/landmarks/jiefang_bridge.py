"""OSM 693451306 and its two road axes: ~281 m long, ~43 m wide.
The 2001 six-lane crossing (not the narrow 1972 bridge) has broad walks.
Heights follow the baked west/east road approaches; pier spacing and fascia
are estimates from bank views, not engineering sections.
"""
import math
import numpy as np
import trimesh
from jiefang_materials import generate_bridge
from jiefang_layout import LOWER, deck_level, section, LOWER_ROADS, promenade_offset
from jiefang_roads import interchange, surface, vertex


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


def pillar(model,tone):
    # Separate glazed legs leave the tactile strip and the lower opening clear.
    for x in (-1.34,1.34):
        model.box(x,0,0,.58,.44,1.7,'stone',True)
        model.box(x,.44,0,.43,6.95,1.46,'glazing',True)
        for z in (-.72,.72):
            model.box(x,0,z,.20,7.39,.20,'white',True)
            model.box(x+np.sign(x)*.10,.45,z+np.sign(z)*.10,.13,6.94,.12,tone)
            model.beam([x,7.39,z],[0,8.56,z],.13,'white',6)
            model.beam([x,7.39,z+np.sign(z)*.12],[0,8.56,z+np.sign(z)*.12],.10,tone,6)
        roof=[(x,7.39,-.72),(0,8.56,-.72),(0,8.56,.72),(x,7.39,.72)]
        model.mesh(roof,[[0,1,2],[0,2,3]],'glazing')
    model.beam([0,8.56,-.75],[0,8.56,.75],.08,tone,6)
    for z in (-.72,.72):
        model.mesh([(-1.34,7.39,z),(1.34,7.39,z),(0,8.56,z)],[[0,1,2]],'glazing')
    model.box(0,6.08,0,2.68,1.31,1.44,'glazing')
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
            model.box((start+end)/2,y,z,end-start,h,d,'rail_white' if y>1 else 'white',True)
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
    south,north=(section(way) for way in LOWER_ROADS)
    xy=np.vstack((south[0][:-1],north[0]))
    n=np.vstack((south[1][:-1],north[1]))
    strip_offset=promenade_offset(xy[:,1])
    sidewalk=xy+n*strip_offset[:,None]
    chain=np.r_[0,np.cumsum(np.linalg.norm(np.diff(sidewalk,axis=0),axis=1))]
    def station_at(z):
        return np.interp(z,sidewalk[::-1,1],chain[::-1])
    bridge_station=station_at(0)

    def sidewalk_pose(distance,height):
        station=bridge_station+distance
        i=np.searchsorted(chain,station)-1
        fraction=(station-chain[i])/(chain[i+1]-chain[i])
        tangent=sidewalk[i+1]-sidewalk[i]
        x,z=sidewalk[i]+fraction*tangent
        # Use the shore normal even where the tactile strip shifts sideways.
        normal=n[i]+fraction*(n[i+1]-n[i])
        return x,LOWER+.12+height-deck_level(x),z,math.atan2(normal[1],normal[0])

    def landing(start,end,height):
        # Include every OSM bend so the kerb and parapet stay outside the steps.
        lo,hi=bridge_station+start,bridge_station+end
        stations=np.r_[lo,chain[(lo<chain)&(chain<hi)],hi]
        def edge(offset,level):
            points=sidewalk+n*offset
            xs,zs=(np.interp(stations,chain,axis) for axis in points.T)
            return np.array([vertex((x,z),LOWER+level) for x,z in zip(xs,zs)])
        left,right=edge(-1.88,.12+height),edge(1.88,.12+height)
        surface(model,left,right,'stone')
        for rim in (left,right,[left[0],right[0]],[left[-1],right[-1]]):
            rim=np.asarray(rim)
            surface(model,rim,rim-[0,height+.14,0],'stone')
        surface(model,edge(-.17,.13+height),edge(.17,.13+height),'yellow',False)

    for side,tone in ((-1,'violet'),(1,'jade')):
        # Station increases northwards. Each landing serves three portals,
        # with three risers at each end and space between landings for crossings.
        spacing=10.95
        for z in ((-64.10,-118.50) if side<0 else (61.65,115.74)):
            center=station_at(z)-bridge_station
            model.pose=(0,0,0,0)
            lo,hi=center-spacing-1.15,center+spacing+1.15
            landing(lo,hi,.45)
            for end,edge in ((-1,lo),(1,hi)):
                for step in (2,1):
                    tip=edge+end*.36
                    landing(min(edge,tip),max(edge,tip),.15*step)
                    edge=tip
            for offset in (-spacing,0,spacing):
                model.pose=sidewalk_pose(center+offset,.45)
                pillar(model,tone)
        # Lower viewing terraces have unobstructed views of the span.
        model.pose=(0,0,0,0)
        model.box(-97,-5.5,side*61,25,.98,14,'stone',True)
        model.box(-97,-4.52,side*61,25,.16,14,'pave',True)
        # A sloping footway joins the lower landing to the viewing terrace.
        corners=[]
        for station in (-side*45-1.5,-side*45+1.5):
            x,h,z,angle=sidewalk_pose(station,0)
            corners.append((x+1.7*math.cos(angle),h,z+1.7*math.sin(angle)))
        corners.extend([(-102,-4.36,side*57),(-107,-4.36,side*57)][::side])
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
        model.pose=(0,0,0,0)
        model.beam([-143,.04,side*12],[-143,5.2,side*12],.14,'granite')
        model.box(-143,4.3,side*12,.48,1.23,.4,'sign')
        model.box(-143.26,5.12,side*12,.08,.25,.25,'red')
        # The crossing and its signal occupy the opening between the two triples.
        crossing=station_at(-93.8 if side<0 else 91.0)
        model.pose=sidewalk_pose(crossing-bridge_station,0)
        road_offset=np.interp(crossing,chain,strip_offset)
        for stripe in np.arange(-3,4):
            model.box(-road_offset+stripe,-.095,0,.48,.025,3.4,'white')
        model.beam([-1.45,0,2.25],[-1.45,5.4,2.25],.14,'granite')
        model.box(-1.45,4.15,2.25,.42,1.25,.42,'sign')
        model.box(-1.69,5,2.25,.09,.28,.28,'knot')
        for distance in (24,48):
            model.pose=sidewalk_pose(-side*distance,0)
            pendant(model,-1.45,0,0)
    model.pose=(0,0,0,0)


def bridge(model):
    from c_kit import landmark_surface
    from jiefang_layout import deck_level
    surface = landmark_surface('jiefang_bridge')
    from jiefang_east import portal_furniture
    portal_furniture(model,surface)
    length=281; width=43
    # The west portal has a curved soffit and a thinner slab above the crown.
    for left,right,depth in ((-140.5,-136,1.22),(-136,-103,.36),(-103,140.5,1.22)):
        model.box((left+right)/2,-depth,0,right-left,depth,width,'stone',True)
    model.box(0,-.03,0,length,.08,32.2,'road')
    for side in (-1,1):
        walk_inner = 16.175
        walk_outer = width/2
        model.box(0,0,side*(walk_inner+walk_outer)/2,length,.18,walk_outer-walk_inner,'pave',True)
        model.box(0,.05,side*16.16,length,.15,.3,'curb_granite',True)
        model.box(0,.055,side*12,length,.018,.18,'paint_white')
        model.box(0,.055,side*.18,length,.015,.18,'paint_yellow')
        model.box(0,.182,side*16.93,length,.018,.46,'granite')
        if model.detail:
            for offset in (-.13,0,.13):
                model.box(0,.20,side*16.93+offset,length,.014,.036,'white')
            for lane in (3.7,7.4):
                model.box(0,.055,side*lane,length,.02,.18,'paint_white')
        for east in np.arange(-126,127,21 if model.detail else 42):
            lamp_post(model,east,side)
    springings=(-92,-46,0,46,92,140.5)
    for pier in springings[:-1]:
        # The two rib feet bear on short cutwaters. Open water between them
        # stays visible through the arch from the oblique bank stations.
        for side in (-1,1):
            z=side*(width/2-.35)
            bed, water = surface.sample(pier,z)
            base = bed-deck_level(pier)-.12
            if base < -5.63:
                model.beam([pier,base,z],[pier,-5.63,z],1.84,'stone',10)
            model.box(pier,-5.69,z,3.65,.5,3.2,'granite')

    for side in (-1,1):
        model.box(0,-.28,side*21.4,length,.12,.15,'lamp')
        for east in np.linspace(-136,136,35 if model.detail else 13):
            model.box(east,1.26,side*21.1,.55,.24,.39,'lamp')
    for start,end in zip(springings,springings[1:-1]):
        river_ribs(model,start,end,width)
    for start in np.arange(140.5,155.5,1.):
        def landing(along):
            distance=along-140.5
            roll=min(distance,15-distance,2.)
            drop=(distance-1 if distance>=2 else distance**2/4) if distance<=13 else 13-roll**2/4
            return .046-.05*drop
        for left,right,offset in ((-21.5,-16.2,.14),(-16.2,16.2,0),(16.2,21.5,.14)):
            corners=[(along,landing(along)+offset,side) for along,side in ((start,left),(start,right),(start+1,right),(start+1,left))]
            model.solid.append(np.asarray(corners)[[[0,1,2],[0,2,3]]])
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
