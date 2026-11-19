import gzip
import json
import math
from pathlib import Path

from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from common import ll2xz, load_osm
from features import area, points, polygons
from scatter import CONFIG


CLASSES = {kind: rank for rank, kinds in enumerate((
    'motorway trunk primary', 'secondary tertiary',
    'residential unclassified living_street service track', 'pedestrian footway steps path cycleway'
)) for kind in kinds.split()}
ALIASES = {'象鼻山': ['象山', '水月洞'], '日塔': ['日月双塔'], '月塔': ['日月双塔'],
           '靖江王城': ['王城', '靖江王府', '独秀峰'], '叠彩山公园': ['叠彩山', '明月峰'],
           '伏波山公园': ['伏波山', '还珠洞'], '正阳门': ['王城正门'], '依仁路步行街': ['正阳路步行街'],
           '正阳路': ['正阳路步行街'], '榕杉湖景区': ['两江四湖', '榕湖', '杉湖'],
           '桂林市中山中学漓滨校区': ['桂林市第九中学', '桂林九中', '九中'],
           '桂林医科大学（东城校区）': ['桂林医科大学东城校区', '桂林医科大学', '桂林医学院东城校区', '弘德楼'],
           '桂林理工大学附属小学': ['理工大附小', '理工附小', '桂工附小'],
           '桂林市田家炳中学': ['田家炳中学', '桂林四中', '桂林市第四中学'],
           '桂林市辰山小学': ['辰山小学'],
           '漓江小学': ['桂林市漓江小学', '七星区漓江小学', '桂林市七星区漓江小学'],
           '龙隐小学': ['桂林市龙隐小学', '七星区龙隐小学']}


def flat(curve):
    coords = []
    for east, south in curve.coords:
        pair = [round(east), round(south)]
        if pair != coords[-2:]:
            coords.extend(pair)
    return coords


def rings(poly):
    outer = flat(poly.exterior)
    return [outer, *(hole for ring in poly.interiors if len(hole := flat(ring)) >= 8)] if len(outer) >= 8 else []


def kind_of(tags):
    if 'amenity' in tags or 'shop' in tags or tags.get('tourism') in ('hotel', 'hostel', 'apartment'):
        return None
    if tags.get('natural') == 'peak': return 'peak'
    if tags.get('man_made') == 'bridge': return 'bridge'
    if tags.get('historic') == 'city_gate': return 'gate'
    if tags.get('tourism') == 'museum': return 'museum'
    if tags.get('man_made') == 'tower' or tags.get('tourism') in ('attraction','viewpoint','artwork','zoo','theme_park'): return 'scenic'
    if tags.get('historic'): return 'memorial'
    if tags.get('leisure') in ('park','garden'): return 'park'
    if tags.get('natural') == 'water' or 'water' in tags or tags.get('waterway') == 'riverbank': return 'water'


def write_atlas(output, extent, bounds, layers, footprints, peaks):
    roads, places, longest = [], [], {}
    schools = {item['osm']:item for item in json.loads(Path(__file__).with_name('schools-g2.json').read_text())}
    schools.update({'node/2597936160': {'name':'少年宫（地块待核）'},
                    'node/3170011400': {'name':'回民小学（地块待核）'}})
    catalog = json.loads(Path(__file__).with_name('schools-g1.json').read_text())
    school_names = {item['osm']:item['name'] for item in catalog}
    school_names.update({'way/253811717':'桂林市奎光学校','node/2597936167':'桂林小学（待核）','node/6342889660':'凌风高中（待核）'})
    school_centers, public_streets = {}, []

    def place(name, kind, point):
        record = dict(n=name, k=kind, x=round(point.x), z=round(point.y))
        if name in ALIASES:
            record['a'] = ALIASES[name]
        places.append(record)

    for element in load_osm():
        tags = element.get('tags', {})
        name = tags.get('name', '')
        key = f"{element['type']}/{element['id']}"
        if key in schools:
            shape = (Point(ll2xz(element['lat'],element['lon'])) if element['type']=='node' else area(element)).intersection(bounds)
            if not shape.is_empty: school_centers[key] = shape.centroid
        coords = points(element)
        if key in school_names:
            school_centers[key] = (Point(ll2xz(element['lat'],element['lon'])) if element['type']=='node' else area(element).representative_point())
        highway = tags.get('highway','').removesuffix('_link')
        if highway in CLASSES and len(coords) >= 2:
            clipped = LineString(coords).intersection(bounds)
            for line in getattr(clipped, 'geoms', [clipped]):
                if line.is_empty or line.geom_type != 'LineString': continue
                path = flat(line.simplify(1.5))
                if len(path) < 4: continue
                default = CONFIG['width'].get(highway, (18,10,5,3)[CLASSES[highway]])
                try:
                    width = float(tags.get('width', default))
                except ValueError:
                    width = default
                road = dict(n=name, c=CLASSES[highway], w=width if math.isfinite(width) and width > 0 else default, p=path)
                if tags.get('bridge','no') != 'no': road['b'] = 1
                roads.append(road)
                if name and highway in ('residential','living_street','tertiary','secondary','pedestrian','primary','unclassified') and tags.get('access') not in ('private','no'):
                    public_streets.append((name,line))
                if name and (name not in longest or line.length > longest[name].length): longest[name] = line
        kind = kind_of(tags)
        if not kind or not name: continue
        if element['type'] == 'node':
            geom = Point(ll2xz(element['lat'],element['lon']))
        elif len(coords) >= 2 and coords[0] != coords[-1]:
            geom = LineString(coords)
        else:
            geom = area(element)
        clipped = geom.intersection(bounds)
        if clipped.is_empty: continue
        point = clipped.representative_point()
        if kind == 'peak' and peaks['entries']:
            centers = (Point(entry['center'][0],entry['center'][2]) for entry in peaks['entries'])
            point = min(centers, key=point.distance)
        place(name,kind,point)
    for name,line in longest.items():
        place(name,'road',line.interpolate(.5,normalized=True))
    place('桂林中学解西校区', 'school', Point(-1244, -242))
    for key,center in school_centers.items():
        segments = [line for name,line in public_streets if key != 'way/675588260' or name == '漓滨路']
        if segments:
            place(school_names[key] if key in school_names else schools[key]['name'],'school',nearest_points(center, min(segments,key=center.distance))[1])
    place('桂林医科大学（东城校区）', 'school', Point(678, -1701))
    place('桂林理工大学附属小学', 'school', Point(933, -399))
    place('桂林市田家炳中学', 'school', Point(1032, -965))
    place('桂林市辰山小学', 'school', Point(1110, -2413))
    place('漓江小学', 'school', Point(1111, 102))
    place('龙隐小学', 'school', Point(835, 1106))

    data = dict(extent=extent,roads=roads,places=places)
    for layer in ('water','green'):
        data[layer] = [path for poly in layers[layer] if (path := rings(poly.simplify(1)))]
    buildings = [part for poly in footprints if poly.area >= 40 for part in polygons(poly.intersection(bounds)) if part.area >= 40]
    for min_area, tolerance in ((40,1),(70,1),(100,1),(100,2),(100,3)):
        data['buildings'] = [path for poly in buildings if poly.area >= min_area and len(path := flat(poly.simplify(tolerance).exterior)) >= 8]
        payload = gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
        if len(payload) <= 400_000:
            (output/'atlas.bin').write_bytes(payload)
            return
    raise ValueError('Atlas exceeds 400 KB')
