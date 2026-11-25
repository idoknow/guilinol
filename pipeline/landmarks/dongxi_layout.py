"""Generate the market envelope and shop signs from the registered layout."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely import STRtree
from shapely.geometry import LineString, Polygon, Point, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shop_lettering import letters
from dongxi_owners import EXTERNAL_ROOFS, EXTERNAL_SIGNS

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import ll2xz, load_osm
from features import points
from road_profile import pair_carriageways, profile

LAYOUT = json.loads((ROOT / 'pipeline/data/layout/dongxi-layout.geojson').read_text())['features']
INFILL = json.loads((ROOT / 'pipeline/data/layout/dongxi-infill.geojson').read_text())['features']
MARKET = next(entry for entry in json.loads((ROOT / 'pipeline/landmarks.json').read_text())
              if entry['id'] == 'wangcheng_market')
ORIGIN = np.array(ll2xz(*reversed(MARKET['anchor'])))

SCREEN_FACE = 'earth'
SCREEN_FRAME = 'yellow'
SCREEN_PALETTE = {SCREEN_FACE: '#9292a2', SCREEN_FRAME: '#c9c9ca'}


def point(coords):
    return np.array(ll2xz(*reversed(coords))) - ORIGIN


def historic_bays(model,length,height,levels):
    bays=max(1,round(length/3.5));pitch=length/bays
    model.box(0,3.28,.35,length,.17,1.05,'tile')
    for level in range(levels):
        sill=level*3.45+.32
        for slot in range(bays):
            center=(slot+.5)*pitch-length/2
            if level == 0:
                model.box(center,0,.06,pitch*.70+.10,sill+.02,.34,'brick')
            model.box(center,sill,.025,pitch*.70,2.03,.21,'wood')
            model.box(center,sill+.64,.12,pitch*.60,1.30,.12,'sign')
            if model.detail:
                for division in (-.2,0,.2):
                    model.box(center+division*pitch,sill+.64,.21,.085,1.30,.06,'wood')
                model.box(center,sill+1.34,.21,pitch*.62,.095,.07,'wood')
                if level==0 and pitch>1.6:
                    model.box(center-pitch*.46,0,.53,.17,3.27,.17,'wood')
                    if slot%2==0:
                        globe=trimesh.creation.icosphere(subdivisions=1)
                        model.mesh(globe.vertices*[.24,.31,.24]+[center-pitch*.35,2.83,.67],globe.faces,'red')
                if level>0:
                    model.box(center,sill-.12,.69,.13,.90,.16,'wood')
        if level>0:
            model.box(0,sill-.18,.33,length,.22,1.05,'wood')
            model.box(0,sill+.7,.70,length,.10,.12,'wood')
    if length>3:
        for side in (-1,1):
            model.beam([side*(length/2-.75),height+.10,.20],[side*length/2,height+.43,.36],.13,'tile')


def envelope(model, feature):
    attributes = feature['properties']
    corners = np.array([point(coords) for coords in feature['geometry']['coordinates'][0][:-1]])
    if attributes['name']=='R2':
        # IMG_1398 and the Esri roof both show a clipped NE corner with a screen.
        ne = int(np.argmax(corners[:,0]))
        corner = corners[ne]
        cuts = [corner+4.5*(v-corner)/np.linalg.norm(v-corner)
                for v in (corners[ne-1],corners[(ne+1)%len(corners)])]
        corners = np.vstack([corners[:ne],cuts,corners[ne+1:]])
    holes=[[point(coords) for coords in ring] for ring in feature['geometry']['coordinates'][1:]]
    polygon = orient(Polygon(corners,holes),sign=-1)
    corners = np.asarray(polygon.exterior.coords)[:-1]
    # Keep at least 0.8 m of the 3.2 m lower facade above the highest sampled footing.
    ring = LineString([point(c) for c in feature['geometry']['coordinates'][0]])
    stations = (ring.interpolate(d) for d in np.arange(0,ring.length,2))
    offset = max(attributes['ground_m']-157.7, max(model.grade(p.x,p.y) for p in stations)-2.4)
    height = attributes['eave_m']
    model.grade_reference=offset
    model.pose = (0, offset, 0, 0)
    if attributes['name'] in ('R10','R10-west'):
        canopy=trimesh.creation.extrude_polygon(polygon,.20,engine='earcut')
        model.mesh(canopy.vertices[:,[0,2,1]]+[0,height,0],canopy.faces[:,::-1],'tile')
        if attributes['name']=='R10':
            frontage=corners+ORIGIN
            recessed=corners.copy()
            recessed[(frontage[:,0]>-674)&(frontage[:,1]>-139.1),1]-=1.85
            polygon=Polygon(recessed,holes)
        for start,end in zip(corners,np.roll(corners,-1,axis=0)):
            edge=end-start
            outward=np.array([-edge[1],edge[0]])/np.linalg.norm(edge)
            if outward[1]>.8 and np.linalg.norm(edge)>8:
                setback=3.2*outward
                polygon=polygon.difference(Polygon([start+outward,end+outward,end-setback,start-setback]))
        polygon=orient(polygon,sign=-1)
        corners=np.asarray(polygon.exterior.coords)[:-1]
    volume = trimesh.creation.extrude_polygon(polygon, height, engine='earcut')
    vertices = volume.vertices[:, [0, 2, 1]].copy()
    name=attributes['name']
    modern=name in ('R67','R2')
    shopfront=name in ('D-west','N011')
    model.mesh(vertices, volume.faces[:, ::-1], 'stone' if name=='N011' else 'white' if modern or name=='R17' else 'brick', True)
    if name=='R2':
        # The ground-floor shopfronts follow the original street wall beneath the screen.
        shop_corner = trimesh.creation.extrude_polygon(Polygon([cuts[0],corner,cuts[1]]),3.45,engine='earcut')
        model.mesh(shop_corner.vertices[:,[0,2,1]],shop_corner.faces[:,::-1],'white',True)
    historic=attributes.get('historic',True)
    for start, end in zip(corners, np.roll(corners, -1, axis=0)):
        delta = end-start
        length = np.linalg.norm(delta)
        if length<1e-6:continue
        center = (start+end)/2
        angle = math.atan2(delta[1],delta[0])
        model.pose = (center[0], offset, center[1], angle)
        outward=np.array([-delta[1],delta[0]])/length
        # The two cut faces bound the 3.4 m service alley in IMG_1391.
        # Its party walls have high windows, exposed pipes and a shop at the mouth.
        alley_bearing = math.radians(41.8)
        if name in ('R10', 'R10-west') and abs(delta @ [math.sin(alley_bearing), -math.cos(alley_bearing)]) > .999 * length:
            model.box(0,height-.2,.08,length,.24,.38,'granite')
            for along in (-length*.29,length*.25):
                model.box(along,5.1,.04,1.2,1.0,.13,'glass')
                model.box(along-.82,-.05,.09,.10,7.2,.12,'granite')
            if name=='R10':
                end_bay=length/2-1.65
                model.box(end_bay,.15,.06,2.8,2.45,.16,'glass')
                model.box(end_bay,2.6,.18,3.15,.55,.35,'gold')
                letters(model,'桂林特产',(end_bay,2.67,.37),2.75,.37,'red')
                for along in (-2.4,1.2):
                    model.beam([along,6.7,.05],[along+.9,6.5,3.4],.038,'sign')
            continue
        if name=='D-west' and outward[0]<-.8:
            model.box(0,height,.03,length,.55,.5,'white')
            for tier in range(3):
                model.box(0,height+.5+tier*.55,.03,length*(.82-tier*.22),.6,.55,'white')
            model.box(0,3.55,.24,min(7.5,length-.4),3.06,.45,'sign')
            model.box(0,3.73,.49,min(7.1,length-.8),2.7,.09,'red')
            letters(model,'东西巷',(0,4.32,.56),4.3,.85,'gold')
        if name=='R17' and outward[0]<-.7:
            model.box(0,3.25,.45,length,2.9,.95,'white')
            model.box(0,3.15,.52,length+.16,.18,1.1,'granite')
        if name in ('R10','R10-west') and outward[1]>.8 and length>8:
            steps=max(3,round(length/1.25));pitch=length/steps
            for index in range(steps):
                depth=1.55+.95*math.sin(math.pi*(index+.5)/steps)
                model.box((index+.5)*pitch-length/2,3.25,depth/2,pitch+.02,.42,depth,'white')
            model.box(0,.06,1.45,length,.12,2.9,'pave')
            if model.detail:
                bays=max(2,round(length/3.3))
                for bay in range(bays):
                    along=((bay+.5)/bays-.5)*length
                    model.box(along,.32,.54,length/bays*.87,1.88,.84,'glass')
                    model.box(along,.14,.80,length/bays*.90,.28,.90,'granite')
                    model.box(along,2.32,.50,length/bays*.93,.52,.65,'wood')
            for along in np.arange(-length/2+3,length/2-1,7.2):
                model.beam([along,0,3.1],[along,3.7,3.1],.16,'wood',8,True)
                crown=trimesh.creation.icosphere(subdivisions=1)
                model.mesh(crown.vertices*[1.4,1.35,1.3]+[along,4.6,3.1],crown.faces,'leaf')
        if name=='N011' and center[0]+ORIGIN[0]>-627 and -174<center[1]+ORIGIN[1]<-130 and outward[0]>.35 and length>3:
            model.box(0,0,.95,length,3.1,1.9,'wood',True)
            model.swept_roof(0,3.1,.85,length+.2,2.4,.8)
            for bay in range(max(1,round(length/3))):
                count=max(1,round(length/3));along=(bay+.5)*length/count-length/2
                model.box(along,.35,1.93,length/count*.77,2.2,.12,'glass')
        if name=='N011' and outward[1]>.65 and center[1]+ORIGIN[1]>-144 and length>3:
            spans=max(3,round(length/1.2))
            for index in range(spans):
                depth=.75+1.05*math.sin(math.pi*(index+.5)/spans)
                model.box(((index+.5)/spans-.5)*length,3.12,depth/2,length/spans+.02,.32,depth,'granite')
        if name=='N022' and outward[0]<-.7 and center[1]+ORIGIN[1]<-134:
            model.box(0,height,.02,length,.82,.25,'brick')
            model.box(0,height+.82,.02,length,.17,.38,'stone')
        if name=='R33' and outward[0]<-.4 and length>3:
            model.box(0,height,0,length,.95,.32,'brick')
            model.box(0,height+.95,0,length,.17,.36,'stone')
        if name=='N022' and outward[1]<-.6 and length>2:
            model.box(0,0,.3,length,height,.6,'brick',True)
            model.box(0,height,.25,length+.14,.27,.95,'tile')
        if modern:
            model.box(0,height,0,length,.45,.28,'white')
            if name=='R67' and (outward[0]>.6 or outward[1]>.6):
                model.box(0,height-.32,.35,length,.28,.9,'granite')
                count=max(2,round(length/3.2))
                for bay in range(count):
                    along=((bay+.5)/count-.5)*length
                    model.box(along,.02,.38,.28,height-.34,.34,'stone')
                    model.box(along,2.52,.16,length/count-.30,.46,.31,'sign')
            if name=='R2' and outward[0]>.3 and outward[1]<-.3:
                # The dark full-height advertising panel faces the walking street (Rock 09).
                width, panel_height, rim = length*.94, height-8.0, .30
                model.box(0,4.3+rim,.24,width-2*rim,panel_height-2*rim,.26,SCREEN_FACE)
                for base in (4.3,4.3+panel_height-rim):
                    model.box(0,base,.24,width,rim,.26,SCREEN_FRAME)
                for jamb in (-(width-rim)/2,(width-rim)/2):
                    model.box(jamb,4.3+rim,.24,rim,panel_height-2*rim,.26,SCREEN_FRAME)
                model.box(0,height-.10,0,length,1.78,.30,'granite')
                letters(model,'港舍',(0,height+.18,.16),length*.76,1.35,'white')
            bays=max(1,round(length/2.4))
            for bay in range(bays):
                along=((bay+.5)/bays-.5)*length
                model.box(along,0,.07,length/bays,.47,.40,'stone')
            for level in range(attributes['levels']):
                model.box(0,level*3.45+.45,.035,length*(.99 if name=='R2' else .91),2.85 if name=='R2' else 2.05,.17,'glass')
                for slot in range(bays):
                    model.box(((slot+.5)/bays-.5)*length,level*3.45+.44,.12,.10,2.08,.14,'granite')
            continue
        if shopfront:
            bays=max(1,round(length/3.2))
            for bay in range(bays):
                along=((bay+.5)/bays-.5)*length
                model.box(along,.18,.025,length/bays*.91,2.30,.18,'glass')
                model.box(along,0,.025,length/bays*.91,.21,.22,'stone')
            if name=='N011' and length>2:
                model.box(0,2.48,-.015,length*.93,.69,.27,'stone')
                model.mesh(trimesh.creation.box([length*.91,.58,.20]).vertices+[0,2.81,.14],
                           trimesh.creation.box().faces,np.tile([43,94,153,255],(8,1)))
            model.box(0,3.23,.2,length,.20,.75,'tile')
            for level in range(1,attributes['levels']):
                for bay in range(bays):
                    along=((bay+.5)/bays-.5)*length
                    model.box(along,level*3.45+.55,.08,length/bays*.57,1.6,.14,'wood')
            continue
        model.box(0,height,0,length+.18,.28,.66,'tile')
        model.box(0,3.05,.32,length,.25,1.35,'wood')
        if historic:
            historic_bays(model,length,height,attributes['levels'])
            if length<7 and length>2:
                model.box(0,height,0,length,.48,.25,'white')
                model.box(0,height+.45,0,length*.68,.40,.25,'white')
        for level in range(0 if historic else attributes['levels']):
            model.box(0,level*3.45+2.98,0,length,.22,.65,'wood')
            count = max(1,round(length/3.4))
            for slot in range(count):
                east = ((slot+.5)/count-.5)*length
                if level == 0:
                    model.box(east,0,.06,length/count*.75+.10,.44,.38,'brick')
                model.box(east,level*3.45+.42,.02,length/count*.75,1.9,.20,'glass')
                if model.detail:
                    model.box(east,level*3.45+.42,.09,.095,1.9,.18,'wood')
                    if level==0 and length/count>1.6:
                        model.box(east-length/count*.46,0,.65,.19,3.05,.19,'wood')
                        model.box(east-length/count*.33,2.91,.38,.10,.13,.84,'wood')
                        model.box(east-length/count*.33,2.65,.76,.27,.37,.27,'red')
        if attributes['screen'] and delta[0]>10:
            model.box(0,5.8,.35,12.8,4.05,.55,'sign')
            model.box(0,6.1,.65,12.2,3.5,.12,'glass')
    if polygon.area>0 and not modern:
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


def registered_market(model, slabs):
    from plaza_seam import drape_walkways
    boundary = Polygon([point(coords) for coords in MARKET['replace']['polygon']])
    carriageways = [profile(LineString(np.asarray(points(way))-ORIGIN), way['tags'], STRtree([]), way['id'])
                    for way in load_osm('wangcheng_market') if way['type']=='way' and way['id'] in (258909993,259020569)]
    if len(carriageways)!=2:raise ValueError('Missing Jiefang East carriageway')
    boundary=boundary.difference(unary_union([road.pavement for road in pair_carriageways(carriageways)]))
    terrain=np.load(ROOT/'pipeline/data/layout/dongxi-ground.npz');grid=terrain['heights']/10
    model.tile_parts['ruinGlass']=[]
    left,top=terrain['lower']-ORIGIN
    model.pose=(0,0,0,0)
    glass=[]
    for row,col in np.ndindex(grid.shape[0]-1,grid.shape[1]-1):
        x=left+col*4;z=top+row*4;cell=box(x,z,x+4,z+4)
        if -514<x+ORIGIN[0]<-496 and -186<z+ORIGIN[1]<-174:glass.append(cell)
    drape_walkways(model,[boundary,*slabs],unary_union(glass).intersection(boundary))
    for feature in LAYOUT+INFILL:
        attrs = feature['properties']
        if attrs['kind']=='roof' and attrs['render'] and attrs['name'] not in EXTERNAL_ROOFS:
            envelope(model, feature)
        elif attrs['kind']=='covered_passage':
            model.grade_reference=attrs['ground_m']-157.7
            rings=[[point(corner) for corner in ring] for ring in feature['geometry']['coordinates']]
            deck=trimesh.creation.extrude_polygon(Polygon(rings[0],rings[1:]),.24,engine='earcut')
            model.pose=(0,attrs['ground_m']-157.7+attrs['eave_m']-.24,0,0)
            model.mesh(deck.vertices[:,[0,2,1]],deck.faces[:,::-1],'tile',True)
        elif attrs['kind']=='storefront':
            if attrs['name'] in EXTERNAL_SIGNS:
                continue
            model.grade_reference=attrs['ground_m']-157.7
            east,south = point(feature['geometry']['coordinates'])
            normal = math.radians(attrs['bearing'])
            if attrs['roof']=='R10' and math.cos(normal)<-.8:
                south-=1.85
            model.pose = (east,0,south,normal-math.pi)
            title = 'STARBUCKS COFFEE' if attrs['name']=='星巴克' else attrs['name']
            width = 8.6 if attrs['name']=='星巴克' else min(5.5,max(2.6,len(title)*.72))
            historic=next(item['properties'].get('historic',False) for item in LAYOUT if item['properties']['name']==attrs['roof'])
            shade = 'sign' if historic else attrs['sign_background']
            width=min(width,attrs['wall_width_m'])
            if attrs['roof']=='王城商厦':
                # The mall shell streams separately. Seat the sign jambs on its final street grade.
                model.grade_reference=max(model.grade_reference,model.grade(east,south))
            base=model.grade_reference+2.4+(attrs['floor']-1)*3.45
            if attrs['roof']=='王城商厦':
                for side in (-1,1):
                    model.box(side*(width/2-.08),model.grade_reference,.06,.14,
                              base-model.grade_reference+.12,.18,'stone')
            model.box(0,base,.09,width,.75,.30,shade)
            letters(model,title,(0,base+.11,.25),width*.93,.5,'gold' if historic else ('sign' if shade in ('white','gold') else 'white'))
    model.grade_reference=0
