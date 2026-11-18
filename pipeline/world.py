import argparse
import gzip
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import STRtree
from shapely.geometry import box

from common import CHUNK, GRID, LAT0, LON0, OUT, ll2xz, load_dem
from features import building_mesh, buildings, ground_features, polygons
from karst import generate
from bridges import bridge_tiles
from scatter import CONFIG, scatter
from streets import chunks as street_chunks
from atlas import write_atlas
from vehicles import write_vehicles
from shoreline import report_water

DRY = -32768


def stencil(poly, west, north, step):
    left, top, right, bottom = poly.bounds
    col, row = math.floor((left-west)/step), math.floor((top-north)/step)
    size = (math.ceil((right-west)/step)-col+1, math.ceil((bottom-north)/step)-row+1)
    mask = Image.new('L', size)
    draw = ImageDraw.Draw(mask)
    for ring, fill in [(poly.exterior, 255), *((hole, 0) for hole in poly.interiors)]:
        draw.polygon([((east-west)/step-col, (south-north)/step-row) for east,south in ring.coords], fill)
    return mask, (col,row)


def build(bbox, output, palette):
    south, west, north, east = bbox
    if not (south < north and west < east):
        raise ValueError('Expected bbox: south west north east')
    start = np.floor(np.array(ll2xz(north, west))/CHUNK).astype(int)*CHUNK
    end = np.ceil(np.array(ll2xz(south, east))/CHUNK).astype(int)*CHUNK
    left, top = map(int,start)
    width, depth = map(int,end-start)
    terrain = np.rint(load_dem(np.arange(left,left+width+1,GRID),np.arange(top,top+depth+1,GRID))*10).astype('<i2')
    bounds = box(*start,*end)
    def elevation(east,south):
        row = np.clip(round((south-top)/GRID),0,depth//GRID)
        col = np.clip(round((east-left)/GRID),0,width//GRID)
        return original[row,col]/10
    layers = ground_features(bounds)
    surface = np.full_like(terrain, DRY)
    texture = Image.new('RGB',(width,depth),palette['ground'])
    for layer, features in layers.items():
        for poly in features:
            mask, corner = stencil(poly,left,top,1)
            texture.paste(palette[layer],corner,mask)
            if layer == 'water':
                mask, (col,row) = stencil(poly,left,top,GRID)
                patch = surface[row:row+mask.height,col:col+mask.width]
                wet = np.asarray(mask,dtype=bool)[:patch.shape[0],:patch.shape[1]]
                if wet.any():
                    patch[wet] = round(np.median(terrain[row:row+patch.shape[0],col:col+patch.shape[1]][wet]))
    wet = surface != DRY
    report_water(surface, terrain, bounds, stencil)
    terrain[wet] = np.minimum(terrain[wet],surface[wet]-20)
    output.mkdir(parents=True, exist_ok=True)
    original = terrain.copy()
    mountain_trees = []
    peaks, peak_shapes = generate(original,terrain,left,top,bbox,output,wet,mountain_trees,CONFIG['peakAreaPerTree'])
    footprints, heights = buildings(bounds, elevation, STRtree(peak_shapes))
    index = STRtree(footprints)
    trees, roads, banks, tree_stats = scatter(bounds,footprints,layers['water'],peak_shapes,elevation,mountain_trees)
    print('Vegetation:',dict(sorted(tree_stats.items())))
    def sample(east,south):
        row = min(depth//GRID,max(0,round((south-top)/GRID)))
        col = min(width//GRID,max(0,round((east-left)/GRID)))
        return terrain[row,col]/10,surface[row,col]
    decks = bridge_tiles(bounds,sample)
    streets,lengths = street_chunks(roads,banks,bounds,layers['water'],sample)
    print('Lengths (m):',lengths)
    def asset(name):
        return {'file':name,'bytes':(output/name).stat().st_size}
    np.where(wet,surface,terrain)[::8,::8].astype('<i2').tofile(output/'overview.i16')
    np.where(wet,surface,original)[::8,::8].astype('<i2').tofile(output/'underlay.i16')
    texture.resize((width//4,depth//4), Image.Resampling.BOX).quantize(32).save(output/'overview.png')
    chunks = []
    for south in range(0,depth,CHUNK):
        for east in range(0,width,CHUNK):
            origin = (left+east,top+south)
            tile = box(*origin,origin[0]+CHUNK,origin[1]+CHUNK)
            parts = ((poly,heights[key]) for key in sorted(index.query(tile))
                     for poly in polygons(footprints[key].intersection(tile)) if poly.area >= .01)
            vertices, normals, indices, rings = building_mesh(parts, origin)
            collision = json.dumps([rings,streets(tile,origin)],separators=(',',':')).encode()
            png = io.BytesIO()
            texture.crop((east,south,east+CHUNK,south+CHUNK)).save(png,format='PNG')
            image = png.getvalue()
            window = np.s_[south//GRID:south//GRID+65,east//GRID:east//GRID+65]
            underlay = original[window].tobytes() if np.any(original[window]!=terrain[window]) else b''
            deck = decks(tile,origin)
            header = struct.pack('<4s5I',b'GL04',len(vertices)//6,len(indices)//4,len(collision),len(image),len(deck)//18)
            name = f'{east//CHUNK}_{south//CHUNK}.glc'
            payload = header+terrain[window].tobytes()+surface[window].tobytes()+vertices+normals+indices+collision+image+deck
            (output/name).write_bytes(gzip.compress(payload+underlay,compresslevel=5,mtime=0))
            (output/name.replace('.glc','.trees')).write_bytes(gzip.compress(trees[origin],mtime=0))
            chunks.append(dict(x=origin[0],z=origin[1],**asset(name)))
    extent = [left,top,width,depth]
    write_atlas(output,extent,bounds,layers,footprints,peaks)
    write_vehicles(output,bounds,surface,layers['road'],footprints,sample)
    manifest = dict(version=4,bbox=bbox,origin=[LAT0,LON0],extent=extent,chunkSize=CHUNK,peaks=peaks,atlas=asset('atlas.bin'),
                    vehicles=asset('vehicles.bin'),grid=GRID,overview=dict(step=32, heights=asset('overview.i16'),underlay=asset('underlay.i16'),texture=asset('overview.png')),chunks=chunks)
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(f'{len(chunks)} chunks, {len(footprints)} footprints, {sum(c["bytes"] for c in chunks):,} chunk bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bbox',type=float,nargs=4,default=[25.250,110.278,25.302,110.312])
    parser.add_argument('--output',type=Path,default=Path(OUT))
    parser.add_argument('--palette',type=Path,default=Path(__file__).with_name('palette.json'))
    args = parser.parse_args()
    build(args.bbox,args.output,json.loads(args.palette.read_text()))
