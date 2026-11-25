"""One interpolated driving surface shared by the incident station-road arms."""
from collections import defaultdict

import numpy as np
from shapely import LineString, MultiPoint, constrained_delaunay_triangles, union_all
from shapely.ops import split, triangulate


def build(sections, protected):
    ends = defaultdict(list)
    for road in sections:
        for end, node in enumerate(road['nodes']):
            ends[node].append((road, end))
    for arms in ends.values():
        if len(arms) < 2:
            continue
        boundary = []
        controls = {}
        x, y, z = arms[0][0]['portals'][arms[0][1]]
        center = np.array([x, z])
        controls[x, z] = y
        for road, end in arms:
            p, q = np.array(road['portals'])[::1 if end == 0 else -1]
            length = road['length']
            direction = (q[[0,2]]-p[[0,2]])/length
            side = road['halfWidth']*np.array([-direction[1], direction[0]])
            run = min(2.,length/3)
            stations, levels = np.array(road['stations']).T
            for along in (0.,run):
                pos = center+along*direction
                level = np.interp(length-along if end else along, stations, levels)
                for offset in (-1,0,1):
                    point = tuple(pos+offset*side)
                    controls[point] = level
                    boundary.append(point)
        hull = MultiPoint(boundary).convex_hull
        if hull.area < .01:
            continue
        ring = list(hull.exterior.coords)[:-1]
        # Keep the junction inside its road strips and their turning wedge.
        original = [LineString([(px,pz) for px,_,pz in road['portals']]).buffer(
                    road['halfWidth'],cap_style='flat') for road,_ in arms]
        pivots = [road['joints'][end]['ring'] for road,end in arms
                  if road.get('joints') and road['joints'][end]]
        if pivots:
            original.append(MultiPoint(pivots[0]).convex_hull)
        footprint = hull.intersection(union_all(original))
        if any(road['openCut'] for road,_ in arms):
            fixed = protected.query(footprint,predicate='intersects')
            if len(fixed):
                footprint=footprint.difference(union_all(protected.geometries[fixed]))
        # A transverse arm can extend the hull beyond the nominal landing.
        # Anchor each centreline all the way to its actual cut through the
        # hull, including the two-metre samples used by the road mesh.
        axes = []
        for road,end in arms:
            p,q=np.array(road['portals'])[::1 if end==0 else -1]
            axis=(q[[0,2]]-p[[0,2]])/road['length']
            ray=LineString([center,q[[0,2]]])
            reach=ray.intersection(hull).length
            if reach > 1.e-6:
                axes.append((axis, reach, road, end, LineString([center, center+axis*(reach+.001)])))
            distances,levels=np.array(road['stations']).T
            along=road['length']-distances if end else distances
            steps=np.unique(np.r_[along[(along>=0)&(along<reach)],np.linspace(0,reach,max(2,int(np.ceil(reach))+1))])
            for at in steps:
                pos=tuple(center+at*axis)
                controls[pos]=np.interp(road['length']-at if end else at,distances,levels)
        faces=[]
        for tri in triangulate(MultiPoint(list(controls))):
            xy=np.array(tri.exterior.coords)[:3]
            if tri.area<1.e-8:
                continue
            coeff=np.linalg.solve(np.column_stack((xy-center,np.ones(3))),
                                  [controls[tuple(p)] for p in xy])
            # Keep each approach centreline as a triangle edge. An unconstrained
            # Delaunay diagonal can cross it between adjacent profile samples.
            pieces = [tri]
            for _,_,_,_,line in axes:
                pieces = [part for piece in pieces for part in
                          (split(piece,line).geoms if piece.crosses(line) else [piece])]
            for piece in pieces:
                for part in constrained_delaunay_triangles(piece.intersection(footprint)).geoms:
                    if part.area < 1.e-9:
                        continue
                    vertices = []
                    for px,pz in list(part.exterior.coords)[:3]:
                        delta = np.array([px-x,pz-z])
                        height = float(np.dot([*delta,1.],coeff))
                        for axis,reach,road,end,_ in axes:
                            at = np.dot(delta,axis)
                            if at < -1.e-7 or at > reach+1.e-7 or abs(delta[0]*axis[1]-delta[1]*axis[0]) > 1.e-7:
                                continue
                            along,levels = np.array(road['stations']).T
                            height = np.interp(road['length']-at if end else at,along,levels)
                            break
                        vertices.append([px,height,pz])
                    faces.append(vertices)
        for i,(road,end) in enumerate(arms):
            joint = road.setdefault('joints',[None,None])[end] or {}
            joint.update(ring=ring,faces=faces,draw=i==0)
            road['joints'][end]=joint
