"""Bake pavement albedo; export paint separately from the metre-scale raster."""
from collections import defaultdict
import math
import json

import numpy as np
from PIL import ImageDraw
from shapely.geometry import LineString
from shapely.geometry import Polygon
import trimesh
from shapely.ops import unary_union

from common import load_osm
from features import area, points, polygons


def pavement_sources(elements):
    field = next((area(row) for row in elements if row['type']=='relation' and row['id']==13846706),None)
    sources = defaultdict(list)
    if field is not None:
        for row in elements:
            kind = row.get('tags',{}).get('aeroway')
            if row['type']!='way' or kind not in ('runway','apron','taxiway','parking_position'):
                continue
            line = LineString(points(row))
            if field.intersects(line):
                sources[kind].append((row,line))
    return field,sources


def bake_airport(texture,left,top,bounds,stencil,palette):
    field,sources = pavement_sources(load_osm())
    if field is None or not bounds.intersects(field): return
    draw = ImageDraw.Draw(texture)
    def xy(pair): return (round(pair[0]-left),round(pair[1]-top))
    def stroke(shape,color,width=1):
        for part in getattr(shape,'geoms',[shape]):
            if part.geom_type=='LineString' and not part.is_empty:
                draw.line([xy(pair) for pair in part.coords],fill=palette[color],width=width)
    def fill(shape,color):
        for poly in polygons(shape.intersection(bounds)):
            mask,corner=stencil(poly,left,top,1)
            texture.paste(palette[color],corner,mask)
    for row,_ in sources['apron']:
        apron=area(row); fill(apron,'apron_concrete')
        west,north,east,south=apron.bounds
        for start in range(math.floor(west/5)*5,math.ceil(east),5):
            stroke(apron.intersection(LineString([(start,north),(start,south)])),'apron_joint')
        for start in range(math.floor(north/5)*5,math.ceil(south),5):
            stroke(apron.intersection(LineString([(west,start),(east,start)])),'apron_joint')
    for kind,default_width in [('taxiway',23),('runway',45)]:
        for row,line in sources[kind]:
            width=float(row['tags'].get('width',default_width)); strip=area(row)
            if strip.is_empty: strip=line.buffer(width/2,cap_style='flat')
            fill(strip,'runway_asphalt')
    for row in load_osm():
        if row['type']!='node' and row.get('tags',{}).get('amenity')=='parking':
            parking=area(row)
            if field.intersects(parking): fill(parking,'runway_asphalt')


def write_markings(output,bounds,ground):
    field,sources=pavement_sources(load_osm())
    if field is None or not bounds.intersects(field): return None
    vertices=defaultdict(list)
    runways=unary_union([line.buffer(float(row['tags'].get('width',45))/2,cap_style='flat') for row,line in sources['runway']]).buffer(.002)
    def polygon(shape,color):
        if color=='marking_yellow': shape=shape.difference(runways)
        for part in polygons(shape.intersection(bounds)):
            if part.area<.001: continue
            points,faces=trimesh.creation.triangulate_polygon(part,engine='earcut')
            for east,south in points[faces].reshape(-1,2):
                vertices[color].extend((round(east,3),round(ground(east,south)+.025,3),round(south,3)))
    def stroke(shape,color,width=.23):
        for line in getattr(shape,'geoms',[shape]):
            if line.geom_type!='LineString' or line.is_empty: continue
            coords=list(line.segmentize(3).coords)
            for start,end in zip(coords,coords[1:]):
                polygon(LineString([start,end]).buffer(width/2,cap_style='flat'),color)
    for kind in ('taxiway',):
        if sources[kind]:
            for row,line in sources[kind]:
                if not area(row).is_empty: continue
                width=float(row['tags'].get('width',23))
                stroke(line.difference(runways),'marking_yellow')
                crossings=line.intersection(runways.buffer(8).boundary)
                if line.intersects(runways):
                    for point in getattr(crossings,'geoms',[crossings]):
                        if point.is_empty or point.geom_type!='Point': continue
                        station=line.project(point)
                        before=np.array(line.interpolate(max(0,station-1)).coords[0]); after=np.array(line.interpolate(min(line.length,station+1)).coords[0])
                        direction=after-before; direction/=max(np.linalg.norm(direction),.001)
                        center=np.array(point.coords[0]); lateral=np.array([-direction[1],direction[0]])
                        if runways.distance(line.interpolate(min(line.length,station+1)))>runways.distance(point): direction*=-1
                        for offset in (-.75,-.25,.25,.75):
                            origin=center+offset*direction; half=width/2-1
                            for begin in ([-half] if offset<0 else np.arange(-half,half,2)):
                                end=half if offset<0 else min(begin+1,half)
                                stroke(LineString([origin+begin*lateral,origin+end*lateral]),'marking_yellow',.22)
                for side in (-1,1): stroke(line.offset_curve(side*(float(row['tags'].get('width',23))/2-1)),'marking_yellow')
    apron_area=unary_union([area(row) for row,_ in sources['apron']])
    for _,line in sources['parking_position']:
        stroke(line,'marking_yellow')
        end=np.array(line.coords[-1]); delta=end-line.coords[-2]; normal=np.array([-delta[1],delta[0]])/max(np.linalg.norm(delta),.1)
        stroke(LineString([end-3*normal,end+3*normal]),'marking_yellow')
        along=np.array([normal[1],-normal[0]])
        equipment=LineString([end+normal*side+along*depth for side,depth in
                              [(6,-4),(13,-4),(13,-14),(6,-14),(6,-4)]])
        stroke(equipment.intersection(apron_area),'marking_red')
    for row,line in sources['runway']:
        if row['tags'].get('ref')!='01/19': continue
        ends=sorted([np.array(line.coords[0]),np.array(line.coords[-1])],key=lambda pair:pair[1])
        for begin,finish,number in [(ends[0],ends[1],'19'),(ends[1],ends[0],'01')]:
            length=np.linalg.norm(finish-begin); along=(finish-begin)/length
            across=np.array([-along[1],along[0]])
            def bar(station,offset,length,width):
                start=begin+station*along+offset*across
                stroke(LineString([start,start+length*along]),'marking_white',width)
            for side in (-1,1):
                bar(0,side*21,length/2,1)
                for offset in (2.7,6.3,9.9,13.5,17.1,20.7): bar(8,side*offset,30,1.8)
                bar(300,side*13,42,6)
                for station in (150,450,600): bar(station,side*10,22,2)
            for station in range(100,int(length/2)-22,50): bar(station,0,25,1.5)
            outer=[(0,1),(1,0),(4,0),(5,1),(5,8),(4,9),(1,9),(0,8)]
            digits={'0':Polygon(outer,[[(1.3,1.4),(3.7,1.4),(3.7,7.6),(1.3,7.6)]]),
                    '1':Polygon([(1,6.4),(1,7.9),(2.6,9),(3.7,9),(3.7,0),(2.3,0),(2.3,7)]),
                    '9':Polygon([(0,4.5),(0,8),(1,9),(4,9),(5,8),(5,1),(4,0),(1,0),(0,1),(0,2),(1.4,2),(1.4,1.4),(3.7,1.4),(3.7,3.5),(1,3.5)],
                                [[(1.3,5),(3.7,5),(3.7,7.6),(1.3,7.6)]])}
            for index,digit in enumerate(number):
                def transform(ring):
                    return [begin+(60+up)*along+(across_pos+index*7-6)*across for across_pos,up in ring.coords]
                glyph=digits[digit]
                polygon(Polygon(transform(glyph.exterior),[transform(hole) for hole in glyph.interiors]),'marking_white')
    file=output/'airport-markings.json'
    file.write_text(json.dumps(vertices,separators=(',',':')))
    return dict(file=file.name,bytes=file.stat().st_size)
