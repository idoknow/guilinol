import math
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.affinity import affine_transform
from shapely.geometry import box
from shapely.ops import unary_union, substring

from road_profile import RULES
from common import CHUNK


def yiwu_frontage(roads):
    road = next((road for road in roads if road.way == 221349755), None)
    if road is None or road.line.length < 140:
        return None
    guide = substring(road.line, 70, 140)
    half = road.width / 2
    walk, tactile = [], []
    for side in (-1, 1):
        outer = [guide.interpolate(station).coords[0] for station in (0, 12, 55, 70)]
        for index, station in enumerate((0, 12, 55, 70)):
            before, after = guide.interpolate(max(0,station-.1)), guide.interpolate(min(70,station+.1))
            angle = math.atan2(after.y-before.y,after.x-before.x)
            width = half + (4 if index in (0,3) else 5)
            east,south = outer[index]
            outer[index] = (east-side*width*math.sin(angle),south+side*width*math.cos(angle))
        boundary = LineString(outer)
        curb = guide.offset_curve(side*half)
        from shapely.geometry import Polygon
        walk.append(Polygon([*curb.coords,*reversed(boundary.coords)]).buffer(0))
        tactile.append(guide.offset_curve(side*(half+2.5)).buffer(.175,cap_style='flat'))
        if side == -1:
            fence = boundary
    return unary_union(walk), unary_union(tactile), fence, guide.offset_curve(-(half+.32))


def section_layers(roads):
    layers = [[] for _ in range(4)]
    for road in roads:
        name = road.section
        if not name:
            continue
        section = road.dimensions
        for side, available in ((-1, road.left), (1, road.right)):
            if not available:
                continue
            def band(inner, width):
                start = road.width / 2 + inner
                def shell(distance):
                    return road.side_line(side).buffer(side * distance, single_sided=True, quad_segs=2)
                return shell(start + width).difference(shell(start))

            verge, cycle, curb, walk = (section[key] for key in ('verge','cycle','curb','walk'))
            if verge:
                layers[1].append(band(0, verge))
            if cycle:
                layers[2].append(band(verge, cycle))
            layers[0].append(band(verge + cycle, curb + walk))
            layers[3].append(band(verge + cycle + curb + walk * .52, RULES['tactileWidth']))
    return [STRtree(layer) for layer in layers]


def clipped(tree, tile):
    return unary_union([tree.geometries[index].intersection(tile) for index in sorted(tree.query(tile))])


def speed_paint(road, limit, spacing):
    if not limit.isdecimal() or len(limit)>2 or not road.lanes:
        return
    segments = [(-.24,.88,.24,1),(.18,.04,.29,.87),(.18,-.87,.29,-.04),(-.24,-1,.24,-.88),(-.29,-.87,-.18,-.04),(-.29,.04,-.18,.87),(-.24,-.06,.24,.06)]
    digits = ['012345','12','01643','01623','5612','05623','056432','012','0123456','012356']
    for distance in range(spacing//2,int(road.line.length)-4,spacing):
        center = road.line.interpolate(distance)
        after = road.line.interpolate(distance+.5)
        heading = math.atan2(after.y-center.y,after.x-center.x)
        east, south = math.cos(heading), math.sin(heading)
        for side in ([1] if road.oneway else [1,-1]):
            offset = -side*road.width*(.5-.5/road.lanes)
            for index,digit in enumerate(limit):
                lateral = offset + side*.76*(index-(len(limit)-1)/2)
                transform = [-side*south, side*east, side*east,side*south,center.x-lateral*south,center.y+lateral*east]
                for segment in digits[int(digit)]:
                    yield affine_transform(box(*segments[int(segment)]),transform)


def shopfronts(footprints, heights, roads):
    streets = [road for road in roads if road.kind in RULES['sectionClasses']]
    index = STRtree([road.line for road in streets])
    result = defaultdict(list)
    if not streets:
        return result
    for footprint, (base, roof, kind, floors, seed, *_) in zip(footprints, heights):
        if kind or roof-base < 3:
            continue
        coords = list(footprint.exterior.coords)
        for first, second in zip(coords, coords[1:]):
            edge = LineString([first,second])
            bays = int(edge.length / RULES['shops']['bay'])
            if not bays:
                continue
            midpoint = edge.interpolate(.5, normalized=True)
            road = streets[index.nearest(midpoint)]
            near = road.line.interpolate(road.line.project(midpoint))
            distance = near.distance(midpoint)
            if not road.width/2 < distance < road.width/2 + RULES['shops']['setback']:
                continue
            normal = ((near.x-midpoint.x)/distance, (near.y-midpoint.y)/distance)
            tangent = ((second[0]-first[0])/edge.length,(second[1]-first[1])/edge.length)
            if abs(sum(a*b for a,b in zip(normal,tangent))) > .35 or footprint.covers(Point(midpoint.x+normal[0]*.2, midpoint.y+normal[1]*.2)):
                continue
            for bay in range(bays):
                center = edge.interpolate((bay+.5)/bays, normalized=True)
                origin = tuple(math.floor(value/CHUNK)*CHUNK for value in center.coords[0])
                result[origin].append([round((center.x-origin[0])*10),round((center.y-origin[1])*10),round(base*10),round(math.atan2(normal[1],normal[0])*100),round(edge.length/bays*10),int(seed+bay)%4,int(road.kind in ('trunk','primary'))])
    return result
