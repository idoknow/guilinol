import re

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

from common import load_osm
from features import points, polygons


def bridge_tiles(bounds, sample):
    spans, profiles, owners, emitted = [], [], [], []
    for way in load_osm():
        tags = way.get('tags', {})
        if way['type'] != 'way' or tags.get('bridge', 'no') == 'no' or 'highway' not in tags:
            continue
        coords = points(way)
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if not bounds.intersects(line) or not line.length:
            continue
        match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', ''))
        width = float(match[1]) if match else {'footway':3,'path':3,'steps':3,'cycleway':3,
                'primary':14,'secondary':12,'trunk':18}.get(tags['highway'],10)
        ends = []
        for end, sign in [(0,1),(line.length,-1)]:
            point = line.interpolate(end)
            direction = np.array(point.coords[0])-line.interpolate(end+sign*min(1,line.length)).coords[0]
            for distance in range(0,65,2):
                height, water = sample(*(point.coords[0]+direction*distance))
                if water == -32768:
                    break
            ends.append(height)
        coords = list(line.segmentize(4).coords)
        sections = []
        for index, coord in enumerate(coords):
            tangent = np.subtract(coords[min(index+1,len(coords)-1)],coords[max(index-1,0)])
            length = np.linalg.norm(tangent)
            if not length:
                continue
            side = np.array([-tangent[1],tangent[0]])*(width/2/length)
            frac = line.project(Point(coord))/line.length
            height = ends[0]*(1-frac)+ends[1]*frac
            for test in [coord,coord+side,coord-side]:
                _, water = sample(*test)
                if water != -32768:
                    height = max(height,water/10+2)
            if way['id']==246520676:
                height=156.48
                side*=6.8/width
            sections.append((coord+side,coord-side,height))
        for first, second in zip(sections,sections[1:]):
            for pts, levels in [([first[0],first[1],second[0]],[first[2],first[2],second[2]]),
                                ([second[1],second[0],first[1]],[second[2],second[2],first[2]])]:
                poly = Polygon(pts)
                if poly.area < .001:
                    continue
                spans.append(poly)
                owners.append(way['id'])
                profiles.append(np.linalg.solve(np.column_stack((pts,np.ones(3))),levels))
    tree = STRtree(spans)

    def encode(tile, origin):
        triangles = []
        for index in sorted(tree.query(tile)):
            for poly in polygons(spans[index].intersection(tile)):
                ring = list(orient(poly,sign=-1).exterior.coords)[:-1]
                for at in range(1,len(ring)-1):
                    for east,south in (ring[0],ring[at],ring[at+1]):
                        height = profiles[index] @ [east,south,1]
                        triangles.append([round((east-origin[0])*100),round(height*10),round((south-origin[1])*100)])
                    emitted.append((owners[index],np.array(triangles[-3:])/[100,10,100]+[origin[0],0,origin[1]]))
        return np.asarray(triangles,dtype='<i2').tobytes()
    return encode, emitted
