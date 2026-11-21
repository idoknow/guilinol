"""Sample rendered terrain and declared landmark paving along metric seam rings."""
import argparse
import csv
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw

from common import RAW, load_osm
from features import area, overture_geometry, polygons
from landmark_layout import polygon
from landmarks.world_surface import Surface
from seam_inventory import inventory, material_names
from seam_streets import Streets
from seam_crossings import crossings, nearby_features

ROOT = Path(__file__).resolve().parents[1]
HEIGHT_LIMIT = .05
ROLE = {0:'road', 1:'sidewalk', 2:'marking', 4:'verge', 5:'road', 6:'sidewalk'}


def designed_rise(point, inside, outside, outgoing, ground, walls):
    if not {1,6}.intersection(outgoing) or outside <= inside or abs(inside-ground-.05) > .12:
        return None
    return next((name for name,path in walls if path.distance(shapely.Point(point)) <= .08), None)


def world_triangles(entry, material, public, atlas=None, node=''):
    command = ['node', ROOT/'pipeline/glb-triangles.mjs', public/entry['file'], '--visible', node, material]
    if atlas: command.append(json.dumps(atlas))
    triangles = np.frombuffer(subprocess.check_output(command), '<f4').reshape(-1,3,3).astype(float)
    angle = math.radians(entry['rotation'])
    cosine, sine = math.cos(angle), math.sin(angle)
    return triangles @ [[cosine,0,-sine],[0,1,0],[sine,0,cosine]] + entry['position']


def projected_faces(entry, material, public, atlas=None, node=''):
    triangles = world_triangles(entry,material,public,atlas,node)
    normals = np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0])
    top = normals[:,1] > .7*np.linalg.norm(normals,axis=1)
    faces = shapely.polygons(triangles[top][:,:,::2])
    tree = shapely.STRtree(faces)
    anchors, directions = triangles[top][:,0], normals[top]
    def heights(point):
        hits = tree.query(point.buffer(.002),predicate='intersects')
        if not len(hits):
            return []
        points, slopes = anchors[hits], directions[hits]
        return points[:,1]-((point.x-points[:,0])*slopes[:,0]+(point.y-points[:,2])*slopes[:,2])/slopes[:,1]
    return faces, heights


def declared_mesh(entry, material, public=ROOT/'public',atlas=None):
    faces, heights = projected_faces(entry, material, public,atlas)
    return shapely.union_all(faces,grid_size=.001), lambda point:max(heights(point),default=None)


def probes(ring, intervals=False):
    coords = list(ring.coords)
    for start, end in zip(coords, coords[1:]):
        start, end = np.array(start), np.array(end)
        length = np.linalg.norm(end-start)
        count = math.ceil(length/2)
        for index in range(count):
            delta = (end-start)/length
            probe = start+(index+.5)*(end-start)/count, np.array([-delta[1],delta[0]])
            yield (*probe,shapely.LineString([start+index*(end-start)/count,start+(index+1)*(end-start)/count])) if intervals else probe


def seam_segments(edges):
    segments = []
    for layer,lines in edges.items():
        merged = shapely.line_merge(shapely.union_all(lines,grid_size=.001))
        for line in shapely.get_parts(merged):
            segments.append(dict(layer=layer,lengthM=round(line.length,3),path=shapely.get_coordinates(line).round(3).tolist()))
    return sorted(segments,key=lambda segment:-segment['lengthM'])


def heatmap(path, rows, title):
    image = Image.new('RGB',(800,640),'white'); draw = ImageDraw.Draw(image)
    draw.text((12,8), title, fill='black')
    draw.text((12,26),'Red: threshold exceeded | Blue: sampled | Grey: no boundary',fill='black')
    if rows:
        points = np.asarray([row[:2] for row in rows]); low = points.min(axis=0)
        scale = min(np.array([764,555])/np.maximum(points.max(axis=0)-low,1))
        for row in sorted(rows,key=lambda row:bool(row[-1])):
            x,z = (np.array(row[:2])-low)*scale+[18,60]
            draw.ellipse((x-1,z-1,x+1,z+1),fill='#bf282b' if row[-1] else '#487cad')
    else:
        draw.text((18,60),'No declared boundary',fill='grey')
    image.save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=Path('captures/seams'))
    parser.add_argument('--public',type=Path,default=ROOT/'public')
    parser.add_argument('--ids',nargs='+'); parser.add_argument('--report-only',action='store_true')
    parser.add_argument('--strict',action='store_true',help='Fail on any flagged seam (default)')
    args = parser.parse_args()
    if args.strict and args.report_only: parser.error('--strict and --report-only are mutually exclusive')
    args.out.mkdir(exist_ok=True,parents=True)
    specs = json.loads((ROOT/'pipeline/landmarks.json').read_text())
    if args.ids:
        unknown = set(args.ids)-{entry['id'] for entry in specs}
        if unknown: parser.error(f'Unknown landmarks: {unknown}')
        specs = [entry for entry in specs if entry['id'] in args.ids]
    config = json.loads((ROOT/'pipeline/seam-surfaces.json').read_text())
    world = Surface(args.public/'world'); streets = Streets(world)
    osm = {f"{item['type']}/{item['id']}":item for item in load_osm()}
    keys = {key for spec in specs if isinstance(spec.get('replace'),list) for key in spec['replace'] if key not in osm}
    with (Path(RAW)/'overture_buildings.csv').open() as source:
        overture = {row['id']:overture_geometry(row) for row in csv.DictReader(source,delimiter='\t') if row['id'] in keys}
    report = {'revision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
              'columns':['x','z','boundary','heightDeltaM','streetKinds','flags'],
              'exceptions':config['exceptions'],'landmarks':{}}
    overview = []; total = 0; unbound = 0
    for spec in specs:
        name = spec['id']; rings = []; rows = []; meshes = {}; edges = defaultdict(list); separated = []
        entry = world.entries.get(name)
        walls = defaultdict(list); approved = []; curb_pairs = []; paint_checks = []; curb_faces = None; native_pairs = []
        for rule in config['exceptions']:
            if rule.get('kind') == 'retainingWall' and rule['id'] == name:
                walls[rule['material']].append((rule['name'],shapely.LineString(rule['worldXZ'])))
        protected = []; cap = None; structural_walls = []
        if name=='jiefang_bridge':
            from seam_bridge import CurbFaces, check_paint, has_roles, native_contact, protected_edge
            _, bridge_heights = projected_faces(entry,'',args.public)
            stone_faces = CurbFaces(world_triangles(entry,'stone',args.public))
            angle = math.radians(entry['rotation']); center = np.array(entry['position'])[::2]
            if has_roles(args.public/entry['file'],('lod0_rail_cap',)):
                faces,cap_heights = projected_faces(entry,'',args.public,node='lod0_rail_cap')
                cap = shapely.union_all(faces,grid_size=.001)
            if has_roles(args.public/entry['file']):
                curb_faces = CurbFaces(world_triangles(entry,'',args.public,node='lod0_curb_face'))
                _,paint = projected_faces(entry,'',args.public,node='lod0_road_paint')
                paint_checks = list(check_paint(entry,paint))
                for way,x,z,found in paint_checks:
                    if not found: rows.append([x,z,'dash:'+str(way),None,[],['missingModelPaint']])
        if 'flatten' in spec: rings.append(('flatten',polygon(spec['flatten']['polygon'])))
        if name=='gunanmen':
            from landmarks.rong_ground import GATE_PLAZA
            rings.append(('streetPlaza',shapely.Polygon(np.asarray(GATE_PLAZA)+np.asarray(entry['position'])[::2])))
        replace = spec.get('replace',[])
        if isinstance(replace,dict): rings.append(('replace',polygon(replace['polygon'])))
        else:
            for key in replace:
                shape = area(osm[key]) if key in osm else overture[key]
                rings.append(('replace:'+key,shape))
        rings.extend(('replacePolygon',polygon(coords)) for coords in spec.get('replacePolygons',[]))
        roles = dict(config['surfaces'].get(name,{})); atlas = config['atlas'].get(name)
        crossing_report = []; layer_crossings = []
        if not rings and spec.get('schematicCampus'):
            plaque = shapely.box(-3,-.12,3,.12)
            rotated = shapely.affinity.rotate(plaque,-entry['rotation'],origin=(0,0))
            rings.append(('plaqueFootprint',shapely.affinity.translate(rotated,entry['position'][0],entry['position'][2])))
        # A draw material can cover a whole campus or elevated bridge deck.
        # Physical height probes use their surveyed join, independently of
        # the inventory of every surface that shares GL04 shading.
        boundaries = config['heightBoundaries'].get(name,[])
        present=material_names(args.public/entry['file']) if entry and boundaries else []
        for material in list(roles):
            if material not in boundaries or material not in present:continue
            shape, meshes[material] = declared_mesh(world.entries[name],material,args.public)
            rings.append((material,shape))
        atlas_rules = atlas if isinstance(atlas,list) else [atlas] if atlas else []
        for rule in atlas_rules:
            fallback=rule['role'] in boundaries and rule['role'] not in present
            if rule['material'] not in boundaries and not fallback:continue
            label = rule.get('label',rule['material'] if len(atlas_rules)==1 else rule['material']+':'+rule['role'])
            shape,meshes[label] = declared_mesh(entry,rule['material'],args.public,rule['box'])
            roles[label] = rule['role']
            rings.append((label,shape))
        for label,region in rings:
            region = shapely.make_valid(region)
            if region.is_empty: continue
            for kind,point,gap,side in crossings(region,nearby_features(streets,region)):
                flag = None
                if gap is None or gap>.3: flag = kind+'Discontinuity'
                elif not side and label in meshes:
                    model_y = meshes[label](point)
                    street_y,_ = streets.at(point.x,point.y)
                    if model_y is not None and model_y>street_y+.01:
                        flag = kind+'OcclusionCandidate'
                        if name=='jiefang_bridge' and model_y-street_y>.65:
                            from seam_layers import bridge_layer
                            local = (np.array(point.coords[0])-center) @ [[math.cos(angle),math.sin(angle)],[-math.sin(angle),math.cos(angle)]]
                            layer = bridge_layer(local,model_y-entry['position'][1])
                            if layer!='ground':
                                layer_crossings.append([point.x,point.y,kind,layer,model_y,street_y])
                                flag = None
                crossing_report.append([label,kind,round(point.x,3),round(point.y,3),side,None if gap is None else round(gap,3),flag])
                if flag: rows.append([round(point.x,3),round(point.y,3),label,None,[],[flag]])
            for shape in polygons(region):
                for ring in [shape.exterior,*shape.interiors]:
                    for point,normal,interval in probes(ring,True):
                        sides = [point+normal*.02,point-normal*.02]
                        if shape.contains(shapely.Point(sides[1])): sides.reverse()
                        if any(tuple(int(base+world.size*math.floor((value-base)/world.size)) for value,base in zip(side,(world.left,world.top))) not in world.files for side in sides):
                            rows.append([*point.round(3),label,None,[],['outsideWorld']]); edges['outsideWorld'].append(interval)
                            continue
                        inside, incoming = streets.at(*sides[0]); outside,outgoing = streets.at(*sides[1])
                        mesh = meshes.get(label); flags = []; layer = 'ground'
                        if not mesh and name!='jiefang_bridge':
                            for height_at in meshes.values():
                                left = height_at(shapely.Point(sides[0])); right = height_at(shapely.Point(sides[1]))
                                if left is not None: inside = max(inside,left)
                                if right is not None: outside = max(outside,right)
                        if mesh:
                            inside = mesh(shapely.Point(point))
                            if name=='libin_middle' or 'edgeStone' in roles:
                                for other,neighbor in meshes.items():
                                    if other!=label:
                                        peer = neighbor(shapely.Point(sides[1]))
                                        if peer is not None: outside = max(outside,peer)
                            if inside is None: flags.append('missingFace')
                            role = roles[label]
                            if role=='plaza': role='sidewalk'
                            if name=='jiefang_bridge' and inside is not None:
                                from seam_layers import bridge_layer
                                local = (point-center) @ [[math.cos(angle),math.sin(angle)],[-math.sin(angle),math.cos(angle)]]
                                layer = bridge_layer(local,inside-entry['position'][1])
                                if layer!='ground':
                                    peers = bridge_heights(shapely.Point(sides[1]))
                                    same = [height for height in peers if abs(height-inside)<.65]
                                    if same: outside = min(same,key=lambda value:abs(value-inside))
                                    elif abs(outside-inside)<=HEIGHT_LIMIT and native_contact(interval,(sides[1]-point)/.02,mesh,streets,inside):
                                        native_pairs.append([*point.round(3),layer,round(inside,3),round(outside,3)])
                                    elif layer=='bridge-deck' and cap is not None and protected_edge(interval,(sides[0]-point)/.02,cap,cap_heights,mesh):
                                        protected.append([list(pair) for pair in interval.coords]); outside = None
                                    else:
                                        verified = False
                                        if layer in ('ramp','underpass'):
                                            evidence = stone_faces.wall_sections(interval,(sides[1]-point)/.02,mesh,bridge_heights,streets)
                                            structural_walls.append(dict(layer=layer,**evidence))
                                            verified = evidence['verified']
                                        if not verified: separated.append([*point.round(3),layer,round(inside,3),round(outside,3)])
                                        outside = None
                                    incoming = outgoing = set()
                            if incoming and role not in {ROLE.get(kind) for kind in incoming}:
                                flags.append('surfaceOverlap')
                            if 2 in incoming and inside is not None and inside>streets.at(*sides[0])[0]:
                                flags.append('paintOcclusionCandidate')
                        delta = abs(inside-outside) if inside is not None and outside is not None else None
                        if delta is not None and delta>HEIGHT_LIMIT:
                            curb = not mesh and bool({1,6}&incoming) != bool({1,6}&outgoing)
                            wall = (designed_rise(point,inside,outside,outgoing,world.sample(*point)[0],walls[label])
                                    if walls[label] else None)
                            if curb_faces is not None and mesh and curb_faces.pairs(point,inside,outside):
                                curb_pairs.append([*point.round(3),layer,round(delta,4)])
                            elif wall: approved.append([*point.round(3),wall,round(delta,4)])
                            elif not (curb and abs(delta-.15)<.015): flags.append('height')
                        rows.append([*point.round(3),label,None if delta is None else round(delta,4),sorted(outgoing),flags])
                        if flags: edges[layer].append(interval)
        inventory_rows = inventory(dict(entry,id=name),args.public,config,streets) if entry else []
        for item in inventory_rows:
            if item['status']=='unbound':
                unbound += item['faces']
                rows.append([*item['worldXZ'],item['material'],None,[],['unboundStreetSurface']])
        count = sum(bool(row[-1]) for row in rows); total += count
        segments = seam_segments(edges)
        report['landmarks'][name] = {'streetSurfaceInventory':inventory_rows,'samples':len(rows),'flagged':count,'declaredMaterials':list(meshes),'points':rows,
                                     'segments':segments,'lengthM':round(sum(item['lengthM'] for item in segments),3),'unpairedLayers':separated,'designedRises':approved,'streetCrossings':crossing_report}
        overview.extend(rows); heatmap(args.out/(name+'.png'),rows,name)
        if name=='jiefang_bridge':
            report['landmarks'][name]['balustradeEdges'] = protected
            report['landmarks'][name]['wallSectionChecks'] = structural_walls
            report['landmarks'][name].update(modelRolesAvailable=curb_faces is not None,modelCurbPairs=curb_pairs,modelPaintChecks=paint_checks,unpairedCrossings=layer_crossings,nativeContactPairs=native_pairs)
    heatmap(args.out/'overview.png',overview,'Landmark seams'); report['flagged']=total
    report['unboundStreetSurface']=unbound
    report['segmentCount']=sum(len(entry['segments']) for entry in report['landmarks'].values())
    report['lengthM']=round(sum(entry['lengthM'] for entry in report['landmarks'].values()),3)
    report['unpairedCount']=sum(len(entry['unpairedLayers'])+len(entry.get('unpairedCrossings',[])) for entry in report['landmarks'].values())
    (args.out/'seams.json').write_text(json.dumps(report,separators=(',',':'),allow_nan=False)+'\n')
    print(f'{len(specs)} landmarks; {len(overview)} boundary samples; {total} flagged; {unbound} unbound candidate triangles')
    return int(bool(total or report['unpairedCount']) and not args.report_only)


if __name__=='__main__':
    raise SystemExit(main())
