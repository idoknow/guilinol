"""Bake deterministic grass origins on labeled lawn and verge surfaces only."""
import gzip
import io
import json
import struct

import numpy as np
from PIL import Image
from shapely import Polygon, STRtree, box, intersects_xy, make_valid, union_all
from shapely.affinity import translate

from common import load_osm
from features import area, polygons


def bake_grass(world):
    manifest = json.loads((world/'manifest.json').read_bytes())
    lawns, other = [], []
    for element in load_osm():
        if element['type'] == 'node':
            continue
        tags = element.get('tags', {})
        if tags.get('landuse') in ('grass','meadow','village_green') or tags.get('natural') == 'grassland' or tags.get('leisure') == 'park':
            lawns.extend(polygons(area(element)))
        elif tags.get('natural') in ('wood','water','scrub','wetland') or tags.get('landuse') == 'forest' or tags.get('leisure') in ('pitch','playground'):
            other.extend(polygons(area(element)))
    lawns, other = STRtree(lawns), STRtree(other)
    counts = {}
    for tile in manifest['chunks']:
        west, north = tile['x'], tile['z']
        boundary = box(west,north,west+256,north+256)
        raw = gzip.decompress((world/tile['file']).read_bytes())
        vertices, indices, size, image_size, decks = struct.unpack_from('<5I',raw,4)
        start = 24+16900+vertices*9+indices*4
        collision = json.loads(raw[start:start+size])
        streets = collision[1]; paths = streets[0]+(streets[19] if len(streets)>19 else [])
        verges = [make_valid(Polygon(shell, holes)) for kind,shell,*holes in paths if kind==4]
        hits = lawns.query(boundary,predicate='intersects')
        if not len(hits) and not verges:
            continue
        lawn = translate(union_all(lawns.geometries.take(hits)).intersection(boundary), -west, -north)
        others = other.query(boundary,predicate='intersects')
        if len(others):
            lawn = lawn.difference(translate(union_all(other.geometries.take(others)), -west, -north))
        rng = np.random.default_rng([west & 0xffffffff, north & 0xffffffff])
        row, col = np.mgrid[:128,:128]
        east, south = (col.ravel()+rng.uniform(.1,.9,col.size))*2, (row.ravel()+rng.uniform(.1,.9,row.size))*2
        image_at = start+size
        pixels = np.asarray(Image.open(io.BytesIO(raw[image_at:image_at+image_size])).convert('RGB'))
        green = (pixels[south.astype(int),east.astype(int)] == [138,163,124]).all(axis=1)
        on_verge = intersects_xy(union_all(verges).buffer(-12),east*100,south*100)
        keep = (intersects_xy(lawn,east,south) & green) | on_verge
        if not keep.any():
            continue
        east, south, on_verge = east[keep], south[keep], on_verge[keep]
        blocked = [make_valid(Polygon(shell,holes)) for kind,shell,*holes in paths if kind!=4]
        blocked.extend(make_valid(Polygon(item[2][0],item[2][1:])) for item in collision[0] if item[2])
        tris = np.frombuffer(raw,'<i2',decks*9,image_at+image_size).reshape(-1,3,3)
        blocked.extend(Polygon(tri[:,[0,2]]) for tri in tris)
        keep = ~intersects_xy(union_all([shape for shape in blocked if shape.area]).buffer(15),east*100,south*100)
        east,south,on_verge = east[keep],south[keep],on_verge[keep]
        if not len(east):
            continue
        terrain = np.frombuffer(raw,'<i2',65**2,24).reshape(65,65)
        tail = image_at+image_size+decks*18
        if len(raw)-tail == 8450:
            terrain = np.frombuffer(raw,'<i2',65**2,tail).reshape(65,65)
        water = np.frombuffer(raw,'<i2',65**2,24+8450).reshape(65,65)
        step = 4 if np.any(water != -32768) else 8
        grid = terrain[::step//4,::step//4]
        col,row = (east/step).astype(int),(south/step).astype(int)
        u,v = east/step-col,south/step-row
        a,b,c,d = grid[row,col],grid[row,col+1],grid[row+1,col],grid[row+1,col+1]
        y = np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))/10
        if on_verge.any():
            if len(streets)>5 and streets[5]:
                from road_grading import eval_bspline_grid
                base,deltas=streets[5]
                y[on_verge]=np.maximum(y[on_verge],eval_bspline_grid((base+np.asarray(deltas)).reshape(35,35)/1000,0,0,east[on_verge],south[on_verge]))
            y[on_verge]+=.195
        data=np.column_stack((east*100,south*100,y*100)).round().astype('<i4')
        name=tile['file'].removesuffix('.glc')+'.grass'
        (world/name).write_bytes(gzip.compress(data.tobytes(),compresslevel=5,mtime=0))
        tile['grass']=name
        counts[name]=len(data)
    (world/'manifest.json').write_text(json.dumps(manifest,separators=(',', ':'))+'\n')
    return counts
