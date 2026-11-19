import math
from contextlib import contextmanager

from c_kit import tube


@contextmanager
def align_front(builder, pivot, yaw, shift=(0,0)):
    meshes = [*builder.parts.values(), builder.hit]
    starts = [len(mesh.pos) for mesh in meshes]
    yield
    cosine, sine = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    for mesh, start in zip(meshes, starts):
        for index in range(start, len(mesh.pos)):
            east, level, south = mesh.pos[index]
            east -= pivot[0]
            south -= pivot[1]
            mesh.pos[index] = (shift[0]+pivot[0]+cosine*east+sine*south, level, shift[1]+pivot[1]-sine*east+cosine*south)
            east, level, south = mesh.nrm[index]
            mesh.nrm[index] = (cosine*east+sine*south, level, -sine*east+cosine*south)


def loft(mesh, sections, region, sides=12):
    rings = []
    for east,level,south,rx,rz in sections:
        rings.append([(east+rx*math.cos(index*math.tau/sides),level,south+rz*math.sin(index*math.tau/sides)) for index in range(sides)])
    for lower,upper in zip(rings,rings[1:]):
        for index in range(sides):
            other=(index+1)%sides
            angle=(index+.5)*math.tau/sides
            mesh.face([lower[index],upper[index],upper[other],lower[other]],(math.cos(angle),0,math.sin(angle)),region,None)
    mesh.face(rings[0],(0,-1,0),region,None)
    mesh.face(rings[-1],(0,1,0),region,None)


def oval(mesh, center, radii, region, sides=12):
    east,level,south=center
    rx,ry,rz=radii
    sections=[]
    for angle in (-86,-54,-24,7,39,68,86):
        latitude=math.radians(angle)
        sections.append((east,level+ry*math.sin(latitude),south,rx*math.cos(latitude),rz*math.cos(latitude)))
    loft(mesh,sections,region,sides)


def banyan(mesh,origin,height,crown,seed,detail,lobed=True):
    east,level,south=origin
    scale=height/14
    girth=scale*(2.18 if lobed else 1)
    loft(mesh,[(east,level,south,1.65*girth,1.55*girth),
               (east-.28*scale,level+.95*scale,south,1.34*girth,1.28*girth),
               (east+.22*scale,level+2.9*scale,south-.18,1.04*girth,.97*girth),
               (east+.1,level+height*.37,south+.16,.81*girth,.86*girth)],'bark',12 if detail else 7)
    for index in range(5):
        angle=index*math.tau/5+seed*.55
        cosine,sine=math.cos(angle),math.sin(angle)
        fork=(east+crown*.34*cosine,level+height*.55,south+crown*.34*sine)
        tip=(east+crown*.65*cosine,level+height*.62,south+crown*.65*sine)
        tube(mesh,(east,level+height*.31,south),fork,.64*girth,'bark',7)
        tube(mesh,fork,tip,.34*girth,'bark',6)
        if detail:
            for root in range(5):
                if root not in (0,2,4):
                    continue
                fraction=.22+root*.17
                anchor=tuple(start+(end-start)*fraction for start,end in zip(fork,tip))
                endlevel=level if root==2 and index in (1,4) else anchor[1]-height*(.11+.05*((index+root)%4))
                tube(mesh,anchor,(anchor[0],endlevel,anchor[2]),.14*scale if endlevel==level else .035*scale,'bark',5)
    for index in range(7):
        phase=seed*.55+index*math.tau/6
        offset=.53 if index<6 else 0
        middle=(east+crown*offset*math.cos(phase),level+height*(.70+.075*math.sin(phase*2) if index<6 else .92),south+crown*offset*math.sin(phase))
        oval(mesh,middle,(crown*.56,height*(.23+.04*(index%3)),crown*.50),'foliage',10 if detail else 7)


def torus(mesh,center,radius,thickness,depth,region,wobble=0,stretch=1,phase=0):
    east,level,south=center
    sides,bands=22,8
    def point(index,band):
        angle=index*math.tau/sides
        cross=band*math.tau/bands
        radial=radius*(1+wobble*math.sin(3*angle+phase))+thickness*math.cos(cross)
        return east+radial*math.cos(angle),level+stretch*radial*math.sin(angle),south+depth*math.sin(cross)+wobble*math.cos(2*angle+phase)
    for index in range(sides):
        for band in range(bands):
            angle=(index+.5)*math.tau/sides;cross=(band+.5)*math.tau/bands
            mesh.face([point(index,band),point(index+1,band),point(index+1,band+1),point(index,band+1)],
                      (math.cos(angle)*math.cos(cross),math.sin(angle)*math.cos(cross),math.sin(cross)),region,None)
