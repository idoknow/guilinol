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
from shapely.geometry import box, Point

from common import CHUNK, GRID, LAT0, LON0, MLON, MLAT, OUT, ll2xz, load_dem, load_osm
from features import building_mesh, buildings, game_court, ground_features, points, polygons, raw_overture_footprints, rongyin_sidewalk
from karst import generate
from landmarks.jiefang_layout import bank_paving, grade_banks
from bridges import bridge_tiles
from road_grading import build_ground_mesh_lookup, eval_bspline_grid, solve_road_and_bridge_elevations
from scatter import CONFIG, extract_road_network, scatter
from streets import chunks as street_chunks
from atlas import write_atlas
from vehicles import plan_vehicles, write_vehicles
from clearance import landmark_triangles
from shoreline import correct_water
from landmark_layout import Layout
from shapely.geometry import LineString, Point, Polygon as ShapelyPolygon
from shapely.ops import unary_union

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
    wet = surface != DRY
    terrain[wet] = original[wet] = np.minimum(terrain[wet], surface[wet] - 20)

    interchange=None
    bank_pavement=None
    west_portal=None
    for x,z,entry in layout.entries:
        if entry['id']=='jiefang_bridge' and bounds.covers(Point(x,z)):
            x_jb, z_jb = x, z
            datum=previous_bed[round((z-top)/GRID),round((x-left)/GRID)]/10
            angle=-np.deg2rad(entry['rotation'])
            bank_pavement=bank_paving((x,z),angle)
            axes=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
            corners=np.array([[-136,-21.5],[-103,-21.5],[-103,21.5],[-136,21.5]])
            west_portal=ShapelyPolygon(corners@axes+[x,z])
            interchange=((x,z),angle,bank_pavement)
            grade_banks(terrain,original,wet,left,top,GRID,(x,z),angle,datum)

    def sample(east, south):
        row = min(depth // GRID, max(0, round((south - top) / GRID)))
        col = min(width // GRID, max(0, round((east - left) / GRID)))
        return terrain[row, col] / 10, surface[row, col]

    raw_foots = raw_overture_footprints(bounds)
    road_net = extract_road_network(raw_foots)
    _, roads, _, banks, _, ped_areas = road_net
    bridge_polys = []
    bus_pads = []
    for el in load_osm():
        tags = el.get('tags', {})
        if el['type'] == 'node' and tags.get('highway') == 'bus_stop':
            bus_pads.append(Point(ll2xz(el['lat'], el['lon'])).buffer(1.6, quad_segs=2))
        elif el['type'] == 'way' and tags.get('bridge', 'no') != 'no' and 'highway' in tags and len(points(el)) > 1:
            bw = {'footway':3,'path':3,'steps':3,'cycleway':3,'primary':14,'secondary':12,'trunk':18}.get(tags['highway'],10)
            bridge_polys.append(LineString(points(el)).buffer(bw/2, quad_segs=2))
    comp_excl = getattr(layout, 'compound_polygons', layout.replace_exclude)
    road_surfs = []
    sw_surfs = [*bus_pads, rongyin_sidewalk()]
    for pa in ped_areas:
        cpa = pa.difference(comp_excl) if not comp_excl.is_empty else pa
        if not cpa.is_empty:
            road_surfs.append(cpa)
    for road in roads:
        if not road.line.intersects(bounds):
            continue
        sp = road.line.buffer(road.width/2, quad_segs=2)
        if road.kind == 'pedestrian' and not comp_excl.is_empty:
            sp = sp.difference(comp_excl)
        if not sp.is_empty:
            road_surfs.append(sp)
        for side, extra in ((-1, road.left), (1, road.right)):
            if extra:
                sw_p = road.line.buffer(side*(road.width/2+extra), single_sided=True, quad_segs=2)
                if not comp_excl.is_empty:
                    sw_p = sw_p.difference(comp_excl)
                if not sw_p.is_empty:
                    sw_surfs.append(sw_p)
    carriageway_mask = unary_union([*road_surfs, *bridge_polys]).buffer(0.06)
    sidewalk_mask = unary_union(sw_surfs).difference(carriageway_mask).buffer(0.06)

    peak_tree = STRtree(peak_shapes)
    init_footprints, _ = buildings(bounds, elevation, peak_tree, layout, carriageway_mask, sidewalk_mask)
    candidate_routes = plan_vehicles(bounds, surface, layers['road'], init_footprints, sample)['routes']

    road_ctrl, bridge_plans, finalize_bridges = solve_road_and_bridge_elevations(
        original, terrain, surface, left, top, width, depth,
        roads, ped_areas, layout, Path(__file__).resolve().parents[1],
        vessel_routes=candidate_routes, previous_bed=previous_bed,
    )
    if interchange is not None:
        # Keep the terrain mesh below the modeled lower roadway after imprinting
        # the city road field. Include one mesh cell beyond the paving boundary.
        lower_road = LineString(np.array([[-122, -43], [-122, 43]]) @ axes + [x_jb, z_jb])
        cols = left + np.arange(terrain.shape[1]) * GRID
        rows = top + np.arange(terrain.shape[0]) * GRID
        dry = ~wet & intersects_xy(lower_road.buffer(9), cols[None, :], rows[:, None])
        for field in (original, terrain):
            field[dry] = np.minimum(field[dry], round((datum + .72) * 10))
    ground_mesh_at = build_ground_mesh_lookup(original, surface, left, top, width, depth)
    finalize_bridges(ground_mesh_at)

    sw_query_tree = STRtree(list(polygons(sidewalk_mask))) if not sidewalk_mask.is_empty else None
    def tree_support_at(east: float, south: float) -> float:
        gm = ground_mesh_at(east, south)
        if sw_query_tree and sw_query_tree.query(Point(east, south), predicate='intersects').size:
            rc = float(eval_bspline_grid(road_ctrl, left, top, np.array([east]), np.array([south]))[0])
            return max(rc, gm) + 0.195
        return gm

    footprints, heights = buildings(bounds, ground_mesh_at, peak_tree, layout, carriageway_mask, sidewalk_mask)
    index = STRtree(footprints)
    for campus in layout.allow_unmapped_court:
        if not bounds.covers(campus) or any(campus.covers(field.representative_point())
                for layer in ('schoolTrack','schoolCourt') for field in layers[layer]):
            continue
        court = game_court(campus,[footprints[key] for key in index.query(campus)])
        if court is not None:
            mask,corner = stencil(court,left,top,1)
            texture.paste(palette['schoolCourt'],corner,mask)
    trees, roads, banks, tree_stats = scatter(bounds, footprints, layers['water'], peak_shapes, tree_support_at, mountain_trees, layout.tree_exclude, precomputed=road_net, extra_blocked=[*(court.buffer(1.5) for court in layers["schoolTrack"] + layers["schoolCourt"]), *bridge_polys, *road_surfs])
    for road in roads:
        for part in polygons(road.line.buffer(road.width/2,quad_segs=2).intersection(bounds)):
            mask,corner = stencil(part,left,top,1)
            texture.paste('#484b4d' if road.name=='翊武路' else palette['road'],corner,mask)
            layers['road'].append(part)
    report = []
    for road in roads:
        if road.name not in ('中山中路','解放东路','解放西路','滨江路','依仁路','榕湖北路','杉湖北路','正阳步行街','榕荫路','三多路') or not bounds.intersects(road.line):
            continue
        mid = road.line.length/2
        anchor = road.line.interpolate(mid)
        ahead = road.line.interpolate(mid+1)
        report.append(dict(way=road.way,samples=[[round(LON0+x/MLON,7),round(LAT0-z/MLAT,7),round(gap,1)] for x,z,gap in road.samples],name=road.name,kind=road.kind,lanes=road.lanes,width=round(road.width,1),
            frontage=round(road.frontage,1) if road.frontage else None,source=road.source,
            length=round(road.line.length),x=anchor.x,z=anchor.y,yaw=math.atan2(anchor.x-ahead.x,anchor.y-ahead.y)))
    (output/'street-report.json').write_text(json.dumps(report,ensure_ascii=False))
    print('Vegetation:',dict(sorted(tree_stats.items())))
    peak_centers = {p['name']: p['center'] for p in peaks['entries']}
    peak_lm_names = {'fubo': '伏波山', 'diecai': '明月峰', 'duxiu': '独秀峰'}
    def lm_elevation(x, z, entry):
        if entry['id'] in peak_lm_names and peak_lm_names[entry['id']] in peak_centers:
            px_c, _, pz_c = peak_centers[peak_lm_names[entry['id']]]
            return sample(px_c, pz_c)[0]
        terr_y, surf_y = sample(x, z)
        if surf_y != DRY:
            if entry['id'] in ('jiefang_bridge', 'ronghu') and bounds.covers(Point(x, z)):
                return float(previous_bed[round((z - top) / GRID), round((x - left) / GRID)]) / 10.0
            if entry['id'] == 'shanhu_pagodas':
                return float(surf_y) / 10.0
            return terr_y
        gm_y = ground_mesh_at(x, z)
        fl = entry.get('flatten')
        if isinstance(fl, dict) and 'elevation' in fl and entry['id'] in ('zhengyang', 'dongxixiang', 'jingjiang'):
            return round(max(gm_y, float(fl['elevation'])), 2)
        return round(gm_y, 2)
    landmarks = [dict(position=[x, lm_elevation(x, z, entry), z], **entry) for x, z, entry in layout.entries]
    landmark_faces = list(landmark_triangles(landmarks))
    vehicles = plan_vehicles(bounds, surface, layers['road'], footprints, sample, landmark_faces, interchange=interchange)
    decks, triangles = bridge_tiles(bounds, sample, vehicles['routes'], (), bridge_plans, west_portal=west_portal)
    streets,lengths = street_chunks(roads,banks,bounds,layers['water'],sample,layout.exclude,ped_areas,comp_excl,road_ctrl,(left,top),ground_mesh_at,footprints,modeled_paving=bank_pavement)
    (output/'marking-audit.json').write_text(json.dumps(lengths.pop('markingOverlap')))
    print('Lengths (m):',lengths)
    def asset(name):
        return {'file':name,'bytes':(output/name).stat().st_size}
    np.where(wet,surface,terrain)[::8,::8].astype('<i2').tofile(output/'overview.i16')
    np.where(wet,surface,original)[::8,::8].astype('<i2').tofile(output/'underlay.i16')
    texture.resize((width//4,depth//4), Image.Resampling.BOX).quantize(32).save(output/'overview.png', optimize=True)
    u_peaks_buf = unary_union(peak_shapes).buffer(1.0) if peak_shapes else ShapelyPolygon()
    chunks = []
    for south in range(0,depth,CHUNK):
        for east in range(0,width,CHUNK):
            origin = (left+east,top+south)
            tile = box(*origin,origin[0]+CHUNK,origin[1]+CHUNK)
            parts = ((poly,heights[key]) for key in sorted(index.query(tile))
                     for poly in polygons(footprints[key].intersection(tile)) if poly.area >= .01)
            vertices, normals, indices, rings = building_mesh(parts, origin)
            deck, thin, asphalt = decks(tile, origin)
            st_data = streets(tile, origin)
            collision = json.dumps([rings, st_data, thin, asphalt], separators=(',', ':')).encode()
            tbuf = trees[origin]
            if tbuf:
                sw_tile_polys, rd_tile_polys = [], []
                for s_item in st_data[0]:
                    skind, ext, *holes = s_item
                    if skind not in (0, 1) or len(ext) < 3:
                        continue
                    ext_w = [(origin[0] + p[0] / 100.0, origin[1] + p[1] / 100.0) for p in ext]
                    holes_w = [[(origin[0] + p[0] / 100.0, origin[1] + p[1] / 100.0) for p in h] for h in holes if len(h) >= 3]
                    sp = ShapelyPolygon(ext_w, holes_w).buffer(0)
                    if not sp.is_empty:
                        (sw_tile_polys if skind == 1 else rd_tile_polys).append(sp)
                u_sw_tile = unary_union(sw_tile_polys) if sw_tile_polys else ShapelyPolygon()
                u_rd_tile = unary_union(rd_tile_polys) if rd_tile_polys else ShapelyPolygon()
                n_trees = len(tbuf) // 12
                tx_arr = np.empty(n_trees, dtype=np.float64)
                tz_arr = np.empty(n_trees, dtype=np.float64)
                for ti in range(n_trees):
                    lx_cm, lz_cm = struct.unpack_from('<HH', tbuf, ti * 12)
                    tx_arr[ti] = origin[0] + lx_cm / 100.0
                    tz_arr[ti] = origin[1] + lz_cm / 100.0
                rc_vals = eval_bspline_grid(road_ctrl, left, top, tx_arr, tz_arr)
                for ti in range(n_trees):
                    wx, wz = float(tx_arr[ti]), float(tz_arr[ti])
                    pt_w = Point(wx, wz)
                    if not u_peaks_buf.is_empty and u_peaks_buf.contains(pt_w):
                        continue
                    gm_w = ground_mesh_at(wx, wz)
                    rb_w = max(float(rc_vals[ti]), gm_w)
                    sup_w = (rb_w + 0.195) if u_sw_tile.covers(pt_w) else (rb_w + 0.045) if u_rd_tile.covers(pt_w) else gm_w
                    struct.pack_into('<h', tbuf, ti * 12 + 4, round(10.0 * sup_w))
            png = io.BytesIO()
            texture.crop((east,south,east+CHUNK,south+CHUNK)).save(png,format='PNG')
            image = png.getvalue()
            window = np.s_[south//GRID:south//GRID+65,east//GRID:east//GRID+65]
            underlay = original[window].tobytes() if np.any(original[window]!=terrain[window]) else b''
            header = struct.pack('<4s5I',b'GL04',len(vertices)//6,len(indices)//4,len(collision),len(image),len(deck)//18)
            name = f'{east//CHUNK}_{south//CHUNK}.glc'
            payload = header+terrain[window].tobytes()+surface[window].tobytes()+vertices+normals+indices+collision+image+deck
            (output/name).write_bytes(gzip.compress(payload+underlay,compresslevel=5,mtime=0))
            (output/name.replace('.glc','.trees')).write_bytes(gzip.compress(tbuf,mtime=0))
            chunks.append(dict(x=origin[0],z=origin[1],**asset(name)))
    extent = [left,top,width,depth]
    write_atlas(output,extent,bounds,layers,footprints,peaks)
    triangles.extend(landmark_faces)
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
