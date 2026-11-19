"""Oblique inspection plates: shipped LOD0 triangles and independent OSM lines."""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point

from audit_landmarks import ROOT, visible_triangles
from features import area, points, load_osm


def main():
    osm={f"{item['type']}/{item['id']}":item for item in load_osm()}
    entries={item['id']:item for item in json.loads((ROOT/'public/world/manifest.json').read_text())['landmarks']}
    roads=[points(item) for item in osm.values() if item.get('tags',{}).get('highway') and item['type']=='way']
    out=Path('captures/landmark-overlay');out.mkdir(exist_ok=True,parents=True)
    font=ImageFont.truetype('NotoSansCJK-Regular.ttc',20)
    for spec in json.loads((ROOT/'pipeline/landmarks.json').read_text()):
        key=spec['id']
        if key not in ('zhuangyuan_gallery','xiaoyao_tower','glmu_dongcheng','glut_primary','tianjiabing','chenshan_primary','lijiang_primary','longyin_primary'):continue
        ref=area(osm[spec.get('schematicCampus',spec['anchor'])]);center=ref.centroid
        span=max(95,ref.bounds[2]-ref.bounds[0],ref.bounds[3]-ref.bounds[1]);scale=530/span
        def project(east,south,height=0):
            dx,dz=east-center.x,south-center.y
            return (410+scale*(dx*.94-dz*.34),305+scale*(.6*(dx*.34+dz*.94)-.8*height))
        image=Image.new('RGB',(820,570),'#f3f4f1');draw=ImageDraw.Draw(image)
        for road in roads:
            if len(road)>1 and any(Point(p).distance(center)<span for p in road):
                draw.line([project(*p) for p in road],fill='#929794',width=3)
        entry=entries.get(key)
        if entry:
            triangles=visible_triangles(ROOT/'public'/entry['file']).astype(float)
            angle=math.radians(entry['rotation']);cos,sin=math.cos(angle),math.sin(angle)
            local=triangles[:,:,::2].copy();triangles[:,:,0]=entry['position'][0]+local[:,:,0]*cos+local[:,:,1]*sin
            triangles[:,:,2]=entry['position'][2]-local[:,:,0]*sin+local[:,:,1]*cos
            depth=triangles.mean(axis=1)@np.array([.34*.8,.6,.94*.8])
            normal=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]);length=np.maximum(np.linalg.norm(normal,axis=1),1e-8)
            shade=(115+65*np.abs(normal@np.array([.3,.85,.42]))/length).astype(int)
            for index in np.argsort(depth):
                tone=int(shade[index]);draw.polygon([project(x,z,y) for x,y,z in triangles[index]],fill=(tone-50,tone-12,tone))
        draw.line([project(*p) for p in ref.exterior.coords],fill='#db692c',width=2)
        draw.rectangle((0,0,820,58),fill='white');draw.text((12,2),spec['name'],font=font,fill='black')
        draw.text((12,29),'橙：OSM 参照边界   灰：OSM 路网   蓝：成品地标几何（无牌不画）',font=font,fill='#444444')
        image.save(out/f'{key}.png')


if __name__=='__main__':main()
