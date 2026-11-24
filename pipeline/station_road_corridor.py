"""Keep the station service street and its roadbed continuous to the curb."""
import gzip
import json
import struct
from pathlib import Path

from PIL import ImageColor

import numpy as np
from shapely import LineString, Polygon, box, constrained_delaunay_triangles
from shapely.affinity import translate
from shapely.geometry.polygon import orient

from common import ll2xz
from road_grading import eval_bspline_grid
from service_streets import patch_tile, width


def bake(output, chunks, ways):
    way = next((w for w in ways if w['type']=='way' and w['id']==1017598912), None)
    if not way:
        return
    palette=json.loads(Path(__file__).with_name('palette.json').read_text())
    axis = LineString([ll2xz(p['lat'],p['lon']) for p in way['geometry']])
    corridor = axis.buffer(width(way['tags'])/2+.5, quad_segs=6)
    for tile in chunks:
        x,z=tile['x'],tile['z']
        if not corridor.intersects(box(x,z,x+256,z+256)):
            continue
        area=translate(corridor,xoff=-x,yoff=-z).intersection(box(0,0,256,256))
        file=output/tile['file']
        patch_tile(file,area,ImageColor.getrgb(palette['road']))
        raw=gzip.decompress(file.read_bytes())
        verts,indices,size,image,deck=struct.unpack_from('<5I',raw,4)
        offset=24+16900+9*verts+4*indices
        collision=json.loads(raw[offset:offset+size])
        control=collision[1][5]
        ctrl=(control[0]+np.array(control[1]).reshape(35,35))/1000
        tail=offset+size+image+18*deck
        ground=np.frombuffer(raw,'<i2',4225,tail if len(raw)>tail else 24).reshape(65,65)/10
        step=4 if np.any(np.frombuffer(raw,'<i2',4225,8474)!=-32768) else 8
        drop,vertices=[],[]
        def emit(points):
            vertices.extend([[round(x,4),round(y,4),round(z,4)] for x,y,z in points])
        xmin,zmin,xmax,zmax=area.bounds
        for row in range(int(zmin//step),min(256//step,int(zmax//step)+1)):
            for col in range(int(xmin//step),min(256//step,int(xmax//step)+1)):
                a=(col*step,row*step);b=(a[0],a[1]+step);c=(b[0]+step,b[1]);d=(c[0],a[1])
                for face,corners in enumerate(((a,b,d),(b,c,d))):
                    poly=Polygon(corners)
                    inside=poly.intersection(area)
                    if inside.area<1e-7:
                        continue
                    drop.append((row*(256//step)+col)*2+face)
                    plane=np.linalg.solve([[u,v,1] for u,v in corners],[ground[v//4,u//4] for u,v in corners])
                    def old(u,v):return float(plane@[u,v,1])
                    def bed(u,v):return float(eval_bspline_grid(ctrl,0,0,np.asarray(u),np.asarray(v)))-.03
                    for shape,level in ((poly.difference(area),old),(inside,bed)):
                        for tri in constrained_delaunay_triangles(shape).geoms:
                            emit([(u,level(u,v),v) for u,v in list(orient(tri,sign=-1).exterior.coords)[:3]])
                    edge=poly.intersection(area.boundary)
                    for line in getattr(edge,'geoms',[edge]):
                        if line.geom_type!='LineString':continue
                        for (u,v),(s,t) in zip(line.coords,list(line.coords)[1:]):
                            lo=(u,bed(u,v),v);hi=(u,old(u,v),v)
                            end=(s,bed(s,t),t);rim=(s,old(s,t),t)
                            emit((lo,hi,end,end,hi,rim))
        while len(collision)<4:collision.append([])
        collision[4:5]=[dict(drop=drop,vertices=vertices)]
        data=json.dumps(collision,separators=(',',':')).encode()
        file.write_bytes(gzip.compress(raw[:12]+struct.pack('<I',len(data))+raw[16:offset]+data+raw[offset+size:],mtime=0))
        tile['bytes']=file.stat().st_size
