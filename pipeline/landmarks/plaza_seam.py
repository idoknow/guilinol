"""Drape the civic plaza over terrain; leave native street surfaces to the street pass."""
import math
import sys
from pathlib import Path

import numpy as np
import shapely

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from features import polygons
from seam_streets import Streets


def walkway_rect(pose, width, depth):
    east, _, south, angle = pose
    rect = shapely.box(-width/2, -depth/2, width/2, depth/2)
    return shapely.affinity.translate(shapely.affinity.rotate(rect,angle,origin=(0,0),use_radians=True),east,south)


def drape_walkways(model, rectangles, glass=None):
    pose, grade = model.pose, model.grade
    model.pose, model.grade = (0,0,0,0), None
    try:
        for part in polygons(shapely.union_all(rectangles)):
            civic_plaza(model, part, dressed=True, glass=glass)
    finally:
        model.pose, model.grade = pose, grade


def civic_plaza(builder, ring, frontage=None, refine_outer=False, dressed=False, glass=None, holes=None):
    surface = builder.surface
    rotation = np.array([[surface.cos,-surface.sin],[surface.sin,surface.cos]])
    streets = Streets(surface.surface)
    origin = np.array([surface.x,surface.z])
    plaza = shapely.transform(shapely.Polygon(ring),lambda coords:coords@rotation+origin)
    if frontage is not None:
        original = plaza
        plaza = plaza.union(frontage)
    west,north,east,south = plaza.bounds
    masks = []
    size = surface.surface.size
    for col in range(math.floor(west/size),math.floor(east/size)+1):
        for row in range(math.floor(north/size),math.floor(south/size)+1):
            tree,_,_ = streets.tile((col*size,row*size))
            masks.extend(tree.geometries[tree.query(plaza,predicate='intersects')])
    streets_mask = shapely.union_all(shapely.make_valid(masks))
    street_boundary = streets_mask.boundary
    if frontage is not None:
        plaza = original.union(frontage.intersection(streets_mask.buffer(4)))
    if dressed and not streets_mask.is_empty:
        # Close narrow terrain slivers between the plaza outline and its street lip.
        closed = plaza.union(streets_mask).buffer(.25).buffer(-.25)
        plaza = plaza.union(closed.intersection(plaza.buffer(.5)).intersection(streets_mask.buffer(.5)))
    footprint = plaza.difference(streets_mask)
    regions = [('pave',footprint)]
    if dressed and not streets_mask.is_empty:
        outer = streets_mask.buffer(.20)
        inner = streets_mask.buffer(.50)
        regions = [('streetLip',footprint.intersection(outer)),
                   ('edgeStone',footprint.intersection(inner).difference(outer)),
                   ('pave',footprint.difference(inner))]
        builder.tile_parts.update({key:[] for key in ('streetLip','edgeStone') if key not in builder.tile_parts})
    if glass is not None:
        glass_world = shapely.transform(glass,lambda coords:coords@rotation+origin)
        regions = [(key,region.difference(glass_world)) for key,region in regions]+[('ruinGlass',footprint.intersection(glass_world))]
    if holes:
        # Open stairwells: cut the deck without moving the plaza edge falloff, so the grade stays flat up to the opening.
        holes_world = shapely.union_all([shapely.make_valid(shapely.transform(
            hole if isinstance(hole,shapely.Geometry) else shapely.Polygon(hole),
            lambda coords:coords@rotation+origin)) for hole in holes])
        if not holes_world.is_empty:
            regions = [(key,region.difference(holes_world)) for key,region in regions]
    adjacent_faces = []
    for col in range(math.floor((west-4)/size),math.floor((east+4)/size)+1):
        for row in range(math.floor((north-4)/size),math.floor((south+4)/size)+1):
            if (col*size,row*size) not in surface.surface.files: continue
            tree,kinds,_ = streets.tile((col*size,row*size))
            for index in tree.query(plaza.buffer(4),predicate='intersects'):
                if kinds[index] in (0,1,4,5,6):
                    inset = tree.geometries[index].buffer(-.015)
                    if not inset.is_empty: adjacent_faces.append(inset)
    adjacent = shapely.STRtree(adjacent_faces)
    boundary = footprint.boundary
    vertices=[]; faces={key:[] for key,_ in regions}; levels = {}
    def vertex(x,z):
        key = (round(x,6),round(z,6))
        if key not in levels:
            local = (np.array([x,z])-origin)@rotation.T
            ground = surface.ground(*local)
            distance = boundary.distance(shapely.Point(x,z))
            offset = .018 + .042*min(1,distance/4)
            point = shapely.Point(x,z)
            indices = adjacent.query_nearest(point,max_distance=4,all_matches=False)
            if len(indices):
                line = shapely.shortest_line(point,adjacent.geometries[indices[0]])
                target = line.coords[-1]
                height,kinds = streets.at(*target)
                if kinds:
                    blend = max(0,1-line.length/4)
                    if line.length>.04:
                        blend *= min(1,plaza.boundary.distance(point)/line.length)
                    offset += (height-surface.y-ground-offset)*blend*blend*(3-2*blend)
            levels[key] = len(vertices); vertices.append([local[0],ground+offset,local[1]])
        return levels[key]
    for col in range(math.floor(west/4),math.ceil(east/4)):
        for row in range(math.floor(north/4),math.ceil(south/4)):
            cell = shapely.box(col*4,row*4,(col+1)*4,(row+1)*4)
            for material,part in ((key,part) for key,region in regions for part in polygons(region.intersection(cell))):
                if frontage is not None or (refine_outer and boundary.intersects(part)):
                    def refine(ring):
                        result = []
                        for start,end in zip(ring.coords, list(ring.coords)[1:]):
                            result.append(start)
                            edge = shapely.LineString([start,end])
                            midpoint = edge.interpolate(.5,normalized=True)
                            road_edge = street_boundary is not None and street_boundary.distance(midpoint)<.03
                            outside_edge = boundary.distance(midpoint)<.002
                            if edge.length>.5 and (road_edge or outside_edge):
                                first,last = vertices[vertex(*start)][1],vertices[vertex(*end)][1]
                                if abs(first-last)>.05:
                                    result.extend(edge.interpolate(step*.45).coords[0] for step in range(1,math.ceil(edge.length/.45)))
                        return result
                    part = shapely.Polygon(refine(part.exterior),[refine(hole) for hole in part.interiors])
                for triangle in shapely.constrained_delaunay_triangles(part).geoms:
                    coords = list(shapely.orient_polygons(triangle,exterior_cw=True).exterior.coords)[:3]
                    faces[material].append([vertex(*point) for point in coords])
    for material, triangles in faces.items():
        if triangles: builder.mesh(vertices,triangles,material,collide=True)
