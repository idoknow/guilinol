"""Open a straight ground-floor passage in a catalog building at both LODs."""
import math

import numpy as np
from shapely import LineString, Point, Polygon
from shapely.ops import triangulate


def split_face(vertices, signed):
    inside, outside = [], []
    previous = vertices[-1]
    first = signed(previous)
    for current in vertices:
        second = signed(current)
        if (first < 0) != (second < 0):
            cut = previous + first/(first-second)*(current-previous)
            inside.append(cut)
            outside.append(cut)
        (inside if second >= 0 else outside).append(current)
        previous, first = current, second
    return inside, outside


def carve(part, start, planes):
    faces = part.faces[start:]
    del part.faces[start:]
    for face in faces:
        pending = [np.r_[part.pos[i],part.nrm[i],part.uv[i]] for i in face]
        if any(all(fn(v)<0 for v in pending) for fn in planes):
            part.faces.append(face)
            continue
        for plane in planes:
            pending, keep = split_face(pending, plane)
            if len(keep)>=3:
                at=len(part.pos)
                for v in keep:
                    part.pos.append(v[:3]);part.nrm.append(v[3:6]);part.uv.append(v[6:])
                part.faces.extend((at,at+j,at+j+1) for j in range(1,len(keep)-1))
            if len(pending)<3:
                break


def open_straight_passage(b, ring, spec, axis, half, highest_road, build):
    footprint=Polygon(ring)
    crossing=footprint.intersection(axis.buffer(half,cap_style='flat'))
    if crossing.geom_type!='Polygon' or crossing.is_empty:
        raise ValueError('Campus passage no longer crosses a single wing')
    parts=(b.atlas,b.lit,b.hit)
    starts=[len(part.faces) for part in parts]
    _,roof=build(b,ring,**spec)
    upper=roof-highest_road>=4
    ceiling=highest_road+3.51 if upper else max(v[1] for v in b.atlas.pos)+1
    a,c=np.asarray(axis.coords)
    normal=np.array([a[1]-c[1],c[0]-a[0]])/axis.length
    def lateral(v):
        return np.dot(v[[0,2]]-a,normal)
    planes=[lambda v:half-lateral(v),lambda v:half+lateral(v),lambda v:ceiling-v[1]]
    for part,start in zip(parts,starts):
        carve(part,start,planes)
    def panel(vertices, direction):
        b.face(vertices,direction,spec['wall'])
        if b.collide:
            b.hit.add_poly(vertices,direction,None)
    if upper:
        for tri in triangulate(crossing):
            if crossing.covers(tri):
                panel([(x,ceiling,z) for x,z in list(tri.exterior.coords)[:-1]],(0,-1,0))
    for sign in (-1,1):
        side=axis.offset_curve(sign*half).intersection(footprint)
        for line in getattr(side,'geoms',[side]):
            for p,q in zip(line.coords,list(line.coords)[1:]):
                h=min(b.surface.ground(*p),b.surface.ground(*q),highest_road)-.5
                top=ceiling if upper else roof
                panel([(p[0],h,p[1]),(q[0],h,q[1]),(q[0],top,q[1]),(p[0],top,p[1])],
                      (-sign*normal[0],0,-sign*normal[1]))
    print(f'Campus passage: roof clearance {roof-highest_road:.3f} m, opening {ceiling-highest_road:.3f} m, class {"A" if upper else "B"}')
