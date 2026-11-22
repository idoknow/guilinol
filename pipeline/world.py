from collections import deque
from concurrent.futures import ThreadPoolExecutor
import argparse
import gzip
import hashlib
import io
import json
import math
import struct
from pathlib import Path
from overview_water import water_mask
from sections import section_layers, shopfronts, RULES

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter
from shapely import STRtree, distance, intersects_xy, points as shapely_points, unary_union
from shapely.geometry import box, Point

from common import CHUNK, GRID, LAT0, LON0, MLON, MLAT, OUT, ll2xz, load_dem, load_osm
from features import building_mesh, buildings, game_court, ground_features, points, polygons, raw_overture_footprints, rongyin_sidewalk
from street_rings import repair_frozen_tile
from legacy_core import Downtown, EXTENT as DOWNTOWN
from karst import generate
from peak_sectors import write_city_lods
from landmarks.jiefang_layout import bank_paving, grade_banks, grade_binjiang_streets
from bridges import bridge_tiles
from road_grading import build_ground_mesh_lookup, eval_bspline_grid, solve_road_and_bridge_elevations
from scatter import CONFIG, extract_road_network, scatter
from streets import chunks as street_chunks
from dongxi_streets import street_surface
from atlas import write_atlas
from overview_map import write_overview_map
from vehicles import plan_vehicles, write_vehicles
from clearance import landmark_triangles
from landmarks.rong_ground import GATE_PLAZA, grade_landings
from landmarks import xiaoyao_access
from shoreline import correct_water, contour_ronghu
from landmark_layout import Layout
from landmark_solids import load_landmark_meshes, structural_footprint, slice_tris_at_y
from landmarks.world_surface import PeakSurface
from functools import lru_cache
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


def terrain_stencil(poly, west, north, col, row, shape):
    """Rasterize the legacy snapped footprint with explicit half-pixel ties.

    Each scanline covers the columns nearest its intersections with each ring.
    Computing these from integer endpoints avoids native float scan conversion.
    """
    mask = np.zeros(shape, dtype=bool)
    for ring, fill in [(poly.exterior, True), *((hole, False) for hole in poly.interiors)]:
        vertices = [(math.floor((x-west)/GRID)-col, math.floor((z-north)/GRID)-row)
                    for x,z in ring.coords]
        crossings = [[] for _ in range(shape[0])]
        for (x0,y0),(x1,y1) in zip(vertices, vertices[1:]):
            if y0 == y1:
                mask[y0,min(x0,x1):max(x0,x1)+1] = fill
                continue
            if y1 < y0:
                x0,y0,x1,y1 = x1,y1,x0,y0
            mask[y1,x1] = fill
            for y in range(y0,y1):
                crossings[y].append(x0 + (y-y0)*(x1-x0)/(y1-y0))
        for y, xs in enumerate(crossings):
            xs.sort()
            for a,b in zip(xs[::2],xs[1::2]):
                mask[y,math.floor(a+.5):math.ceil(b-.5)+1] = fill
    return mask


def write_chunk(output, name, payload, trees, origin):
    compressed = gzip.compress(payload, compresslevel=5, mtime=0)
    (output/name).write_bytes(compressed)
    (output/name.replace('.glc', '.trees')).write_bytes(gzip.compress(trees, mtime=0))
    return dict(x=origin[0], z=origin[1], file=name, bytes=len(compressed))


def build(bbox, output, palette, workers=4):
    if workers < 1:
        raise ValueError('workers must be positive')
    south, west, north, east = bbox
    if not (south < north and west < east):
        raise ValueError('Expected bbox: south west north east')
    start = np.floor(np.array(ll2xz(north, west))/CHUNK).astype(int)*CHUNK
    end = np.ceil(np.array(ll2xz(south, east))/CHUNK).astype(int)*CHUNK
    west0,north0,w0,h0 = DOWNTOWN
    downtown = Downtown() if (start[0]<west0 and start[1]<north0 and end[0]>west0+w0 and end[1]>north0+h0) else None
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
            col, row = math.floor((part.bounds[0]-left)/GRID), math.floor((part.bounds[1]-top)/GRID)
            end_col = math.ceil((part.bounds[2]-left)/GRID)
            end_row = math.ceil((part.bounds[3]-top)/GRID)
            window = np.s_[row:end_row+1, col:end_col+1]
            mask = terrain_stencil(part, left, top, col, row, terrain[window].shape)
            terrain[window][mask] = original[window][mask] = round(level*10)
    correct_water(surface, terrain, original, bounds, stencil)
    wet = surface != DRY
    terrain[wet] = original[wet] = np.minimum(terrain[wet], surface[wet] - 20)

    contour_ronghu(surface, terrain, original, bounds)
    rong_pavement = grade_landings(terrain,original,wet,left,top,GRID,layout.entries)
    interchange=None
    bank_pavement=None
    west_portal=None
    modeled_paving=None
    deck_mask=None
    for x,z,entry in layout.entries:
        if entry['id']=='jiefang_bridge' and bounds.covers(Point(x,z)):
            x_jb, z_jb = x, z
            datum=previous_bed[round((z-top)/GRID),round((x-left)/GRID)]/10
            angle=-np.deg2rad(entry['rotation'])
            bank_pavement=bank_paving((x,z),angle)
            axes=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
            corners=np.array([[-136,-21.5],[-103,-21.5],[-103,21.5],[-136,21.5]])
            west_portal=ShapelyPolygon(corners@axes+[x,z])
            # Wide native Binjiang sidewalks extend past the modeled lower road.
            # Clip their overhang across the upper slab, including the portal.
            slab = np.array([[-140.5,-21.5],[140.5,-21.5],[140.5,21.5],[-140.5,21.5]])
            deck_mask = ShapelyPolygon(slab @ axes + [x,z])
            modeled_paving = bank_pavement.union(deck_mask)
            interchange=((x,z),angle,bank_pavement)
            grade_banks(terrain,original,wet,left,top,GRID,(x,z),angle,datum)

    def sample(east, south):
        row = min(depth // GRID, max(0, round((south - top) / GRID)))
        col = min(width // GRID, max(0, round((east - left) / GRID)))
        return terrain[row, col] / 10, surface[row, col]

    raw_foots = raw_overture_footprints(bounds)
    road_net = extract_road_network(raw_foots)
    _, roads, _, banks, _, ped_areas = road_net
    grade_roads = roads
    elevated_walks = {way['id'] for way in road_net[0] if way['type']=='way' and way['id']==1008909371
                      and way.get('tags',{}).get('layer')=='1'}
    roads = [road.aligned_section() for road in roads if road.way not in elevated_walks]
    road_net = (road_net[0], roads, *road_net[2:])
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
        sp = street_surface(road)
        if road.kind == 'pedestrian' and not comp_excl.is_empty:
            sp = sp.difference(comp_excl)
        if not sp.is_empty:
            road_surfs.append(sp)
        for side, extra in ((-1, road.left), (1, road.right)):
            if extra:
                if str(road.way) in RULES['frontageSections']:
                    extra = sum(road.dimensions[key] for key in ('verge','cycle','curb','walk'))
                sw_p = road.side_line(side).buffer(side*(road.width/2+extra), single_sided=True, quad_segs=2)
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
        grade_roads, ped_areas, layout, Path(__file__).resolve().parents[1],
        vessel_routes=candidate_routes, previous_bed=previous_bed,
    )
    if interchange is not None:
        grade_banks(terrain, original, wet, left, top, GRID, (x_jb, z_jb), angle, datum, finish=True)
        grade_binjiang_streets(road_ctrl,left,top,8,(x_jb,z_jb),angle,datum)
        from east_grading import grade_east, grade_landing
        east_road = next(road.line for road in roads if road.way == 682893309)
        for field in (terrain,original):
            grade_east(east_road,field,left,top,GRID,10,wet)
        grade_landing(east_road,(terrain,original),left,top,GRID,wet,(x_jb,z_jb),angle,datum)
    for east,south,entry in layout.entries:
        if entry['id']!='zhengyang': continue
        cosine,sine=np.cos(.16),np.sin(.16)
        for row in range(max(0,int((south-top-36)//GRID)),min(len(original),int((south-top+10)//GRID)+1)):
            for col in range(max(0,int((east-left-28)//GRID)),min(original.shape[1],int((east-left+28)//GRID)+1)):
                if wet[row,col]: continue
                wx,wz=left+col*GRID,top+row*GRID
                across=(wx-east)*cosine+(wz-south)*sine
                station=-(wx-east)*sine+(wz-south)*cosine
                weight=np.clip((22-abs(across))/6,0,1)*np.clip((16-abs(station+12.5))/6,0,1)
                if weight:
                    target=float(eval_bspline_grid(road_ctrl,left,top,np.array(wx),np.array(wz))) * 10
                    for field in (terrain,original):
                        field[row,col]+=round(weight*max(0,target-field[row,col]))
    # Smooth steep compound edges locally after the city road elevations are solved.
    for region, span in layout.flatten_transitions:
        neighborhood = region.buffer(span * 2)
        x0, z0, x1, z1 = neighborhood.bounds
        cols = np.arange(max(0, math.floor((x0-left)/GRID)), min(width//GRID, math.ceil((x1-left)/GRID))+1)
        rows = np.arange(max(0, math.floor((z0-top)/GRID)), min(depth//GRID, math.ceil((z1-top)/GRID))+1)
        xx, zz = np.meshgrid(left+cols*GRID, top+rows*GRID)
        edge_distance = distance(shapely_points(xx, zz), region.boundary)
        blend = np.clip((span-edge_distance)/(span/2), 0, 1)
        # Keep adjacent parcels at survey grade, including their foundation bearings.
        blend[~intersects_xy(region, xx, zz)] = 0
        window = np.ix_(rows, cols)
        local_roads = carriageway_mask.intersection(neighborhood)
        sidewalks = sidewalk_mask.intersection(neighborhood)
        blend[wet[window] | intersects_xy(local_roads.union(sidewalks), xx, zz)] = 0
        for field in (original, terrain):
            local = field[window].astype(float)
            smooth = gaussian_filter(local, sigma=span/(3*GRID), mode='nearest')
            field[window] = np.rint(local + blend*(smooth-local))
    fubo = None
    if any(p['name']=='伏波山' for p in peaks['entries']):
        from fubo_site import fubo_site
        spec = next(p for p in json.loads(Path(__file__).with_name('peaks.json').read_bytes()) if p['name']=='伏波山')
        fubo = fubo_site(spec['eastLimit'])
    if downtown:
        downtown.blend(terrain,surface,original,road_ctrl,left,top,fubo)
        wet[:] = surface != DRY
        downtown.peaks(output,peaks)
    if fubo is not None:
        fubo.grade_bank(terrain,original,surface,left,top)
    ground_mesh_at = build_ground_mesh_lookup(original, surface, left, top, width, depth)
    finalize_bridges(ground_mesh_at)

    sw_query_tree = STRtree(list(polygons(sidewalk_mask))) if not sidewalk_mask.is_empty else None
    def tree_support_at(east: float, south: float) -> float:
        gm = ground_mesh_at(east, south)
        if sw_query_tree and sw_query_tree.query(Point(east, south), predicate='intersects').size:
            rc = float(eval_bspline_grid(road_ctrl, left, top, np.array([east]), np.array([south]))[0])
            return max(rc, gm) + 0.195
        return gm

    peak_centers = {p['name']: p['center'] for p in peaks['entries']}
    peak_lm_names = {'fubo': '伏波山', 'diecai': '明月峰', 'duxiu': '独秀峰'}
    def lm_elevation(x, z, entry):
        if entry['id']=='fubo' and '伏波山' in peak_centers:
            return peak_centers['伏波山'][1]
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
    landmarks = []
    for x, z, entry in layout.entries:
        lm_y = lm_elevation(x, z, entry)
        item = dict(position=[x, lm_y, z], **entry)
        if entry['id'] == 'guilin_theater':
            from landmarks.guilin_theater import LOCAL_FOOTPRINT, _ellipse_ring
            rad = math.radians(entry.get('rotation', 0))
            cos_r, sin_r = math.cos(rad), math.sin(rad)
            bud_ring = _ellipse_ring(-0.50, 55.20, 14.8, 9.8, -6.0, 28)
            item['solid'] = [
                [round(lm_y - 6.5, 2), round(lm_y + 12.6, 2),
                 [[round(x + lx * cos_r + lz * sin_r, 2), round(z - lx * sin_r + lz * cos_r, 2)] for lx, lz in ring]]
                for ring in (LOCAL_FOOTPRINT, bud_ring)
            ]
        landmarks.append(item)
    if downtown:
        downtown.landmarks(landmarks)
    structural_entries = [entry for entry in landmarks if entry['id'] in (*peak_lm_names, 'guilin_theater')]
    peak_surface = PeakSurface(output, peaks, left, top, CHUNK)
    @lru_cache(maxsize=262144)
    def structural_ground(east,south):
        return peak_surface.height(east,south,ground_mesh_at(east,south))
    structures = load_landmark_meshes(Path(__file__).resolve().parents[1], {'landmarks': structural_entries})
    layout.model_footprints = unary_union([layout.model_footprints, *(
        structural_footprint(data,structural_ground,ShapelyPolygon()) for data in structures.values())])
    footprints, heights = buildings(bounds, ground_mesh_at, peak_tree, layout, carriageway_mask, sidewalk_mask)
    index = STRtree(footprints)
    shop_rows = shopfronts(footprints, heights, roads)
    for campus in layout.allow_unmapped_court:
        if not bounds.covers(campus) or any(campus.covers(field.representative_point())
                for layer in ('schoolTrack','schoolCourt') for field in layers[layer]):
            continue
        court = game_court(campus,[footprints[key] for key in index.query(campus)])
        if court is not None:
            mask,corner = stencil(court,left,top,1)
            texture.paste(palette['schoolCourt'],corner,mask)
    bands = section_layers(roads)
    cycle_clearance = [band.buffer(.08) for band in bands[2].geometries]
    trees, roads, banks, tree_stats, beds = scatter(bounds, footprints, layers['water'], peak_shapes, tree_support_at, mountain_trees, unary_union([layout.tree_exclude, bank_pavement.buffer(2)]) if bank_pavement is not None else layout.tree_exclude, precomputed=road_net, extra_blocked=[*(court.buffer(1.5) for court in layers["schoolTrack"] + layers["schoolCourt"]), *bridge_polys, *road_surfs, *cycle_clearance], structure_exclude=layout.exclude.buffer(.52),
        verge_obstacles=STRtree([layout.model_footprints, *bands[3].geometries]))
    for road in roads:
        for part in polygons(street_surface(road).intersection(bounds)):
            mask,corner = stencil(part,left,top,1)
            texture.paste('#484b4d' if road.name=='翊武路' else palette['road'],corner,mask)
            layers['road'].append(part)
    if bank_pavement is not None:
        # Replace the baked flat road colour underneath the elevated strips.
        for part in polygons(bank_pavement.intersection(bounds)):
            mask,corner=stencil(part,left,top,1)
            texture.paste(palette['green'],corner,mask)
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
    landmark_faces = list(landmark_triangles(landmarks))
    vehicles = plan_vehicles(bounds, surface, layers['road'], footprints, sample, landmark_faces, interchange=interchange)
    decks, triangles = bridge_tiles(bounds, sample, vehicles['routes'], (), bridge_plans, west_portal=west_portal)
    modeled_paving = unary_union([*layout.street_foundations, *rong_pavement, modeled_paving if modeled_paving is not None else ShapelyPolygon()])
    if fubo is not None:
        # The park paths are painted on the graded ground. An additional
        # spline-height street mesh would bridge across the switchbacks.
        modeled_paving = modeled_paving.union(fubo.trails.buffer(4).intersection(fubo.park))
    gate_plaza = next((ShapelyPolygon(np.asarray(GATE_PLAZA)+[x,z]) for x,z,entry in layout.entries
                       if entry['id']=='gunanmen'),None)
    if gate_plaza is not None:
        gate_entry = next(entry for entry in landmarks if entry['id']=='gunanmen')
        gate = load_landmark_meshes(Path(__file__).resolve().parents[1], {'landmarks':[gate_entry]})['gunanmen']
        walls = gate['coll_tris'][abs(gate['coll_normals'][:,1])<.72].copy()
        for triangle in walls:
            east,south = triangle[:,::2].mean(axis=0)
            triangle[:,1] -= sample(east,south)[0]
        masonry = unary_union([slice_tris_at_y(walls,level) for level in (.6,1.2)])
        gate_plaza = gate_plaza.difference(masonry.buffer(.06))
    walkable_by_way = next((xiaoyao_access.walkable_surfaces(east,south,entry['rotation'])
                            for east,south,entry in layout.entries if entry['id']=='xiaoyao_tower'), {})
    for east,south,entry in layout.entries:
        if entry['id']=='zhuangyuan_gallery':
            slab = xiaoyao_access.gallery_floor(east,south,entry['rotation'])
            for way in xiaoyao_access.GALLERY_PAVING_WAYS:
                walkable_by_way[way] = walkable_by_way.get(way,ShapelyPolygon()).union(slab)
    streets,lengths = street_chunks(roads,banks,bounds,layers['water'],sample,layout.exclude,ped_areas,comp_excl,road_ctrl,(left,top),ground_mesh_at,footprints,bands=bands,modeled_paving=modeled_paving,walkable_by_way=walkable_by_way,gate_plaza=gate_plaza,deck_mask=deck_mask)
    (output/'marking-audit.json').write_text(json.dumps(lengths.pop('markingOverlap')))
    print('Lengths (m):',lengths)
    def asset(name):
        return {'file':name,'bytes':(output/name).stat().st_size}
    np.where(wet,surface,terrain)[::8,::8].astype('<i2').tofile(output/'overview.i16')
    np.where(wet,surface,original)[::8,::8].astype('<i2').tofile(output/'underlay.i16')
    overview_image = texture.resize((width//4,depth//4), Image.Resampling.BOX).quantize(32)
    water_bits = water_mask(overview_image, palette['water'])
    overview_image.save(output/'overview.png', optimize=True)
    u_peaks_buf = unary_union(peak_shapes).buffer(1.0) if peak_shapes else ShapelyPolygon()
    chunks = []
    pending = deque()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for south in range(0,depth,CHUNK):
            for east in range(0,width,CHUNK):
                origin = (left+east,top+south)
                if downtown and downtown.frozen_tile(*origin):
                    old = downtown.tiles[origin]
                    name = f'{east//CHUNK}_{south//CHUNK}.glc'
                    (output/name).write_bytes(repair_frozen_tile(downtown.files[old]))
                    (output/name.replace('.glc','.trees')).write_bytes(downtown.files[old.replace('.glc','.trees')])
                    while pending:
                        chunks.append(pending.popleft().result())
                    chunks.append(dict(x=origin[0],z=origin[1],**asset(name)))
                    continue
                tile = box(*origin,origin[0]+CHUNK,origin[1]+CHUNK)
                parts = ((poly,heights[key]) for key in sorted(index.query(tile))
                         for poly in polygons(footprints[key].intersection(tile)) if poly.area >= .01)
                vertices, normals, indices, rings = building_mesh(parts, origin)
                deck, thin, asphalt = decks(tile, origin)
                st_data = streets(tile, origin)
                for slot, rows in ((7,beds),(8,shop_rows)):
                    if rows.get(origin):
                        while len(st_data)<=slot:
                            st_data.append(None if len(st_data)==5 else [])
                        st_data[slot]=rows[origin]
                collision = json.dumps([rings, st_data, thin, asphalt], separators=(',', ':')).encode()
                tbuf = trees[origin]
                if tbuf:
                    sw_tile_polys, rd_tile_polys, cycle_tile_polys = [], [], []
                    for s_item in st_data[0]:
                        skind, ext, *holes = s_item
                        if skind not in (0, 1, 4, 5, 6) or len(ext) < 3:
                            continue
                        ext_w = [(origin[0] + p[0] / 100.0, origin[1] + p[1] / 100.0) for p in ext]
                        holes_w = [[(origin[0] + p[0] / 100.0, origin[1] + p[1] / 100.0) for p in h] for h in holes if len(h) >= 3]
                        sp = ShapelyPolygon(ext_w, holes_w).buffer(0)
                        if not sp.is_empty:
                            (cycle_tile_polys if skind == 5 else rd_tile_polys if skind == 0 else sw_tile_polys).append(sp)
                    u_sw_tile = unary_union(sw_tile_polys) if sw_tile_polys else ShapelyPolygon()
                    u_rd_tile = unary_union(rd_tile_polys) if rd_tile_polys else ShapelyPolygon()
                    u_cycle_tile = unary_union(cycle_tile_polys) if cycle_tile_polys else ShapelyPolygon()
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
                        sup_w = (rb_w + 0.195) if u_sw_tile.covers(pt_w) else (rb_w + 0.045) if u_rd_tile.covers(pt_w) else (rb_w + 0.060) if u_cycle_tile.covers(pt_w) else gm_w
                        struct.pack_into('<h', tbuf, ti * 12 + 4, round(10.0 * sup_w))
                png = io.BytesIO()
                texture.crop((east,south,east+CHUNK,south+CHUNK)).save(png,format='PNG')
                image = png.getvalue()
                window = np.s_[south//GRID:south//GRID+65,east//GRID:east//GRID+65]
                underlay = original[window].tobytes() if np.any(original[window]!=terrain[window]) else b''
                header = struct.pack('<4s5I',b'GL04',len(vertices)//6,len(indices)//4,len(collision),len(image),len(deck)//18)
                name = f'{east//CHUNK}_{south//CHUNK}.glc'
                payload = header+terrain[window].tobytes()+surface[window].tobytes()+vertices+normals+indices+collision+image+deck
                pending.append(pool.submit(write_chunk, output, name, payload+underlay, bytes(tbuf), origin))
                if len(pending) >= workers:
                    chunks.append(pending.popleft().result())
        chunks.extend(job.result() for job in pending)
    extent = [left,top,width,depth]
    write_atlas(output,extent,bounds,layers,footprints,peaks)
    write_overview_map(output,bbox)
    triangles.extend(landmark_faces)
    write_vehicles(output,vehicles,triangles)
    manifest = dict(version=4,bbox=bbox,origin=[LAT0,LON0],extent=extent,chunkSize=CHUNK,peaks=peaks,atlas=asset('atlas.bin'),
                    vehicles=asset('vehicles.bin'),grid=GRID,overview=dict(step=32, heights=asset('overview.i16'),underlay=asset('underlay.i16'),texture=asset('overview.png'),waterMask=water_bits),chunks=chunks)
    # Hash the full-resolution GL04 fields in wire order, independent of gzip,
    # texture encoders, or whether a chunk elides its redundant underlay.
    digest = hashlib.sha256()
    for field in (terrain, surface, original):
        digest.update(field.astype('<i2', copy=False).tobytes())
    manifest['terrainSha256'] = digest.hexdigest()
    print('Terrain SHA-256:', digest.hexdigest())
    manifest['landmarks'] = landmarks
    write_city_lods(output, manifest)
    from traffic import bake as bake_traffic
    bake_traffic(output, manifest)
    (output/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(f'{len(chunks)} chunks, {len(footprints)} footprints, {sum(c["bytes"] for c in chunks):,} chunk bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bbox',type=float,nargs=4,default=[25.212,110.243,25.366,110.352])
    parser.add_argument('--output',type=Path,default=Path(OUT))
    parser.add_argument('--palette',type=Path,default=Path(__file__).with_name('palette.json'))
    parser.add_argument('--workers', type=int, default=4, help='Concurrent chunk compression writers')
    args = parser.parse_args()
    build(args.bbox,args.output,json.loads(args.palette.read_text()),args.workers)
