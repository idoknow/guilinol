import math

from c_kit import tube


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


def banyan(mesh,origin,height,crown,seed,detail):
    east,level,south=origin
    scale=height/14
    loft(mesh,[(east,level,south,1.65*scale,1.55*scale),
               (east-.28*scale,level+.95*scale,south,1.34*scale,1.28*scale),
               (east+.22*scale,level+2.9*scale,south-.18,1.04*scale,.97*scale),
               (east+.1,level+height*.37,south+.16,.81*scale,.86*scale)],'bark',12 if detail else 7)
    for index in range(5):
        angle=index*math.tau/5+seed*.55
        cosine,sine=math.cos(angle),math.sin(angle)
        fork=(east+crown*.34*cosine,level+height*.55,south+crown*.34*sine)
        tip=(east+crown*.65*cosine,level+height*.62,south+crown*.65*sine)
        tube(mesh,(east,level+height*.31,south),fork,.64*scale,'bark',7)
        tube(mesh,fork,tip,.34*scale,'bark',6)
        if detail:
            for root in range(5):
                fraction=.22+root*.17
                anchor=tuple(start+(end-start)*fraction for start,end in zip(fork,tip))
                endlevel=level if root==2 and index in (1,4) else anchor[1]-height*(.11+.05*((index+root)%4))
                tube(mesh,anchor,(anchor[0],endlevel,anchor[2]),.14*scale if endlevel==level else .035*scale,'bark',5)
    oval(mesh,(east,level+height*.72,south),(crown,height*.31,crown*.86),'foliage',22 if detail else 10)


def torus(mesh,center,radius,thickness,depth,region,wobble=0):
    east,level,south=center
    sides,bands=22,8
    def point(index,band):
        angle=index*math.tau/sides
        cross=band*math.tau/bands
        radial=radius*(1+wobble*math.sin(3*angle))+thickness*math.cos(cross)
        return east+radial*math.cos(angle),level+radial*math.sin(angle),south+depth*math.sin(cross)
    for index in range(sides):
        for band in range(bands):
            angle=(index+.5)*math.tau/sides;cross=(band+.5)*math.tau/bands
            mesh.face([point(index,band),point(index+1,band),point(index+1,band+1),point(index,band+1)],
                      (math.cos(angle)*math.cos(cross),math.sin(angle)*math.cos(cross),math.sin(cross)),region,None)
