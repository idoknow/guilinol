import math
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from road_profile import RULES
from common import CHUNK


def section_layers(roads):
    layers = [[] for _ in range(4)]
    for road in roads:
        name = RULES['sectionClasses'].get(road.kind)
        if not name:
            continue
        section = RULES['sections'][name]
        for side, available in ((-1, road.left), (1, road.right)):
            if not available:
                continue
            def band(inner, width):
                start = road.width / 2 + inner
                def shell(distance):
                    return road.line.buffer(side * distance, single_sided=True, quad_segs=2)
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
