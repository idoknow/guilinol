import math
from collections import defaultdict

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from common import CHUNK, ll2xz, load_osm
from features import points, polygons
from scatter import CONFIG, walk_line


def chunks(roads,banks,bounds,water,sample,exclude):
    surfaces, sidewalks, stripes, medians, gaps = [],[],[],[],[]
    fixtures = defaultdict(lambda: [[],[],[],[]])
    lengths = dict(road=0,bank=0)
    def store(which,pt,item):
        if bounds.contains(pt) and (which!=0 or not exclude.covers(pt)):
            origin = tuple(math.floor(v/CHUNK)*CHUNK for v in pt.coords[0])
            fixtures[origin][which].append(item(origin))

    junctions = defaultdict(list)
    for road in roads:
        coords = list(road.line.coords)
        for coord in set(coords):
            junctions[coord].extend([road.width] * (1 if coord in (coords[0],coords[-1]) else 2))
    clear = STRtree([Point(coord).buffer(max(widths)/2+1) for coord,widths in junctions.items() if len(widths)>2])
    controls = [(Point(ll2xz(node['lat'],node['lon'])),node['tags']['highway']) for node in load_osm()
                if node['type']=='node' and node.get('tags',{}).get('highway') in ('crossing','traffic_signals','bus_stop','street_lamp')]
    control_index = STRtree([pt for pt,_ in controls])
    for point,feature in controls:
        slot={'street_lamp':0,'traffic_signals':2,'bus_stop':3}.get(feature)
        if slot is not None:
            store(slot,point,lambda origin:[round((v-o)*10) for v,o in zip(point.coords[0],origin)])
    crosswalks = set()
    for road in roads:
        line,width,kind = road.line,road.width,road.kind
        if not line.intersects(bounds):
            continue
        lengths['road']+=line.intersection(bounds).length
        surfaces.append(line.buffer(width/2,quad_segs=2))
        for side,extra in ((-1,road.left),(1,road.right)):
            if extra:
                sidewalks.append(line.buffer(side*(width/2+extra),single_sided=True,quad_segs=2))
        masks = unary_union(clear.geometries.take(clear.query(line.buffer(width/2))))
        for lane in range(1,road.lanes):
            offset = width*(lane/road.lanes-.5)
            stripe = line.offset_curve(offset).buffer(.09,quad_segs=1).difference(masks)
            stripes.append(stripe)
        if road.divided:
            medians.append(line.buffer(.55).difference(masks))
        for index in control_index.query(line,predicate='dwithin',distance=max(2,width/2+3)):
            point,feature = controls[index]
            along = line.project(point)
            if feature=='street_lamp':
                continue
            if feature=='bus_stop':
                if point.distance(line)>1:
                    sidewalks.append(point.buffer(1.5,quad_segs=1))
                continue
            if kind=='pedestrian' or point.distance(line)>2:
                continue
            directions = (-1,1) if feature=='traffic_signals' else (1,)
            for direction in directions:
                offset = (width/2+3) if feature=='traffic_signals' else 0
                dist = along+direction*offset
                if not 0<=dist<=line.length:
                    continue
                mid = np.array(line.interpolate(dist).coords[0])
                key = tuple(np.rint(mid).astype(int))
                if key in crosswalks:
                    continue
                crosswalks.add(key)
                delta = np.subtract(line.interpolate(min(line.length,dist+.25)).coords[0],line.interpolate(max(0,dist-.25)).coords[0])
                tangent = direction*delta/max(.001,np.linalg.norm(delta));normal=np.array([-tangent[1],tangent[0]])
                for span in np.arange(-width/2+.5,width/2-.2,.9):
                    center=mid+normal*span
                    stripes.append(LineString([center-tangent*1.4,center+tangent*1.4]).buffer(.21,cap_style='flat'))
                gaps.append(LineString([mid-normal*(width/2+road.left+1),mid+normal*(width/2+road.right+1)]).buffer(1.55,cap_style='flat'))
                if feature=='traffic_signals':
                    stop=mid+tangent*2.4
                    stripes.append(LineString([stop,stop+normal*width/2]).buffer(.2,cap_style='flat'))
        if kind in CONFIG['mainStreets']:
            for side in [-1,1]:
                for pt in walk_line(line,CONFIG['lampSpacing'],side*(width/2+2.6)):
                    store(0,pt,lambda origin:[round((v-o)*10) for v,o in zip(pt.coords[0],origin)])
    bridge = STRtree([LineString(points(el)).buffer(11) for el in load_osm() if el['type']=='way' and
                      el.get('tags',{}).get('bridge','no')!='no' and len(points(el))>1])
    streets = STRtree(surfaces)
    shore = unary_union(water).boundary
    for poly,name,kind in banks:
        if name not in CONFIG['urbanBanks']:
            continue
        ring = poly.exterior
        for dist in np.arange(0,ring.length,2):
            a,b = ring.interpolate(dist),ring.interpolate(min(dist+2,ring.length))
            mid = ring.interpolate((dist+min(dist+2,ring.length))/2)
            if not bounds.contains(mid) or mid.distance(shore)>.25 or bridge.query(mid,predicate='intersects').size:
                continue
            if kind=='river' and not streets.query(mid,predicate='dwithin',distance=CONFIG['riverRoadProximity']).size:
                continue
            delta=np.subtract(b.coords[0],a.coords[0]); length=np.linalg.norm(delta)
            if length<.1:
                continue
            normal=np.array([-delta[1],delta[0]])/length
            if poly.contains(Point(mid.coords[0]+normal)):
                normal=-normal
            ground,_=sample(*(mid.coords[0]+3*normal));_,water_y=sample(*(mid.coords[0]-3*normal))
            if water_y==-32768:
                continue
            lengths['bank']+=length
            def segment(origin):
                return [*(round((v-o)*10) for pt in (a,b) for v,o in zip(pt.coords[0],origin)),
                        max(round(ground*10)+1,int(water_y)+1),int(water_y)-10]
            store(1,mid,segment)
    layers=[STRtree(values) for values in (surfaces,sidewalks,stripes,medians,gaps)]
    def encode(tile,origin):
        shapes = [unary_union([layer.geometries[idx].intersection(tile) for idx in sorted(layer.query(tile))]) for layer in layers]
        shapes[1]=shapes[1].difference(shapes[0]).union(shapes[3]).difference(shapes[4])
        shapes[2]=shapes[2].difference(shapes[3])
        items=[]
        for kind,shape in enumerate(shapes[:3]):
            for poly in polygons(shape):
                if poly.area<.005:
                    continue
                items.append([kind,*[np.rint((np.asarray(r.coords)[:-1]-origin)*100).astype(int).tolist() for r in [poly.exterior,*poly.interiors]]])
        return [items,*fixtures[origin]]
    return encode,lengths
