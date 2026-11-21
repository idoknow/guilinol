"""Jiangnan Alley, OSM 686154940. A 4 m passage and 3.2 m storeys are
estimated against doors in the 2019 series. Bend modules follow way nodes.
"""
import math
import json
from pathlib import Path
import sys
import numpy as np
from shapely.geometry import Point, Polygon
from jingjiang import generate


def lantern(model,east,south):
    rings=[(2.51,.035),(2.63,.035),(2.65,.105),(2.69,.105),(2.73,.175),
           (2.91,.175),(2.96,.105),(3,.105),(3.01,.016),(3.16,.016)]
    surfaces=['gold','wood','wood','red','red','red','wood','wood','wood']
    for (lower,inner),(upper,outer),color in zip(rings,rings[1:],surfaces):
        corners=[(east+radius*math.cos(index*math.pi/3),height,south+radius*math.sin(index*math.pi/3))
                 for height,radius in ((lower,inner),(upper,outer)) for index in range(6)]
        faces=[]
        for index in range(6):
            following=(index+1)%6;faces.extend([[index,index+6,following+6],[index,following+6,following]])
        model.mesh(corners,faces,color)


def frontage(model):
    from plaza_seam import drape_walkways, walkway_rect
    rectangles=[]
    pipeline = Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(pipeline))
    from common import ll2xz
    landmarks = {entry['id']:entry for entry in json.loads((pipeline/'landmarks.json').read_text())}
    origin = np.array(ll2xz(*reversed(landmarks['dongxixiang']['anchor'])))
    replaced = Polygon([np.array(ll2xz(*reversed(point)))-origin for point in landmarks['wangcheng_market']['replace']['polygon']])
    path=[(21.67,-121.76),(13.12,-58.68),(0,0),(37.8,7.3),(47.2,9.8)]
    for segment,(first,last) in enumerate(zip(path,path[1:])):
        dx,dz=np.subtract(last,first);length=math.hypot(dx,dz);angle=math.atan2(-dx,dz)
        count=max(1,round(length/10));pitch=length/count
        for bay in range(count):
            entry_clearance=4.9 if segment==0 and bay==0 else 0
            width=pitch-entry_clearance
            frac=(bay+.5)/count+entry_clearance/(2*length)
            model.pose=(first[0]+dx*frac,0,first[1]+dz*frac,angle)
            rectangles.append(walkway_rect(model.pose,4.5,width+.12))
            for side in (-1,1):
                east=side*6.4; high=6.1+(bay%3==1)*2.9
                corners=[(model.pose[0]+xx*math.cos(angle)-zz*math.sin(angle),model.pose[2]+xx*math.sin(angle)+zz*math.cos(angle)) for xx in (east-3.9,east+3.9) for zz in (-width/2,width/2)]
                if replaced.intersection(Polygon(corners).convex_hull).area>.01:continue
                setback=(3.7-.13*bay) if segment==0 and side==-1 else 0
                east-=side*setback/2
                model.box(east,3,0,6.5-setback,high-3,width-.16,'brick',True)
                model.box(side*(6.97-setback/2),0,0,5.36-setback,3,width-.16,'brick',True)
                model.roof(east,high,0,7.8-setback,width,1.8)
                model.box(side*2.9,3.15,0,1.7,.35,width,'wood')
                if not model.detail:continue
                for end in (-1,1):
                    model.box(east,high,end*(width/2-.16),6.8-setback,.75,.3,'brick')
                    for lift in range(3):model.box(east,high+.7+lift*.43,end*(width/2-.16),(6-lift*1.6)*(1-setback/6.8),.47,.32,'brick')
                for cell in range(3):
                    zz=(cell-1)*width/3
                    model.box(side*3.66,0,zz-width/6+.19,1.22,3,.31,'brick',True)
                    model.box(side*4.23,.37,zz,.16,2.0,width/3-.60,'glass')
                    model.box(side*3.70,0,zz,1.24,.41,width/3-.30,'wood')
                    model.box(side*4.13,.38,zz,.10,1.97,.07,'wood')
                    model.box(side*4.17,2.54,zz,.29,.38,1.22,'sign')
                    for mark in (-.28,0,.28):model.box(side*4.01,2.63,zz+mark,.07,.15,.11,'gold')
                    model.box(side*3.10,3.8,zz,.22,1.8,width/3-.38,'glass')
                    for bar in range(4):model.box(side*2.94,3.8,zz+(bar-1.5)*.46,.13,1.85,.10,'wood')
                    model.box(side*2.95,4.6,zz,.14,.12,width/3-.3,'wood')
                    model.box(side*2.22,3.45,zz,.12,.9,.12,'wood')
                    model.box(side*2.22,4.25,zz,.16,.13,width/3,'wood')
                if high>8:
                    model.box(side*2.9,6.15,0,1.6,.32,width,'wood')
                    for zz in (-2.8,0,2.8):
                        model.box(side*3.1,6.75,zz,.24,1.6,2.25,'glass')
                        for bar in (-.8,0,.8):model.box(side*2.93,6.75,zz+bar,.12,1.6,.12,'wood')
                for zz in (-.85,0,.85):lantern(model,side*2.18,zz)
    entry_angle=math.atan2(path[0][0]-path[1][0],path[1][1]-path[0][1])
    drape_walkways(model,rectangles)
    model.pose=(path[0][0]-3.7*math.sin(entry_angle),0,path[0][1]+3.7*math.cos(entry_angle),entry_angle)
    for east in (-5.25,-2.35,2.35,5.25):
        top=6.25 if abs(east)<3 else 4.97
        model.box(east,0,0,.65,top,.72,'white',True);model.box(east,0,0,1.1,.5,1.2,'granite',True)
        model.box(east,top-.18,0,.8,.2,.86,'granite');model.box(east,top,0,.48,.35,.52,'white')
    for east,width,height in ((-3.8,3.25,3.8),(0,5.5,5.15),(3.8,3.25,3.8)):
        model.box(east,height-.66,0,width,.72,.65,'white');model.box(east,height+.12,0,width+.28,.19,.73,'white')
    model.box(0,4.53,-.39,2.15,.6,.18,'granite')
    for east in (-.56,0,.56):model.box(east,4.62,-.51,.18,.37,.09,'gold')


if __name__=='__main__':generate('dongxixiang',frontage)
