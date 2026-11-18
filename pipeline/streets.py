import math
from collections import defaultdict

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from common import CHUNK, load_osm
from features import points, polygons
from scatter import CONFIG, walk_line


def chunks(roads,banks,bounds,water,sample):
    surfaces, sidewalks, stripes = [],[],[]
    fixtures = defaultdict(lambda: [[],[]])
    lengths = dict(road=0,bank=0)
    def store(which,pt,item):
        if bounds.contains(pt):
            origin = tuple(math.floor(v/CHUNK)*CHUNK for v in pt.coords[0])
            fixtures[origin][which].append(item(origin))

    for line,width,kind,_ in roads:
        if not line.intersects(bounds):
            continue
        lengths['road']+=line.intersection(bounds).length
        surfaces.append(line.buffer(width/2,quad_segs=2))
        sidewalks.append(line.buffer(width/2+(3 if width>=10 else 2),quad_segs=2))
        if kind in CONFIG['mainStreets']:
            stripes.append(line.buffer(.09,quad_segs=1))
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
    layers=[STRtree(values) for values in (surfaces,sidewalks,stripes)]
    def encode(tile,origin):
        shapes = [unary_union([layer.geometries[idx].intersection(tile) for idx in sorted(layer.query(tile))]) for layer in layers]
        shapes[1]=shapes[1].difference(shapes[0])
        items=[]
        for kind,shape in enumerate(shapes):
            for poly in polygons(shape):
                if poly.area<.005:
                    continue
                items.append([kind,*[np.rint((np.asarray(r.coords)[:-1]-origin)*100).astype(int).tolist() for r in [poly.exterior,*poly.interiors]]])
        return [items,*fixtures[origin]]
    return encode,lengths
