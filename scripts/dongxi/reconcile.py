import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ops_evidence import require_evidence
import csv,json,math,sys,xml.etree.ElementTree as xml
from pathlib import Path
import numpy as np
from rasterio.features import shapes
from scipy.special import expit
from shapely import from_wkt,union_all,make_valid
from shapely.geometry import shape,mapping,Polygon,Point,LineString,box
from shapely.ops import transform
from PIL import Image
root=Path(__file__).resolve().parents[2];folder=require_evidence('layout');sys.path.insert(0,str(root/'pipeline'));from common import MLON,MLAT,LON0,LAT0
def project(lon,lat):return ((np.asarray(lon)-LON0)*MLON,(LAT0-np.asarray(lat))*MLAT)
def geographic(east,south):return (np.asarray(east)/MLON+LON0,LAT0-np.asarray(south)/MLAT)
def pieces(poly):return [part for part in getattr(poly,'geoms',[poly]) if part.geom_type=='Polygon' and not part.is_empty]
config=json.loads((root/'pipeline/landmarks.json').read_text());market=next(r for r in config if r['id']=='wangcheng_market');boundary=transform(project,Polygon(market['replace']['polygon']));features=json.loads(((root/'pipeline/data/layout')/'dongxi-layout.geojson').read_text())['features'];data=np.load('density-logits.npz');lower=data['lower'];scale=256*2**int(data['zoom'])
def to_world(col,row):
    lon=(np.asarray(col)+lower[0])/scale*360-180;lat=np.rad2deg(np.arctan(np.sinh(np.pi*(1-2*(np.asarray(row)+lower[1])/scale))));return project(lon,lat)
mask=expit(data['logits'][0])>=.4371;Image.fromarray(mask).save(folder/'dongxi-esri-mask.png');(folder/'dongxi-esri-grid.json').write_text(json.dumps(dict(pixel_origin=lower.tolist(),zoom=int(data['zoom'])))+'\n');trace=union_all([transform(to_world,shape(g)) for g,v in shapes(mask.astype('uint8'),mask=mask) if v]);lanes=union_all([transform(project,shape(f['geometry'])).buffer(f['properties']['width_m']/2+.35) for f in features if f['properties']['kind']=='lane']);sight=union_all([LineString([(-548,-113),(-538,-109),(-532,-107)]).buffer(2.3),LineString([(-541.9,-131.5),(-558,-136),(-562,-137)]).buffer(2.1)]);clear=lanes.union(sight).union(box(-514,-186,-496,-174));occupied=union_all([transform(project,shape(f['geometry'])) for f in features if f['properties']['kind'] in ('roof','mall')]);terrain=np.load(folder/'dongxi-ground.npz');rows=[];sources=[]
def add(geom,source,reference):
    global occupied
    inside=make_valid(geom).intersection(boundary);free=inside.difference(occupied.buffer(.22)).difference(clear);added=[]
    for part in pieces(make_valid(free)):
        part=part.simplify(.75,preserve_topology=True)
        if part.area<9 or part.buffer(-.72).is_empty:continue
        center=part.representative_point();col,row=np.rint((np.array(center.coords[0])-terrain['lower'])/4).astype(int);height=float(terrain['heights'][row,col])/10
        name='N%03d'%(len(rows)+1);geo=transform(geographic,part);props=dict(name=name,kind='roof',evidence=[source,reference],confidence='低',levels=2,eave_m=6.9,ground_m=height,render=True,historic=True,screen=False);rows.append(dict(type='Feature',properties=props,geometry=mapping(geo)));added.append(part)
    if added:occupied=occupied.union(union_all(added))
    if source!='Esri' and inside.area>.1:sources.append(dict(source=source,id=reference,inside_m2=round(inside.area,1),new_m2=round(sum(p.area for p in added),1)))
osm=xml.parse('map.osm').getroot();nodes={n.get('id'):project(float(n.get('lon')),float(n.get('lat'))) for n in osm.findall('node')}
for way in osm.findall('way'):
    if not any(t.get('k')=='building' for t in way.findall('tag')):continue
    coords=[nodes[n.get('ref')] for n in way.findall('nd') if n.get('ref') in nodes];
    if len(coords)>3:add(Polygon(coords),'OSM','way/'+way.get('id'))
with (root/'raw/overture_buildings.csv').open() as file:
    for item in csv.DictReader(file,delimiter='\t'):
        geom=from_wkt(item['wkt']);
        if geom.intersects(transform(geographic,boundary)):add(transform(project,geom),'Overture',item['id'])
for item in json.loads(Path('overture.json').read_text()):add(transform(project,shape(item['geometry'])),'Overture tiles',item['properties']['id'])
for part in pieces(trace.intersection(boundary)):
    if part.area>=9:add(part,'Esri','影像屋面候选；单体边界和高度估计')
from passages import reserve_passages
rows=reserve_passages(rows)
((root/'pipeline/data/layout')/'dongxi-infill.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=rows),ensure_ascii=False,separators=(',',':'))+'\n');(folder/'dongxi-source-audit.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n');print('sources',len(sources),'new roofs',len(rows),'maximum envelope vertices',max(len(f['geometry']['coordinates'][0]) for f in rows));print('layout predicted XOR',trace.symmetric_difference(occupied).intersection(boundary).area/boundary.area)
