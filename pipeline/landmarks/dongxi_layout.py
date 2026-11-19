"""Generate the market envelope and shop signs from the registered layout."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Polygon, Point
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shop_lettering import letters

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import ll2xz

LAYOUT = json.loads((ROOT / 'docs/layout/dongxi-layout.geojson').read_text())['features']
MARKET = next(entry for entry in json.loads((ROOT / 'pipeline/landmarks.json').read_text())
              if entry['id'] == 'wangcheng_market')
ORIGIN = np.array(ll2xz(*reversed(MARKET['anchor'])))


def point(coords):
    return np.array(ll2xz(*reversed(coords))) - ORIGIN


def envelope(model, feature):
    attributes = feature['properties']
    corners = np.array([point(coords) for coords in feature['geometry']['coordinates'][0][:-1]])
    polygon = orient(Polygon(corners),sign=-1)
    corners = np.asarray(polygon.exterior.coords)[:-1]
    height = attributes['eave_m']
    offset = attributes['ground_m']-157.7
    model.pose = (0, offset, 0, 0)
    volume = trimesh.creation.extrude_polygon(polygon, height, engine='earcut')
    vertices = volume.vertices[:, [0, 2, 1]].copy()
    model.mesh(vertices, volume.faces[:, ::-1], 'brick', True)
    for start, end in zip(corners, np.roll(corners, -1, axis=0)):
        delta = end-start
        length = np.linalg.norm(delta)
        center = (start+end)/2
        angle = math.atan2(delta[1],delta[0])
        model.pose = (center[0], offset, center[1], angle)
        model.box(0,height,0,length+.18,.28,.66,'tile')
        model.box(0,3.05,.32,length,.25,1.35,'wood')
        for level in range(attributes['levels']):
            model.box(0,level*3.45+2.98,0,length,.22,.65,'wood')
            count = max(1,round(length/3.4))
            for slot in range(count):
                east = ((slot+.5)/count-.5)*length
                model.box(east,level*3.45+.42,.04,length/count*.75,1.9,.17,'glass')
                if model.detail:
                    model.box(east,level*3.45+.42,.14,.095,1.9,.14,'wood')
                    if level==0 and length/count>1.6:
                        model.box(east-length/count*.46,0,.65,.19,3.05,.19,'wood')
                        model.box(east-length/count*.33,2.65,.76,.27,.37,.27,'red')
        if attributes['screen'] and delta[0]>10:
            model.box(0,5.8,.35,12.8,4.05,.55,'sign')
            model.box(0,6.1,.65,12.2,3.5,.12,'glass')
    if polygon.area>0:
        rectangle = np.array(polygon.minimum_rotated_rectangle.exterior.coords)[:-1]
        short_side=min(np.linalg.norm(rectangle[1]-rectangle[0]),np.linalg.norm(rectangle[2]-rectangle[1]))
        model.pose = (0,offset,0,0)
        ridge=polygon.buffer(-min(2.5,short_side*.22),join_style='mitre')
        for part in getattr(ridge,'geoms',[ridge]):
            if part.is_empty or part.area<.1:continue
            top,top_faces=trimesh.creation.triangulate_polygon(part,engine='earcut')
            model.mesh(np.column_stack((top[:,0],np.full(len(top),height+1.55),top[:,1])),top_faces[:,::-1],'tile')
        slope=polygon.difference(ridge)
        for part in getattr(slope,'geoms',[slope]):
            if part.geom_type!='Polygon':continue
            top,top_faces=trimesh.creation.triangulate_polygon(part,engine='earcut')
            rise=[0 if polygon.boundary.distance(Point(vertex))<.01 else 1.55 for vertex in top]
            model.mesh(np.column_stack((top[:,0],height+np.asarray(rise),top[:,1])),top_faces[:,::-1],'tile')


def registered_market(model):
    boundary = Polygon([point(coords) for coords in MARKET['replace']['polygon']])
    lanes = [(feature,LineString([point(coords) for coords in feature['geometry']['coordinates']])) for feature in LAYOUT if feature['properties']['kind']=='lane']
    occupied = unary_union([Polygon([point(coords) for coords in feature['geometry']['coordinates'][0]]) for feature in LAYOUT if feature['properties']['kind'] in ('roof','mall')])
    clear = unary_union([lane.buffer(feature['properties']['width_m']/2+.8) for feature,lane in lanes])
    from common import xz2ll
    for feature,lane in lanes:
        if feature['properties']['name']!='未命名连通道':continue
        for side in (-1,1):
            strip=lane.buffer(side*8,single_sided=True).intersection(boundary).difference(clear).difference(occupied.buffer(.4))
            for part in getattr(strip,'geoms',[strip]):
                if part.geom_type!='Polygon' or part.area<42 or part.minimum_rotated_rectangle.area>part.area*1.8:continue
                if part.centroid.x<8 or part.centroid.y < -12:continue
                outline=[list(reversed(xz2ll(*(np.asarray(vertex)+ORIGIN)))) for vertex in part.exterior.coords]
                envelope(model,{'properties':{'ground_m':157.7,'eave_m':6.9,'levels':2,'screen':False},'geometry':{'coordinates':[outline]}})
                occupied=occupied.union(part)
    for feature in LAYOUT:
        attrs = feature['properties']
        if attrs['kind']=='roof' and attrs['render']:
            envelope(model, feature)
        elif attrs['kind']=='lane':
            line = LineString([point(coords) for coords in feature['geometry']['coordinates']])
            pavement = line.buffer(attrs['width_m']/2,cap_style='flat').intersection(boundary)
            for part in getattr(pavement,'geoms',[pavement]):
                if part.geom_type!='Polygon' or part.area<.1:continue
                vertices,faces = trimesh.creation.triangulate_polygon(part,engine='earcut')
                model.pose=(0,0,0,0)
                model.mesh(np.column_stack((vertices[:,0],np.full(len(vertices),.12),vertices[:,1])),faces[:,::-1],'pave')
        elif attrs['kind']=='storefront':
            east,south = point(feature['geometry']['coordinates'])
            normal = math.radians(attrs['bearing'])
            model.pose = (east,0,south,normal-math.pi)
            title = 'STARBUCKS COFFEE' if attrs['name']=='星巴克' else attrs['name']
            width = 8.6 if attrs['name']=='星巴克' else min(5.5,max(2.6,len(title)*.72))
            base = attrs['ground_m']-157.7+2.4 + (attrs['floor']-1)*3.45
            shade = attrs['sign_background']
            width=min(width,attrs['wall_width_m'])
            model.box(0,base,.18,width,.75,.12,shade)
            letters(model,title,(0,base+.11,.25),width*.93,.5,'sign' if shade in ('white','gold') else 'white')
