"""Compare shipped geometry to independent mapped features; missing references never pass."""
import argparse
import csv
import json
import math
import os
from pathlib import Path
import subprocess
import gzip
import struct
from functools import lru_cache

import numpy as np
from shapely import polygons as triangle_polygons, union_all, linestrings, polygonize
from shapely.geometry import LineString, Point, Polygon
from shapely.affinity import rotate, translate

from shapely import from_wkt
from shapely.affinity import affine_transform
from common import load_osm, MLON, MLAT, LON0, LAT0, RAW
from features import area, points
from school_frontage import frontage

ROOT = Path(__file__).resolve().parents[1]
BRIDGES = {'guanyi_bridge':693754766,'lize_bridge':702246385,'jiefang_bridge':693451306,'huaqiao':246520676}
# Cross-sections of the modeled span, not the decorative approach or stairs.
SPAN_CORNERS={'guanyi_bridge':(-55,53,20), 'lize_bridge':(-61.5,61.5,11.5),
              'jiefang_bridge':(-140.5,140.5,21.5),'huaqiao':(-35.2,35.2,3.6)}
PHOTO_TARGETS = {'lize_bridge':[1354,1355,1356,1357], 'ronghu:library':[1337,1338,1339],
                 'gunanmen:gate':[1313,1314,1315,1316]}


def floor_slice(triangles, elevation):
    edges=[]
    for face in triangles[(triangles[:,:,1].min(axis=1)<elevation) & (triangles[:,:,1].max(axis=1)>=elevation)]:
        crossings=[]
        for start,end in zip(face,np.roll(face,-1,axis=0)):
            if (start[1]<elevation)!=(end[1]<elevation):
                fraction=(elevation-start[1])/(end[1]-start[1])
                crossings.append((start+(end-start)*fraction)[::2])
        if len(crossings)==2:edges.append(crossings)
    if not edges:return Polygon()
    noded=union_all(linestrings(np.round(edges,2)),grid_size=.01)
    return union_all(list(polygonize(list(getattr(noded,'geoms',[noded]))).geoms))


@lru_cache(maxsize=1)
def visible_triangles(model):
    data = subprocess.check_output(['node',ROOT/'pipeline/glb-triangles.mjs',model,'--visible'],timeout=90)
    return np.frombuffer(data,'<f4').reshape(-1,3,3)


def footprint(model, entry, window=None, elevation=None, component_box=None, roof=None):
    triangles = visible_triangles(model)
    if roof is not None:
        triangles=triangles[(abs(triangles[:,:,1]-roof)<.06).all(axis=1)]
    if component_box:
        lower,upper=component_box
        centers=triangles.mean(axis=1)
        triangles=triangles[((centers>=lower)&(centers<=upper)).all(axis=1)]
    if window:
        east,south,radius = window
        centers = triangles.mean(axis=1)
        triangles = triangles[np.hypot(centers[:,0]-east,centers[:,2]-south)<radius]
    triangles = triangles.astype(float)
    flat = triangles[:,:,::2]
    angle = math.radians(entry['rotation'])
    cosine,sine = math.cos(angle),math.sin(angle)
    flat[:] = flat @ np.array([[cosine,-sine],[sine,cosine]]) + np.array(entry['position'])[::2]
    if elevation is not None:return floor_slice(triangles,elevation)
    faces = triangle_polygons(flat)
    import shapely
    return union_all(faces[shapely.area(faces)>.005], grid_size=.02)


def axis(shape):
    if isinstance(shape,LineString):
        start,end=shape.coords[0],shape.coords[-1]
    else:
        rectangle=shape.minimum_rotated_rectangle
        if not isinstance(rectangle,Polygon):
            raise ValueError('degenerate footprint')
        corners=list(rectangle.exterior.coords)
        start,end=max(zip(corners,corners[1:]),key=lambda pair: math.dist(*pair))
    return math.degrees(math.atan2(end[0]-start[0],start[1]-end[1]))%180


def metrics(shape,reference):
    delta=abs((axis(shape)-axis(reference)+90)%180-90)
    center=shape.centroid.distance(reference.centroid)
    iou=None if isinstance(reference,LineString) else shape.intersection(reference).area/shape.union(reference).area
    return iou,center,delta


def component_result(name,source,shape,reference):
    result=dict(component=name,reference=source,status='missing-component')
    if shape.is_empty:return result
    iou,center,delta=metrics(shape,reference)
    result.update(iou=round(iou,3),centroidM=round(center,2),angleDeg=round(delta,2),
                  status='pass' if iou>=.7 and center<=5 and delta<=5 else 'fail')
    return result


def chunk_building(manifest,source,reference):
    pieces=[]
    for tile in manifest['chunks']:
        if reference.distance(Point(tile['x']+128,tile['z']+128))>182:continue
        data=gzip.decompress((ROOT/'public/world'/tile['file']).read_bytes())
        vertices,indices,size=struct.unpack_from('<III',data,4)
        offset=24+4*65**2+9*vertices+4*indices
        for _,_,rings,_,_,seed,*_ in json.loads(data[offset:offset+size])[0]:
            if seed!=int(source.split('/')[1])%65536:continue
            coordinates=[np.asarray(ring)/100+[tile['x'],tile['z']] for ring in rings]
            pieces.append(Polygon(coordinates[0],coordinates[1:]))
    return union_all(pieces)


def shoreline_axis(shape):
    if shape.geom_type == "MultiPolygon":
        shape = max(shape.geoms,key=lambda part:part.area)
    ring=shape.exterior
    samples=np.array([ring.interpolate(fraction,normalized=True).coords[0] for fraction in np.arange(256)/256])
    _,vectors=np.linalg.eigh(np.cov(samples.T))
    east,south=vectors[:,-1]
    return math.degrees(math.atan2(east,-south))%180


def bridge_axis(reference):
    if isinstance(reference,LineString):return reference
    rect=reference.minimum_rotated_rectangle
    corners=list(rect.exterior.coords)
    edges=sorted((LineString(pair) for pair in zip(corners,corners[1:])),key=lambda edge:edge.length)
    line=LineString([edge.centroid for edge in edges[:2]])
    return line.intersection(reference)


def bridge_report(key,model,entry,reference):
    vertices=np.frombuffer(subprocess.check_output(['node',ROOT/'pipeline/glb-triangles.mjs',model,'--visible'],timeout=90),'<f4').reshape(-1,3)[:,::2]
    left,right,half_width=SPAN_CORNERS[key]; ends=[]
    for station in (left,right):
        pair=[]
        for side in (-half_width,half_width):
            distance=np.linalg.norm(vertices-[station,side],axis=1)
            if distance.min()>1:return dict(status='missing-span-corner')
            pair.append(vertices[distance.argmin()])
        ends.append(np.mean(pair,axis=0))
    actual=translate(rotate(LineString(ends),-entry['rotation'],origin=(0,0)),*entry['position'][::2])
    mapped=bridge_axis(reference)
    errors=min(([Point(a).distance(Point(b)) for a,b in zip(actual.coords,order)] for order in
                ((mapped.coords[0],mapped.coords[-1]),(mapped.coords[-1],mapped.coords[0]))),key=max)
    delta=abs((axis(actual)-axis(mapped)+90)%180-90)
    return dict(angleDeg=round(delta,2),endpointM=[round(error,2) for error in errors],
                status='pass' if max(errors)<=5 and delta<=5 else 'fail')


def photos_pass(views, suspect=None):
    hits = sum(view['inFov'] for view in views.values())
    for number, view in views.items():
        if not view['inFov']:
            reason = (suspect or {}).get(number)
            if hits < 2 or not isinstance(reason, str) or not reason.strip():
                return False
            view['photoExifSuspect'] = reason
    return True


def photo_hits(shape,photo):
    point=(photo['x'],photo['z'])
    distance=max(10,shape.hausdorff_distance(Point(point))*2)
    angle=math.radians(photo['heading']); half=math.atan(18/photo['focal35'])
    def end(yaw):return point[0]+distance*math.sin(yaw),point[1]-distance*math.cos(yaw)
    return {'inFov':Polygon([point,end(angle-half),end(angle+half)]).intersects(shape),
            'centerHit':LineString([point,end(angle)]).intersects(shape)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--strict',action='store_true',default=os.getenv('npm_config_strict')=='true')
    parser.add_argument('--out',type=Path)
    args=parser.parse_args()
    osm={f"{item['type']}/{item['id']}":item for item in load_osm()}
    manifest=json.loads((ROOT/'public/world/manifest.json').read_bytes())
    entries={item['id']:item for item in manifest['landmarks']}
    photos=json.loads((ROOT/'docs/refs/rock/photo-locations.json').read_bytes())
    report=[]
    specs=json.loads((ROOT/'pipeline/landmarks.json').read_bytes())
    schools=[school for catalog in ('schools-g1.json','schools-g2.json')
             for school in json.loads((ROOT/'pipeline'/catalog).read_bytes())]
    wanted={source for spec in specs if isinstance(spec.get('replace'),list) for source in spec['replace'] if source not in osm}
    wanted.update(source for spec in specs for source in spec.get('auditBuildings',{}) if source not in osm)
    with (Path(RAW)/'overture_buildings.csv').open() as source_file:
        overture={row['id']:affine_transform(from_wkt(row['wkt']),[MLON,0,0,-MLAT,-LON0*MLON,LAT0*MLAT])
                  for row in csv.DictReader(source_file,delimiter='\t') if row['id'] in wanted}
    for spec in specs:
        key=spec['id']; entry=entries.get(key); row={'id':key,'status':'missing-reference'}; report.append(row)
        ref=spec.get('anchor'); notes=spec.get('alignNote')
        if notes:row['alignNote']=notes
        if spec.get('noStreetSign'):
            model=spec['model']
            instances=sum(item['id']==key or item['file']==model for item in manifest['landmarks'])
            instances+=sum(item.get('model')==model for item in manifest['peaks']['entries'])
            packed=(ROOT/'public'/model).exists()
            blocks=sum(len(school.get('blocks',[])) for school in schools if school['id']==key)
            row.update(noStreetSign=True,instances=instances,packedModel=packed,manualBlocks=blocks,
                       status='fail' if instances or packed or blocks else 'pass');continue
        if 'schematicCampus' in spec:
            site = frontage(osm[spec['schematicCampus']],osm)
            if not site:
                row['reason']='no addressed street segment for schematic plaque';continue
            if not entry:
                row['status']='missing-instance';continue
            _, source, midpoint, _, road, edge = site
            shape=footprint(ROOT/'public'/spec['model'],entry)
            if shape.is_empty:
                row['status']='empty-geometry';continue
            distance=shape.centroid.distance(midpoint)
            delta=abs((axis(shape)-axis(road)+90)%180-90)
            setback=midpoint.distance(road)
            edge_delta=abs((axis(edge)-axis(road)+90)%180-90)
            row.update(reference=source,midpointM=round(distance,2),angleDeg=round(delta,2),
                       boundaryMidpointToRoadM=round(setback,2),boundaryRoadAngleDeg=round(edge_delta,2),
                       status='pass' if distance<=5 and delta<=5 and setback<=20 and edge_delta<=5 else 'fail');continue
        if key in BRIDGES:ref=f'way/{BRIDGES[key]}'
        if not entry:
            peak=next((peak for peak in manifest['peaks']['entries'] if peak.get('model')==spec['model']),None)
            if peak:entry={'position':peak['center'],'rotation':0}
        if not entry:
            row['status']='missing-instance';continue
        if key in ('dongxixiang','zhengyang') and notes=='deferred to IDOK-44':
            row['status']='deferred';continue
        if key=='zhengyang_clock':
            survey=json.loads((ROOT/'docs/layout/zhengyang.geojson').read_text())
            lon,lat=next(f['geometry']['coordinates'] for f in survey['features'] if f['id']=='clock-osm')
            reference=Point((lon-LON0)*MLON,(LAT0-lat)*MLAT)
            base=footprint(ROOT/'public'/spec['model'],entry,elevation=1)
            distance=base.centroid.distance(reference) if not base.is_empty else math.inf
            row.update(reference='node/6326899999',measurement='four pier centres at 1 m',
                       centroidM=round(distance,3),status='pass' if distance<=4 else 'fail')
            continue
        if key=='wangcheng_market':
            # Alley/plaza aggregate with no single footprint; positions are checked by the
            # IDOK-50 evidence-layout audit (docs/layout/dongxi-audit.md, scripts/dongxi/lane-audit.py).
            row.update(status='deferred',alignNote=notes or 'audited by docs/layout/dongxi-audit.md (IDOK-50)');continue
        if key=='jingjiang':
            components=[]
            for name,source,bounds,roof in (
                ('south_gate','way/1008248059',((-21,8.98,-24),(21,9.12,1)),9.05),
                ('chengyun_gate','way/1008248065',((-13,1,-156),(17,13,-138)),None),
                ('chengyun_hall','way/679734442',((-24,.5,-271),(28,2.8,-237)),None),
                ('west_hall','way/679734429',None,None),('east_hall','way/679734451',None,None)):
                reference=area(osm[source])
                shape=(footprint(ROOT/'public'/spec['model'],entry,component_box=bounds,roof=roof) if bounds
                       else chunk_building(manifest,source,reference))
                components.append(component_result(name,source,shape,reference))
            row.update(components=components,status='pass' if all(item['status']=='pass' for item in components) else 'fail')
            continue
        if 'auditBuildings' in spec:
            model=ROOT/'public'/spec['model'];components=[]
            for source,roof in spec['auditBuildings'].items():
                reference=area(osm[source]) if source in osm else overture[source]
                shape=footprint(model,entry,elevation=6 if roof is None else None,roof=roof)
                selected=max(getattr(shape,'geoms',[shape]),key=lambda part:part.intersection(reference).area,default=Polygon())
                components.append(component_result('wall' if roof is None else 'roof',source,selected,reference))
            row.update(components=components,status='pass' if components and all(item['status']=='pass' for item in components) else 'fail');continue
        if key=='yiwu_street':
            components=[]
            for building,source in (('yiwu_old_house','way/702352880'),('yiwu_office','way/675974225')):
                placement=entries[building];shape=footprint(ROOT/'public'/placement['file'],placement,elevation=2)
                iou,center,delta=metrics(shape,area(osm[source]))
                components.append(dict(component=building,reference=source,iou=round(iou,3),centroidM=round(center,2),angleDeg=round(delta,2),
                                       status='pass' if iou>=.7 and center<=5 and delta<=5 else 'fail'))
            row.update(components=components,status='pass' if all(item['status']=='pass' for item in components) else 'fail');continue
        if key=='guihu_moorings':
            shore=area(osm['way/674616142']).exterior
            hulls=footprint(ROOT/'public'/spec['model'],entry,elevation=2.4)
            components=[]
            for hull in getattr(hulls,'geoms',[hulls]):
                if hull.area<5:continue
                station=shore.project(hull.centroid)
                tangent=LineString([shore.interpolate((station+offset)%shore.length) for offset in (-7,7)])
                delta=abs((axis(hull)-axis(tangent)+90)%180-90)
                gap=hull.distance(shore)
                components.append(dict(shoreDistanceM=round(gap,2),angleDeg=round(delta,2),status='pass' if gap<=5 and delta<=5 else 'fail'))
            row.update(reference='way/674616142',components=components,status='pass' if len(components)==4 and all(item['status']=='pass' for item in components) else 'fail');continue
        if key=='ronghu':
            components=[]
            for name,instance,source,window,height in (
                ('library',key,'way/679990105',(-26,-65,54),None),
                ('rong_hotel','gunanmen','way/521248450',(10,-51,17),8),
                ('inn','gunanmen','way/521248446',(10,-86,16),8),
                ('island',key,'way/674611987',(136,142,48),None)):
                placement=entries[instance]
                model=ROOT/'public'/placement['file']
                if name in ('library','island'):
                    faces=visible_triangles(model)
                    area_y=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])[:,1]
                    near=np.linalg.norm(faces.mean(axis=1)[:,::2]-window[:2],axis=1)<window[2]
                    flat=near & (np.ptp(faces[:,:,1],axis=1)<.03) & (area_y>0)
                    if not flat.any():
                        components.append(dict(component=name,status='missing-cap'));continue
                    levels,indices=np.unique(np.round(faces[flat,:,1].mean(axis=1),1),return_inverse=True)
                    cap=float(levels[np.bincount(indices,weights=area_y[flat]).argmax()])
                    if name=='island':
                        section=footprint(model,placement,window,cap-.08)
                    else:
                        # Rear block, wing parapets and lower front block of the library.
                        section=union_all([footprint(model,placement,window,roof=cap+offset)
                                           for offset in (0,.18,-2.2)])
                else:
                    section=footprint(model,placement,window,height)
                if source in osm:target=area(osm[source])
                else:
                    member=next(member for member in osm['relation/9373836']['members'] if member['ref']==674611987 and member['role']=='inner')
                    target=Polygon(points(member))
                parts=[part for part in getattr(section,'geoms',[section]) if part.intersects(target)]
                if not parts:components.append(dict(component=name,reference=source,status='no-overlap'));continue
                shape=union_all(parts);iou,center,delta=metrics(shape,target)
                if name=='island':delta=abs((shoreline_axis(shape)-shoreline_axis(target)+90)%180-90)
                views={str(number):photo_hits(shape,photos[f'IMG_{number}.jpg']) for number in PHOTO_TARGETS.get(key+':'+name,())}
                components.append(dict(component=name,reference=source,iou=round(iou,3),centroidM=round(center,2),angleDeg=round(delta,2),photos=views,
                                       status='pass' if iou>=.7 and center<=5 and delta<=5 and photos_pass(views,spec.get('photoExifSuspect')) else 'fail'))
            row.update(components=components,status='pass' if all(item['status']=='pass' for item in components) else 'fail');continue
        if key=='shanhu_pagodas':
            towers=footprint(ROOT/'public'/spec['model'],entry,elevation=18)
            parts=list(getattr(towers,'geoms',[towers]));components=[]
            for source in ('way/674587990','way/162798058'):
                target=area(osm[source]).centroid
                if not parts or towers.is_empty:break
                selected=min(parts,key=lambda part:part.centroid.distance(target));parts.remove(selected)
                error=selected.centroid.distance(target)
                components.append(dict(reference=source,centroidM=round(error,2),status='pass' if error<=5 else 'fail'))
            row.update(components=components,status='pass' if len(components)==2 and all(item['status']=='pass' for item in components) else 'fail');continue
        if key in ('fubo','diecai','duxiu','mulong','elephant_hill'):
            from common import ll2xz
            element=osm[ref]; mapped=(Point(ll2xz(element['lat'],element['lon'])) if element['type']=='node' else area(element).centroid)
            error=Point(entry['position'][::2]).distance(mapped)
            row.update(reference=ref,centroidM=round(error,3),status='pass' if error<=5 else 'fail');continue
        if key in ('shizijie','zhongshan_road','wangcheng_teaching'):
            shape=footprint(ROOT/'public'/spec['model'],entry,elevation=6)
            parts=list(getattr(shape,'geoms',[shape]));components=[]
            for source in spec['replace']:
                target=area(osm[source]) if source in osm else overture.get(source,Polygon())
                if target.is_empty or not parts:
                    components.append({'reference':source,'status':'missing-reference'});continue
                selected=max(parts,key=lambda part:part.intersection(target).area)
                if not selected.intersects(target):
                    components.append({'reference':source,'status':'no-overlap'});continue
                iou,center,delta=metrics(selected,target)
                components.append(dict(reference=source,iou=round(iou,3),centroidM=round(center,2),angleDeg=round(delta,2),
                                       status='pass' if iou>=.7 and center<=5 and delta<=5 else 'fail'))
            row.update(components=components,status='pass' if components and all(item['status']=='pass' for item in components) else 'fail');continue
        if key in ('libin_middle','guilin_book_market'):
            from common import ll2xz
            shape=footprint(ROOT/'public'/spec['model'],entry,elevation=2)
            parts=list(getattr(shape,'geoms',[shape]));components=[]
            pairs=(('north_teaching','way/683033662'),('mid_teaching','way/683033663')) if key=='libin_middle' else (
                  ('universal_hotel','way/675919397'),('yunman_hotel','c1096f2a-0237-419b-8fce-7ac49da6ad10'))
            for comp,source in pairs:
                target=area(osm[source]) if source in osm else overture.get(source,Polygon())
                if target.is_empty or not parts:
                    components.append({'component':comp,'reference':source,'status':'missing-reference'});continue
                selected=max(parts,key=lambda part:part.intersection(target).area)
                if not selected.intersects(target):
                    components.append({'component':comp,'reference':source,'status':'no-overlap'});continue
                iou,center,delta=metrics(selected,target)
                components.append(dict(component=comp,reference=source,iou=round(iou,3),centroidM=round(center,2),angleDeg=round(delta,2),
                                       status='pass' if iou>=.7 and center<=5 and delta<=5 else 'fail'))
            road=LineString(points(osm['way/675174045']))
            front_win=(128.5,-11.5,16) if key=='libin_middle' else (-12,5,28)
            front_name='street_gate' if key=='libin_middle' else 'book_market_binjiang'
            front=footprint(ROOT/'public'/spec['model'],entry,window=front_win,elevation=5)
            if front.is_empty:
                components.append(dict(component=front_name,reference='way/675174045',status='empty-geometry'))
            else:
                station=road.project(front.centroid)
                tangent=LineString([road.interpolate(max(0,station-10)),road.interpolate(min(road.length,station+10))])
                delta=abs((axis(front)-axis(tangent)+90)%180-90)
                gap=front.distance(road)
                item=dict(component=front_name,reference='way/675174045',roadDistanceM=round(gap,2),angleDeg=round(delta,2))
                ok=gap<=25 and delta<=5
                if key=='libin_middle':
                    node=osm['node/9214622462']
                    ndist=front.distance(Point(ll2xz(node['lat'],node['lon'])))
                    item['nodeReference']='node/9214622462';item['nodeDistanceM']=round(ndist,2)
                    ok=ok and ndist<=12
                item['status']='pass' if ok else 'fail'
                components.append(item)
            row.update(components=components,status='pass' if all(item['status']=='pass' for item in components) else 'fail');continue
        window=None
        if key=='gunanmen':ref='way/521248472';window=(-.8,-12,12);row['component']='gate'
        if key=='central_square':ref='way/675177179';row['component']='gymnasium'
        element=osm.get(ref) if isinstance(ref,str) else None
        if not element:continue
        tags=element.get('tags',{})
        if key not in BRIDGES and not tags.get('building'):continue
        # The east footing of Wangcheng Mall reaches +3.81 m on the finished slope.
        # Slice the continuous ground-floor walls two metres above that corner.
        elevation=None if key in BRIDGES or key=='zhuangyuan_gallery' else {'central_square':8,'ronghu':4,'nikoniko':10,'wangcheng_mall':6,'gunanmen':6.6,'xiaoyao_tower':9}.get(key,2)
        component_box=((-22,3,-3),(22,7,3)) if key=='zhuangyuan_gallery' else None
        shape=footprint(ROOT/'public'/spec['model'],entry,window,elevation,component_box)
        row['measurement']='visible deck projection' if elevation is None else f'wall section at local y={elevation} m'
        reference=area(element)
        if reference.is_empty:reference=LineString(points(element))
        if key in BRIDGES:
            row.update(reference=ref,measurement='water-span axis and endpoint distances',**bridge_report(key,ROOT/'public'/spec['model'],entry,reference))
            row['photos']={str(number):photo_hits(shape,photos[f'IMG_{number}.jpg']) for number in PHOTO_TARGETS.get(key,())}
            if not photos_pass(row['photos']):row['status']='fail'
            continue
        if key=='zhuangyuan_gallery':row['measurement']='gallery roof projection'
        if key in ('central_square','gunanmen','xiaoyao_tower','guilin_theater'):
            parts=list(getattr(shape,'geoms',[shape]));shape=max(parts,key=lambda part:part.intersection(reference).area)
        if shape.is_empty:row['status']='empty-geometry';continue
        iou,center,delta=metrics(shape,reference)
        row.update(reference=ref,iou=round(iou,3) if iou is not None else None,centroidM=round(center,2))
        if key=='xiaoyao_tower':delta=min(delta,90-delta)
        row['angleDeg']=round(delta,2)
        passed=center<=5 and (iou is None or iou>=.7) and delta<=5
        group=key+':'+row['component'] if 'component' in row else key
        row['photos']={str(number):photo_hits(shape,photos[f'IMG_{number}.jpg']) for number in PHOTO_TARGETS.get(group,())}
        row['status']='pass' if passed and photos_pass(row['photos'],spec.get('photoExifSuspect')) else 'fail'
    text=json.dumps(report,indent=2,ensure_ascii=False)
    if args.out:args.out.write_text(text+'\n')
    print(text)
    if args.strict:
        from audit_grounding import run
        grounding = run(ROOT/"captures/grounding")
        if grounding["failures"]:
            raise SystemExit(f"{grounding['failures']} grounding failures (captures/grounding/grounding.json)")
    if args.strict and any(row['status'] not in ('pass','deferred') for row in report):raise SystemExit(1)


if __name__=='__main__':main()
