"""Generate shore stations from the installed GL04 world, not runtime guesses."""
import gzip
import json
import math
import struct
from pathlib import Path

import numpy as np
from shapely import Point, Polygon, STRtree, union_all, shortest_line
from functools import lru_cache

world = Path('public/world')
manifest = json.loads((world / 'manifest.json').read_text())
anchors = [
    ('lijiang_xiangbi', '漓江·象鼻山段', -670, 1110),
    ('lijiang_jiefang', '漓江·解放桥段', -135, -90),
    ('lijiang_fubo', '漓江·伏波山段', 70, -705),
    ('taohuajiang', '桃花江', -1180, 1090),
    ('ronghu', '榕湖', -1360, 300), ('shanhu', '杉湖', -1030, 450),
    ('guihu', '桂湖', -1510, -270), ('mulonghu', '木龙湖', -470, -1640),
    ('xiaodongjiang', '小东江·花桥段', 405, 350),
    ('lijiang_diecai', '漓江·叠彩山段', 130, -1470),
]


def candidates(tile):
    raw = gzip.decompress((world / tile['file']).read_bytes())
    assert raw[:4] == b'GL04'
    vertices, indices, size, image_size, triangles = struct.unpack_from('<IIIII', raw, 4)
    terrain, water = np.frombuffer(raw, '<i2', 8450, 24).reshape(2, 65, 65)
    start = 24 + 16900 + 9 * vertices + 4 * indices
    buildings, streets, *_ = json.loads(raw[start:start + size])
    faces = [entry[2][0] for entry in buildings if entry[2]]
    faces.extend(path[1] for path in streets[0] if len(path) > 1)
    deck = np.frombuffer(raw, '<i2', triangles * 9, start + size + image_size)
    faces.extend(deck.reshape(-1, 3, 3)[:, :, ::2])
    excluded = STRtree([Polygon(ring) for ring in faces if len(ring) >= 3])
    for row, col in zip(*np.where(water == -32768)):
        if not (4 <= row <= 60 and 4 <= col <= 60):
            continue
        if (water[row-1:row+2, col-1:col+2] != -32768).any():
            continue
        nearby = terrain[row-1:row+2, col-1:col+2]
        if int(nearby.max()) - int(nearby.min()) > 12:
            continue
        wet = np.argwhere(water[row-4:row+5, col-4:col+5] != -32768)
        if not len(wet):
            continue
        if len(excluded.query(Point(col*400, row*400), predicate='dwithin', distance=320)):
            continue
        offset = min(wet - 4, key=lambda delta: int(delta @ delta))
        dz, dx = map(int, offset * 4)
        px, pz = int(col*4 + tile['x']), int(row*4 + tile['z'])
        yield dict(x=px, z=pz, yaw=round(math.atan2(dx, dz), 5),
                   target=[px+dx, int(water[row+offset[0], col+offset[1]])/10, pz+dz])


@lru_cache(None)
def stele_tile(file):
    raw = gzip.decompress((world / file).read_bytes())
    vertices, indices, size, image, triangles = struct.unpack_from('<IIIII', raw, 4)
    bed, water = np.frombuffer(raw, '<i2', 8450, 24).reshape(2, 65, 65)
    start = 16924 + vertices * 9 + indices * 4
    buildings, streets, *_ = json.loads(raw[start:start+size])
    faces = [b[2][0] for b in buildings if b[2]] + [p[1] for p in streets[0] if len(p)>1]
    faces.extend(np.frombuffer(raw, '<i2', triangles*9, start+size+image).reshape(-1,3,3)[:,:,::2])
    tail=start+size+image+triangles*18
    if len(raw)>tail:
        bed=np.frombuffer(raw,'<i2',4225,tail).reshape(65,65)
    obstacles = [Polygon(np.array(face)/100) for face in faces if len(face)>=3]
    trees = gzip.decompress((world / file.replace('.glc','.trees')).read_bytes())
    obstacles.extend(Point(tx/100,tz/100) for tx,tz in struct.iter_unpack('<HH8x',trees))
    wet_faces = []
    for row,col in zip(*np.where((water[:-1,:-1]!=-32768)|(water[1:,:-1]!=-32768)|(water[:-1,1:]!=-32768)|(water[1:,1:]!=-32768))):
        for offsets in [[(0,0),(1,0),(0,1)],[(0,1),(1,0),(1,1)]]:
            corners=[(row+dr,col+dc) for dr,dc in offsets]
            levels=[water[at] for at in corners if water[at]!=-32768]
            if not levels: continue
            depths=[int(water[at] if water[at]!=-32768 else min(levels))-int(bed[at]) for at in corners]
            clipped=[]
            for index,(rr,cc) in enumerate(corners):
                other=(index+1)%3
                if depths[index]>0: clipped.append((cc*4,rr*4))
                if (depths[index]>0)!=(depths[other]>0):
                    fraction=depths[index]/(depths[index]-depths[other]); nr,nc=corners[other]
                    clipped.append(((cc+fraction*(nc-cc))*4,(rr+fraction*(nr-rr))*4))
            if len(clipped)>=3: wet_faces.append(Polygon(clipped))
    return bed,STRtree(obstacles),STRtree(wet_faces)


def place_steles(banks):
    for bank in banks:
        tile=next(t for t in manifest['chunks'] if t['x']<=bank['x']<t['x']+256 and t['z']<=bank['z']<t['z']+256)
        bed,obstacles,wet=stele_tile(tile['file']); options=[]
        for dz in range(-9,10):
            for dx in range(-9,10):
                x,z=bank['x']+dx,bank['z']+dz; lx,lz=x-tile['x'],z-tile['z']
                if min(lx,lz,256-lx,256-lz)<10 or any(math.hypot(x-b['x'],z-b['z'])<3 for b in banks): continue
                point=Point(lx,lz); terrain=bed[(lz-1)//4:(lz+1)//4+2,(lx-1)//4:(lx+1)//4+2]
                if np.ptp(terrain) > 3 or len(obstacles.query(point,predicate='dwithin',distance=2)): continue
                nearest=wet.nearest(point)
                if nearest is None: continue
                line=shortest_line(point,wet.geometries[nearest]); distance=line.length
                if not 3.7<=distance<=7.3: continue
                wx,wz=line.coords[-1]; yaw=round(math.atan2(wx-lx,wz-lz),5)
                row,col=lz//4,lx//4; u,v=lx%4/4,lz%4/4
                a,b=bed[row,col:col+2]; c,d=bed[row+1,col:col+2]
                height=(a+(b-a)*u+(c-a)*v if u+v<=1 else d+(c-d)*(1-u)+(b-d)*(1-v))/10
                here=dict(x=x,z=z,yaw=yaw,y=round(float(height),3))
                for first in options:
                    if 4.8<=math.hypot(first['x']-x,first['z']-z)<=5.2 and math.cos(first['yaw']-yaw)>.94:
                        return [dict(kind='zone',**first),dict(kind='global',**here)]
                options.append(here)
    raise ValueError(f'No verified stele pair near {banks[0]}')


output = []
cache = {}
for index, (key, name, x, z) in enumerate(anchors):
    near = []
    for tile in manifest['chunks']:
        if abs(tile['x']+128-x) > 385 or abs(tile['z']+128-z) > 385:
            continue
        if tile['file'] not in cache:
            cache[tile['file']] = list(candidates(tile))
        near.extend(cache[tile['file']])
    spot = min(near, key=lambda point: math.hypot(point['x']-x, point['z']-z))
    assert math.hypot(spot['x']-x, spot['z']-z) < 250, name
    banks = [spot]
    for point in sorted(near, key=lambda p: math.hypot(p['x']-spot['x'], p['z']-spot['z'])):
        if math.hypot(point['x']-spot['x'], point['z']-spot['z']) > 120:
            break
        if abs(point['target'][1]-spot['target'][1]) > .5:
            continue
        if all(math.hypot(point['x']-p['x'], point['z']-p['z']) >= 12 for p in banks):
            banks.append(point)
    region = union_all([Point(p['x'], p['z']).buffer(32, quad_segs=6) for p in banks])
    parts = region.geoms if region.geom_type == 'MultiPolygon' else [region]
    outlines = [[[[round(px, 2), round(pz, 2)] for px, pz in ring.coords]
                 for ring in [part.exterior, *part.interiors]] for part in parts]
    output.append(dict(id=key, name=name, spot=spot, radius=32, banks=banks, outlines=outlines, steles=place_steles(banks),
                       circle=dict(x=spot['target'][0], z=spot['target'][2], radius=24,
                                   color=['red', 'blue', 'green'][index % 3])))
Path('web/src/fishing/shores.json').write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
