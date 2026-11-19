import json
import re
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

from common import load_osm
from features import points, polygons


def bridge_tiles(bounds, sample, routes, raised=(), west_portal=None):
    spans, profiles, owners, emitted = [], [], [], []
    thin_spans=[]
    tracks=[(LineString([(east,south) for east,level,south in leg['path']]).buffer(4.2),leg['path']) for leg in routes if leg['kind']=='boat']
    # Landmark GLBs already contain these spans. A second procedural deck would z-fight.
    replaced = set()
    for entry in json.loads((Path(__file__).resolve().parent/'landmarks.json').read_text()):
        replace = entry.get('replace', [])
        if isinstance(replace, list):
            replaced.update(key for key in replace if isinstance(key, str))
    for way in load_osm():
        tags = way.get('tags', {})
        if way['type'] != 'way' or tags.get('bridge', 'no') == 'no' or 'highway' not in tags:
            continue
        if f"way/{way['id']}" in replaced:
            continue
        coords = points(way)
        if len(coords) < 2:
            continue
        if way['id'] in raised: coords=raised[way['id']][0]
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
        zone=line.buffer(width/2)
        crossings=[track.intersection(zone) for track,path in tracks if track.intersects(zone)]
        targets=[(line.project(Point(east,south)),level+3.0) for track,path in tracks if track.intersects(zone)
                 for east,level,south in path if line.distance(Point(east,south))<=width/2+6]
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
            if targets and abs(ends[1]-ends[0])<=.055*line.length:
                station=frac*line.length
                ceiling=min(ends[0]+station*.045,ends[1]+(line.length-station)*.045)
                target=max(level-.045*max(0,abs(station-crossing)-5) for crossing,level in targets)
                height=max(height,min(ceiling,target))
            if way['id']==246520676:
                height=156.48
                side*=6.8/width
            if way['id'] in raised:
                height=raised[way['id']][1][index]/10
            sections.append((coord+side,coord-side,height))
        for first, second in zip(sections,sections[1:]):
            for pts, levels in [([first[0],first[1],second[0]],[first[2],first[2],second[2]]),
                                ([second[1],second[0],first[1]],[second[2],second[2],first[2]])]:
                poly = Polygon(pts)
                if poly.area < .001:
                    continue
                # The landmark supplies the deck, vaulted underside and collision here.
                if (west_portal is not None and way['id'] in (49322149,258899702,1531308751,1531308752)
                        and west_portal.covers(poly)):
                    continue
                spans.append(poly)
                thin_spans.append(any(poly.intersects(part) for part in crossings))
                owners.append(way['id'])
                profiles.append(np.linalg.solve(np.column_stack((pts,np.ones(3))),levels))
    tree = STRtree(spans)

    def encode(tile, origin):
        triangles = []
        thin=[]
        asphalt=[]
        for index in sorted(tree.query(tile)):
            for poly in polygons(spans[index].intersection(tile)):
                ring = list(orient(poly,sign=-1).exterior.coords)[:-1]
                for at in range(1,len(ring)-1):
                    if thin_spans[index]: thin.append(len(triangles)//3)
                    if owners[index] in (121981963,1023638023,259011247,259011248):
                        asphalt.append(len(triangles)//3)
                    for east,south in (ring[0],ring[at],ring[at+1]):
                        height = profiles[index] @ [east,south,1]
                        triangles.append([round((east-origin[0])*100),round(height*10),round((south-origin[1])*100)])
                    emitted.append((owners[index],np.array(triangles[-3:])/[100,10,100]+[origin[0],0,origin[1]],.6 if thin_spans[index] else 1.2))
        return np.asarray(triangles,dtype='<i2').tobytes(),thin,asphalt
    return encode, emitted
