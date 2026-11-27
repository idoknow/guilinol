"""Bake markings into the native one-metre ground map; no coplanar decals."""
from collections import defaultdict
import math

import numpy as np
from PIL import ImageDraw
from shapely.geometry import LineString

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
        if kind=='taxiway':
            for row,line in sources[kind]:
                if not area(row).is_empty: continue
                stroke(line,'marking_yellow')
                for side in (-1,1): stroke(line.offset_curve(side*(float(row['tags'].get('width',23))/2-1)),'marking_yellow')
    for _,line in sources['parking_position']:
        stroke(line,'marking_yellow')
        end=np.array(line.coords[-1]); delta=end-line.coords[-2]; normal=np.array([-delta[1],delta[0]])/max(np.linalg.norm(delta),.1)
        stroke(LineString([end-3*normal,end+3*normal]),'marking_yellow')
    for row,line in sources['runway']:
        if row['tags'].get('ref')!='01/19': continue
        ends=sorted([np.array(line.coords[0]),np.array(line.coords[-1])],key=lambda pair:pair[1])
        for begin,finish,number in [(ends[0],ends[1],'19'),(ends[1],ends[0],'01')]:
            length=np.linalg.norm(finish-begin); along=(finish-begin)/length
            across=np.array([-along[1],along[0]])
            def bar(station,offset,length,width):
                start=begin+station*along+offset*across
                draw.polygon([xy(start+forward*along+side*across) for forward,side in
                              [(0,-width/2),(length,-width/2),(length,width/2),(0,width/2)]],fill=palette['marking_white'])
            for side in (-1,1):
                bar(0,side*21,length/2,1)
                for offset in (3,7,11,15,19): bar(8,side*offset,28,2)
                bar(300,side*13,42,6)
                for station in (150,450,600): bar(station,side*10,22,2)
            for station in range(100,int(length/2)-22,50): bar(station,0,25,1.5)
            digits={'0':['111','101','101','101','111'],'1':['010','110','010','010','111'],
                    '9':['111','101','111','001','111']}
            for digit_index,digit in enumerate(number):
                for index,scan in enumerate(digits[digit]):
                    for column,pixel in enumerate(scan):
                        if pixel=='1': bar(60+(4-index)*3,(column+digit_index*4-3)*2,3,2)
