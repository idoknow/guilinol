import argparse
import gzip
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely import STRtree, intersects_xy, unary_union
from shapely.geometry import box, Point, Polygon

from common import CHUNK, GRID, LAT0, LON0, MLON, MLAT, OUT, ll2xz, load_dem
from features import building_mesh, buildings, game_court, ground_features, polygons
from karst import generate
from landmarks.jiefang_layout import bank_paving, grade_banks
from bridges import bridge_tiles
from scatter import CONFIG, scatter
from streets import chunks as street_chunks
from atlas import write_atlas
from vehicles import plan_vehicles, write_vehicles
from clearance import landmark_triangles
from bridgeheads import raise_approaches
from shoreline import correct_water, contour_ronghu
from landmark_layout import Layout

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
    layout = Layout()
    layers = ground_features(bounds,layout.school_grounds)
    surface = np.full_like(terrain, DRY)
    texture = Image.new('RGB',(width,depth),palette['ground'])
    for region in layout.school_grounds:
        for part in polygons(region.intersection(bounds)):
            for surface_area, color in ((part, palette['green']), (part.buffer(-3), '#bdbcb5')):
                for paved in polygons(surface_area):
                    mask, corner = stencil(paved,left,top,1)
                    texture.paste(color,corner,mask)
    for layer, features in layers.items():
        for poly in features:
            mask, corner = stencil(poly,left,top,1)
            texture.paste(palette[layer],corner,mask)
            if layer == 'water':
                mask, (col,row) = stencil(poly,left,top,GRID)
                patch = surface[row:row+mask.height,col:col+mask.width]
                wet = intersects_xy(poly, left+(col+np.arange(patch.shape[1]))*GRID,
                                    top+(row+np.arange(patch.shape[0])[:,None])*GRID)
                if wet.any():
                    patch[wet] = round(np.median(terrain[row:row+patch.shape[0],col:col+patch.shape[1]][wet]))
    wet = surface != DRY
    previous_bed = np.where(wet,np.minimum(terrain,surface-20),terrain)
    output.mkdir(parents=True, exist_ok=True)
    original = previous_bed.copy()
    mountain_trees = []
    peaks, peak_shapes = generate(original,terrain,left,top,bbox,output,wet,mountain_trees,CONFIG['peakAreaPerTree'])
    for region,level in layout.flatten:
        for part in polygons(region.intersection(bounds)):
            mask,(col,row) = stencil(part,left,top,GRID)
            for field in (terrain,original):
                patch = field[row:row+mask.height,col:col+mask.width]
                patch[np.asarray(mask,dtype=bool)[:patch.shape[0],:patch.shape[1]]] = round(level*10)
    correct_water(surface, terrain, original, bounds, stencil)
    terrain[wet]=original[wet]=np.minimum(terrain[wet],surface[wet]-20)
    contour_ronghu(surface, terrain, original, bounds)
    interchange=None
    bank_pavement=None
    west_portal=None
    for x,z,entry in layout.entries:
        if entry['id']=='jiefang_bridge' and bounds.covers(Point(x,z)):
            datum=previous_bed[round((z-top)/GRID),round((x-left)/GRID)]/10
            angle=-np.deg2rad(entry['rotation'])
            bank_pavement=bank_paving((x,z),angle)
            axes=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
            corners=np.array([[-136,-21.5],[-103,-21.5],[-103,21.5],[-136,21.5]])
            west_portal=Polygon(corners@axes+[x,z])
            interchange=((x,z),angle,bank_pavement)
            grade_banks(terrain,original,wet,left,top,GRID,(x,z),angle,datum)
    footprints, heights = buildings(bounds, elevation, STRtree(peak_shapes),layout)
    def sample(east,south):
        row = min(depth//GRID,max(0,round((south-top)/GRID)))
        col = min(width//GRID,max(0,round((east-left)/GRID)))
        return terrain[row,col]/10,surface[row,col]
    candidates=plan_vehicles(bounds,surface,layers['road'],footprints,sample)['routes']
    raised=raise_approaches(bounds,candidates,sample,terrain,original,wet)
    if raised:
        footprints, heights = buildings(bounds, elevation, STRtree(peak_shapes),layout)
    index = STRtree(footprints)
    for campus in layout.allow_unmapped_court:
        if not bounds.covers(campus) or any(campus.covers(field.representative_point())
                for layer in ('schoolTrack','schoolCourt') for field in layers[layer]):
            continue
        court = game_court(campus,[footprints[key] for key in index.query(campus)])
        if court is not None:
            mask,corner = stencil(court,left,top,1)
            texture.paste(palette['schoolCourt'],corner,mask)
    trees, roads, banks, tree_stats = scatter(bounds,footprints,layers['water'],peak_shapes,elevation,mountain_trees,unary_union([layout.tree_exclude,*(court.buffer(1.5) for court in layers['schoolTrack']+layers['schoolCourt'])]))
    for road in roads:
        for part in polygons(road.line.buffer(road.width/2,quad_segs=2).intersection(bounds)):
            mask,corner = stencil(part,left,top,1)
            texture.paste('#484b4d' if road.name=='翊武路' else palette['road'],corner,mask)
            layers['road'].append(part)
    report = []
    for road in roads:
        if road.name not in ('中山中路','解放东路','解放西路','滨江路','依仁路','榕湖北路','杉湖北路','正阳步行街') or not bounds.intersects(road.line):
            continue
        mid = road.line.length/2
        anchor = road.line.interpolate(mid)
        ahead = road.line.interpolate(mid+1)
        report.append(dict(way=road.way,samples=[[round(LON0+x/MLON,7),round(LAT0-z/MLAT,7),round(gap,1)] for x,z,gap in road.samples],name=road.name,kind=road.kind,lanes=road.lanes,width=round(road.width,1),
            frontage=round(road.frontage,1) if road.frontage else None,source=road.source,
            length=round(road.line.length),x=anchor.x,z=anchor.y,yaw=math.atan2(anchor.x-ahead.x,anchor.y-ahead.y)))
    (output/'street-report.json').write_text(json.dumps(report,ensure_ascii=False))
    print('Vegetation:',dict(sorted(tree_stats.items())))
    vehicles=plan_vehicles(bounds,surface,layers['road'],footprints,sample,interchange)
    decks, triangles = bridge_tiles(bounds,sample,vehicles['routes'],raised,west_portal)
    landmarks=[]
    for x,z,entry in layout.entries:
        height=sample(x,z)[0]
        if entry['id'] in ('jiefang_bridge','ronghu') and bounds.covers(Point(x,z)) and sample(x,z)[1]!=DRY:
            height=previous_bed[round((z-top)/GRID),round((x-left)/GRID)]/10
        landmarks.append(dict(position=[x,height,z],**entry))
    streets,lengths = street_chunks(roads,banks,bounds,layers['water'],sample,layout.exclude,bank_pavement)
    print('Lengths (m):',lengths)
    def asset(name):
        return {'file':name,'bytes':(output/name).stat().st_size}
    np.where(wet,surface,terrain)[::8,::8].astype('<i2').tofile(output/'overview.i16')
    np.where(wet,surface,original)[::8,::8].astype('<i2').tofile(output/'underlay.i16')
    texture.resize((width//4,depth//4), Image.Resampling.BOX).quantize(32).save(output/'overview.png', optimize=True)
    chunks = []
    for south in range(0,depth,CHUNK):
        for east in range(0,width,CHUNK):
            origin = (left+east,top+south)
            tile = box(*origin,origin[0]+CHUNK,origin[1]+CHUNK)
            parts = ((poly,heights[key]) for key in sorted(index.query(tile))
                     for poly in polygons(footprints[key].intersection(tile)) if poly.area >= .01)
            vertices, normals, indices, rings = building_mesh(parts, origin)
            deck,thin,asphalt = decks(tile,origin)
            collision = json.dumps([rings,streets(tile,origin),thin,asphalt],separators=(',',':')).encode()
            png = io.BytesIO()
            texture.crop((east,south,east+CHUNK,south+CHUNK)).save(png,format='PNG')
            image = png.getvalue()
            window = np.s_[south//GRID:south//GRID+65,east//GRID:east//GRID+65]
            underlay = original[window].tobytes() if np.any(original[window]!=terrain[window]) else b''
            header = struct.pack('<4s5I',b'GL04',len(vertices)//6,len(indices)//4,len(collision),len(image),len(deck)//18)
            name = f'{east//CHUNK}_{south//CHUNK}.glc'
            payload = header+terrain[window].tobytes()+surface[window].tobytes()+vertices+normals+indices+collision+image+deck
            (output/name).write_bytes(gzip.compress(payload+underlay,compresslevel=5,mtime=0))
            (output/name.replace('.glc','.trees')).write_bytes(gzip.compress(trees[origin],mtime=0))
            chunks.append(dict(x=origin[0],z=origin[1],**asset(name)))
    extent = [left,top,width,depth]
    write_atlas(output,extent,bounds,layers,footprints,peaks)
    triangles.extend(landmark_triangles(landmarks))
    write_vehicles(output,vehicles,triangles)
    manifest = dict(version=4,bbox=bbox,origin=[LAT0,LON0],extent=extent,chunkSize=CHUNK,peaks=peaks,atlas=asset('atlas.bin'),
                    vehicles=asset('vehicles.bin'),grid=GRID,overview=dict(step=32, heights=asset('overview.i16'),underlay=asset('underlay.i16'),texture=asset('overview.png')),chunks=chunks)
    manifest['landmarks'] = landmarks
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(f'{len(chunks)} chunks, {len(footprints)} footprints, {sum(c["bytes"] for c in chunks):,} chunk bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bbox',type=float,nargs=4,default=[25.250,110.278,25.302,110.312])
    parser.add_argument('--output',type=Path,default=Path(OUT))
    parser.add_argument('--palette',type=Path,default=Path(__file__).with_name('palette.json'))
    args = parser.parse_args()
    build(args.bbox,args.output,json.loads(args.palette.read_text()))
