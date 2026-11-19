"""Generate the market envelope and shop signs from the registered layout."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Polygon
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
    polygon = Polygon(corners)
    height = attributes['eave_m']
    model.pose = (0, 0, 0, 0)
    floor = 3.25 if attributes['canopy'] else 0
    volume = trimesh.creation.extrude_polygon(polygon, height-floor, engine='earcut')
    vertices = volume.vertices[:, [0, 2, 1]].copy()
    vertices[:, 1] += floor
    model.mesh(vertices, volume.faces[:, ::-1], 'tile' if floor else 'brick', not floor)
    for start, end in zip(corners, np.roll(corners, -1, axis=0)):
        delta = end-start
        length = np.linalg.norm(delta)
        center = (start+end)/2
        angle = math.atan2(delta[1],delta[0])
        model.pose = (center[0], 0, center[1], angle)
        if floor:
            model.box(-length/2+.2,0,0,.24,floor,.24,'wood',True)
            continue
        model.box(0,height,0,length+.18,.28,.66,'tile')
        for level in range(attributes['levels']):
            model.box(0,level*3.45+2.98,0,length,.22,.65,'wood')
            count = max(1,round(length/3.4))
            for slot in range(count):
                east = ((slot+.5)/count-.5)*length
                model.box(east,level*3.45+.42,.04,length/count*.75,1.9,.17,'glass')
                if model.detail:
                    model.box(east,level*3.45+.42,.14,.095,1.9,.14,'wood')
        if attributes['screen'] and delta[0]>10:
            model.box(0,5.8,.35,12.8,4.05,.55,'sign')
            model.box(0,6.1,.65,12.2,3.5,.12,'glass')
    if not floor:
        rectangle = np.array(polygon.minimum_rotated_rectangle.exterior.coords)[:-1]
        first,second = rectangle[1]-rectangle[0],rectangle[2]-rectangle[1]
        if np.linalg.norm(first)<np.linalg.norm(second):first,second=second,first
        center = polygon.centroid
        model.pose = (center.x,0,center.y,math.atan2(first[1],first[0]))
        model.swept_roof(0,height,0,np.linalg.norm(first),np.linalg.norm(second),1.55)


def registered_market(model):
    boundary = Polygon([point(coords) for coords in MARKET['replace']['polygon']])
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
            base = 2.4 + (attrs['floor']-1)*3.45
            shade = attrs['sign_background']
            model.box(0,base,.32,width,.75,.18,shade)
            letters(model,title,(0,base+.11,.43),width*.93,.5,'sign' if shade in ('white','gold') else 'white')
