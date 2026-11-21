from functools import cache
import math
import shapely
from PIL import ImageDraw

from c_kit import RECTS, _font, box, solid, tube, extrude, landmark_surface
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
    extras=[(m,len(m.pos)) for m in [*builder.parts.values(),builder.hit]]
    # IMG_1302, east sidewalk of Rongyin Road (way/221349761). Only model
    # the visible street frontage where the snapshot has no building outline.
    with align_front(builder, (63,-116), -111.9):
        mesh, glass = builder.parts['atlas'], builder.parts['lit']
        box(mesh, (63,10.1,-117.8), (14.4,14.2,3.6), 'cream')
        box(mesh, (63,5.9,-115.85), (12.4,.85,.36), 'wood')
        for east in (58,61.3,64.7,68):
            box(glass,(east,4.5,-115.9),(2.8,2.6,.24),'glass')
        # IMG_1302: stacked glazed corner balconies flank the plain central wall.
        for level in (7.4,10.6,13.8,16.3):
            for east in (57.6,68.4):
                box(mesh,(east,level-1.06,-115.44),(3.66,.22,1.12),'cream')
                box(glass,(east,level,-115.42),(3.38,1.91,1.02),'glass')
                for dx in (-1.67,0,1.67):
                    box(mesh,(east+dx,level,-114.88),(.10,1.97,.10),'cream')
                box(mesh,(east,level-.45,-114.88),(3.45,.10,.10),'brick')
        if builder.collide:
            solid(builder.hit,(63,10.1,-117.8),(14.4,14.2,3.6),'cream')
    # The small street-facing volume on way/521248452 stands in front of the hotel.
    with align_front(builder, (-4.5, -43.6), -20):
        mesh = builder.parts['atlas']
        back,front = -46.925,-41.55
        center = (-4.5,6.1,(back+front)/2)
        size = (7.25,9.6,front-back)
        box(mesh, center, size, 'brick')
        for level in (2.7, 6.1, 9.15):
            for east in (-6.25, -2.75):
                box(builder.parts['lit'], (east, level, front+.075), (2.65, 1.82, .14), 'glass')
        if builder.collide:
            solid(builder.hit, center, size, 'brick')
    for mesh,start in extras:
        for i in range(start,len(mesh.pos)):
            px,py,pz=mesh.pos[i]
            if abs(py-(3.0 if px>25 else 1.3))<.01 or (px>25 and abs(py-3.2)<.01):
                mesh.pos[i]=(px,landmark_surface('gunanmen').ground(px,pz)-.04,pz)
    for east,south,width,length,floors,kind in [(10,-51,17,24,4,'rong'),(10,-86,26.3,8.5,3,'inn'),(32,-115,15,19,3,'hall')]:
        base = landmark_surface('gunanmen').ground(east,south)
        if kind == 'inn':
            angle = math.radians(-21.92)
            base = landmark_surface('gunanmen').ground(east+width/2*math.cos(angle),south-width/2*math.sin(angle))
        meshes = [*builder.parts.values(),builder.hit]
        starts = [len(mesh.pos) for mesh in meshes]
        with align_front(builder, (east, south), -21.92):
            shop(builder, east, base, south, width, length, floors, kind)
        for mesh,start in zip(meshes,starts):
            for i in range(start,len(mesh.pos)):
                x,y,z = mesh.pos[i]
                if abs(y-base)<.008 or (kind=='hall' and 0 < y-base < .12):
                    mesh.pos[i] = (x,landmark_surface('gunanmen').ground(x,z)-.04,z)


def hotel_frontage(builder,outline,base,floors):
    """Fit windows and the hotel sign to the mapped L-shaped footprint."""
    stone, glass = builder.parts['atlas'],builder.parts['lit']
    ring = list(shapely.orient_polygons(shapely.Polygon(outline)).exterior.coords)
    for (x,z),(u,v) in zip(ring,ring[1:]):
        dx,dz = u-x,v-z
        length = math.hypot(dx,dz)
        nx,nz = dz/length,-dx/length
        mx,mz = (x+u)/2,(z+v)/2
        with align_front(builder,(mx,mz),math.degrees(math.atan2(nx,nz))):
            bays = max(1,round(length/4))
            for row in range(floors):
                box(stone,(mx,base+(row+1)*3.25,mz),(length,.16,.32),'brick')
                for i in range(bays):
                    bx = mx + ((i+.5)/bays-.5)*length
                    box(glass,(bx,base+row*3.25+1.66,mz+.04),(length/bays*.72,1.53,.12),'glass',None)
            if nx>.9 and length>15:
                box(stone,(mx,base+3.2,mz+.12),(9.2,1.3,.26),'wood')
                stone.face([(mx-4.5,base+2.63,mz+.26),(mx+4.5,base+2.63,mz+.26),
                            (mx+4.5,base+3.77,mz+.26),(mx-4.5,base+3.77,mz+.26)],
                           (0,0,1),'rong',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])


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
            hotel_frontage(builder,outline,base,floors)
            return
        else:
            box(stone,center,size,'rubble' if kind=='hall' else 'brick')
            if builder.collide:solid(builder.hit,center,size,'brick')
        face=east+width/2
        if kind=='hall':
            box(glass,(face+.15,base+5,south),(.3,9.8,6.2),'glass',None)
            for offset in (-3,-1,1,3):
                box(stone,(face+.33,base+5,south+offset),(.14,10,.11),'steel')
            for offset in (-3.5,3.5):
                box(stone,(face+1.2,base+2,south+offset),(2.5,3.8,.31),'vermilion')
            box(stone,(face+1.2,base+4,south),(2.6,.38,7.5),'vermilion')
            for step in range(7):
                tread = 1.15*(step+1)/7
                box(stone,(face+5-4.5*(step+.5)/7,base+tread/2,south),
                    (4.5/7+.02,tread,8.8),'granite',
                    top_mesh=builder.parts['sidewalk'] if step < 2 else None)
            return
        def grade(x,z):
            angle = math.radians(-21.92)
            dx,dz = x-east,z-south
            return landmark_surface('gunanmen').ground(east+dx*math.cos(angle)+dz*math.sin(angle),
                                                      south-dx*math.sin(angle)+dz*math.cos(angle))+.04
        def window(x,level,z,size):
            # Along the uphill return only the portion above the sidewalk is exposed.
            bottom = max(level-size[1]/2,grade(x,z))
            top = level+size[1]/2
            if top>bottom+.05:
                box(glass,(x,(top+bottom)/2,z),(size[0],top-bottom,size[2]),'glass',None)
        for row in range(floors):
            for side in (-1,1):
                for bay in (-.28,0,.28):
                    window(east+bay*width,base+1.66+row*3.25,south+side*(length/2+.06),(width*.21,1.53,.12))
                box(stone,(east,base+(row+1)*3.25,south+side*length/2),(width+.24,.16,.42),'brick')
            for bay in (-.32,0,.32):
                window(east-width/2-.06,base+1.66+row*3.25,south+bay*length,(.12,1.53,length*.23))
            for col in (-1,1):
                level=base+1.66+row*3.25
                offset=south+col*length*.245
                box(stone,(face+.08,level,offset),(.18,1.8,length*.44),'wood')
                box(glass,(face+.2,level,offset),(.09,1.53,length*.42),'glass',None)
        if kind == 'inn':
            # Sample the sidewalk in landmark space after rotating the shop footprint.
            for col in range(5):
                a = face + col*1.8
                for row in range(8):
                    c = south-5.6 + row*2
                    corners = [(a,c),(a+1.8,c),(a+1.8,c+2),(a,c+2)]
                    vertices = [(x,grade(x,z),z) for x,z in corners]
                    stone.face(vertices,(0,1,0),'plaza_stone')
                    if builder.collide:
                        builder.hit.face(vertices,(0,1,0),'ashlar')
            for stall in range(5 if builder.detail else 3):
                z = south-length*.4+1.28*stall
                scooter(stone,face+1.25,grade,z,('steel','cream','vermilion')[stall%3])
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


@cache
def scooter_profile():
    # Build one continuous side profile from tires, suspension, body and fork.
    tires = [shapely.Point(x,.24).buffer(.24,quad_segs=3) for x in (-.56,.56)]
    saddle = shapely.box(-.52,.63,0,.79)
    frame = shapely.LineString([(-.56,.24),(-.34,.67),(-.21,.44),(.40,.44),(.56,.24)]).buffer(.08,quad_segs=2)
    fork = shapely.LineString([(.56,.24),(.43,1.06)]).buffer(.055,quad_segs=1)
    profile = shapely.union_all([*tires,frame,fork,saddle])
    faces = []
    for triangle in shapely.constrained_delaunay_triangles(profile).geoms:
        center = triangle.centroid
        region = 'blacktile' if any(t.covers(center) for t in [*tires,saddle]) else 'body'
        xy = list(triangle.exterior.coords)[:-1]
        for side in (-1,1):
            faces.append(([(x,y,side*.09) for x,y in xy],(0,0,side),region))
    ring = list(shapely.orient_polygons(profile).exterior.coords)
    for (x,y),(u,v) in zip(ring,ring[1:]):
        faces.append(([(x,y,-.09),(u,v,-.09),(u,v,.09),(x,y,.09)],
                      (v-y,x-u,0),'blacktile' if max(y,v)<.32 else 'body'))
    return faces


def scooter(mesh,east,grade,south,color):
    rear, front = grade(east-.56,south), grade(east+.56,south)
    def height(x):
        return (rear+front)/2 + (front-rear)*x/1.12
    for vertices,normal,region in scooter_profile():
        mesh.face([(east+x,height(x)+y,south+z) for x,y,z in vertices],
                  normal,color if region=='body' else region)
    y = height(.43)+1.06
    tube(mesh,(east+.43,y,south-.24),(east+.43,y,south+.24),.045,'blacktile',4)


def approach(builder):
    mesh=builder.parts['atlas']
    ground = landmark_surface('gunanmen').ground
    path=[(18,-30),(23,-45),(31,-60),(37,-76),(44,-93),(51,-110),(57,-126)]
    for index,(east,south) in enumerate(path):
        base = ground(east+5,south)+.12
        start=len(mesh.pos)
        box(mesh,(east+5,base,south),(2.3,.24,2.3),'granite')
        banyan(mesh,(east+5,base+.12,south),9+index%3,4.9,77+index,builder.detail,lobed=False,grade=ground,join_forks=True)
        for i in range(start,len(mesh.pos)):
            px,py,pz=mesh.pos[i]
            outside=max(abs(px-east-5),abs(pz-south))>1.15
            if abs(py-(base-.12))<.001 or (outside and abs(py-(base+.12))<.001):
                mesh.pos[i]=(px,ground(px,pz)-.04,pz)
        for offset in range(7 if builder.detail else 3):
            scooter(mesh,east+5,ground,south+2+offset*.77,('steel','vermilion','cream')[offset%3])
    for index in range(5):
        east=16+index
        tube(mesh,(east,ground(east,-31)-.04,-31),(east,1.1,-31),.09,'yellow',6)
        for sign in (-1,1):
            tube(mesh,(16+index,1.1,-31),(16+index+sign*3.4,1.32,-34.4),.085,'yellow',4)
