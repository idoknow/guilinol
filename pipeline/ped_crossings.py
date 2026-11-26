"""Require an OSM crossing and a run of painted zebra bars before connecting banks."""
import math

import shapely
from shapely import LineString, Point, STRtree

from common import ll2xz
from npc_sidewalks import sidewalk_faces, tile_polygons
from streets import SHIZIJIE_NO_CROSSWALK_ZONE


def crossing_evidence(elements):
    for item in elements:
        tags = item.get('tags', {})
        if tags.get('highway') != 'crossing' and tags.get('footway') != 'crossing':
            continue
        if item['type'] == 'node':
            yield item['id'], 'node', Point(ll2xz(item['lat'],item['lon']))
        elif item['type'] == 'way' and len(item.get('geometry', [])) >= 2:
            yield item['id'], 'way', LineString([ll2xz(point['lat'],point['lon']) for point in item['geometry']])


def painted_bars(world, manifest):
    for shapes in tile_polygons(world, manifest, (2,)):
        for _, shape in shapes:
            box = shape.minimum_rotated_rectangle
            if box.geom_type != 'Polygon' or shape.area < .97 * box.area:
                continue
            corners = list(box.exterior.coords)
            axes = sorted([(math.dist(first, second),first,second) for first,second in zip(corners,corners[1:])])
            if not (.43 <= axes[0][0] <= .75 and 3.7 <= axes[-1][0] <= 3.9):
                continue
            length, first, second = axes[0]
            yield shape,((second[0]-first[0])/length,(second[1]-first[1])/length)


def crossings(world, manifest, elements, diagnostics=None):
    from collections import Counter
    counts = diagnostics if diagnostics is not None else Counter()
    bars=list(painted_bars(world,manifest))
    tree=STRtree([shape.centroid for shape,_ in bars])
    walk=STRtree(list(sidewalk_faces(world,manifest)))
    used=set()
    counts['bars'] = len(bars)
    for osm_id,kind,source in crossing_evidence(elements):
        for index in tree.query(source,predicate='dwithin',distance=2):
            if index in used:
                continue
            origin=tree.geometries[index];axis=bars[index][1]
            stations=[]
            for candidate in tree.query(origin,predicate='dwithin',distance=50):
                centre=tree.geometries[candidate];other=bars[candidate][1]
                delta=(centre.x-origin.x,centre.y-origin.y)
                if abs(axis[0]*other[0]+axis[1]*other[1])<.999 or abs(delta[0]*axis[1]-delta[1]*axis[0])>.14:
                    continue
                stations.append((delta[0]*axis[0]+delta[1]*axis[1],candidate))
            runs=[[]]
            for along,candidate in sorted(stations):
                if runs[-1] and along-runs[-1][-1][0]>1.35:runs.append([])
                runs[-1].append((along,candidate))
            run=next(group for group in runs if any(candidate==index for _,candidate in group))
            if len(run)<3:continue
            counts['runs'] += 1
            outline=shapely.union_all([bars[candidate][0] for _,candidate in run]).convex_hull
            if not source.intersects(outline) or outline.intersects(SHIZIJIE_NO_CROSSWALK_ZONE):continue
            counts['matched'] += 1
            ends=[]
            for side,along in ((-1,run[0][0]),(1,run[-1][0])):
                def at(dist):return (origin.x+axis[0]*dist,origin.y+axis[1]*dist)
                reach=15 if kind=='way' else 2
                ray=LineString([at(along),at(along+side*reach)])
                pieces=shapely.intersection(walk.geometries.take(walk.query(ray)),ray)
                landings=[part for part in shapely.get_parts(pieces) if part.length>=.5]
                if not landings:break
                landing=min(landings,key=lambda part:part.distance(Point(at(along))))
                foot=landing.interpolate(.5,normalized=True)
                approach=LineString([at(along),foot])
                if reach>2 and approach.length>2 and not source.buffer(.5).covers(approach):break
                ends.append(foot.coords[0])
            if len(ends)==2:
                used.update(candidate for _,candidate in run)
                width=min(shape.length for shape in [bars[candidate][0].intersection(LineString([
                    (tree.geometries[candidate].x-axis[1]*4,tree.geometries[candidate].y+axis[0]*4),
                    (tree.geometries[candidate].x+axis[1]*4,tree.geometries[candidate].y-axis[0]*4)])) for _,candidate in run])
                yield dict(osm=[kind,osm_id],bars=len(run),ends=ends,width=round(width,3))


def connect_crossings(world, manifest, graph, evidence):
    walks=[(lane,index,LineString([coords[:2],coords[2:]])) for lane in graph['lanes']
           for index,coords in enumerate(lane.get('npcWalks',[]))]
    tracks=STRtree([line for _,_,line in walks])
    banks=STRtree(list(sidewalk_faces(world,manifest)))
    splits={}
    connected=[]
    for row in evidence:
        ends=[Point(coords) for coords in row['ends']]
        attachments=[]
        for foot in ends:
            for pick in sorted(tracks.query(foot,predicate='dwithin',distance=10),key=lambda idx:tracks.geometries[idx].distance(foot)):
                lane,index,line=walks[pick]
                dist=line.project(foot)
                if dist<2:dist=0
                elif line.length-dist<2:dist=line.length
                point=line.interpolate(dist)
                swept=LineString([point,foot]).buffer(.25)
                safe=shapely.union_all(banks.geometries.take(banks.query(swept)))
                if safe.covers(swept):
                    attachments.append((lane,index,line,dist,point)); break
        if len(attachments)!=2 or attachments[0][2].equals(attachments[1][2]):continue
        points=[attachments[0][-1],*ends,attachments[1][-1]]
        if LineString(points).intersects(SHIZIJIE_NO_CROSSWALK_ZONE):continue
        for lane,index,line,dist,point in attachments:
            splits.setdefault((lane['id'],index),set()).add(dist)
        link={**row,'points':[[round(point.x,4),round(point.y,4)] for point in points]}
        attachments[0][0].setdefault('pedCrossings',[]).append(link)
        connected.append(link)
    for lane in graph['lanes']:
        updated=[]
        for index,coords in enumerate(lane.get('npcWalks',[])):
            cuts=splits.get((lane['id'],index))
            if not cuts:updated.append(coords);continue
            line=LineString([coords[:2],coords[2:]])
            marks=sorted(cuts|{0,line.length})
            for start,end in zip(marks,marks[1:]):
                updated.append([round(value,4) for dist in [start,end] for value in line.interpolate(dist).coords[0]])
        if updated:lane['npcWalks']=updated
    return connected
