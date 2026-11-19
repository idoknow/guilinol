"""Check registered roof footprints against all mapped walking axes in the replacement area."""
import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import ll2xz, xz2ll


def ring(coords):
    return [ll2xz(lat, lon) for lon, lat in coords]


def polygon(coords):
    return Polygon(ring(coords[0]), [ring(hole) for hole in coords[1:]])


def read_ways(source):
    if source.suffix == '.osm':
        xml = ET.parse(source)
        nodes = {node.get('id'): (float(node.get('lon')), float(node.get('lat'))) for node in xml.findall('node')}
        for way in xml.findall('way'):
            yield way.get('id'), {tag.get('k'): tag.get('v') for tag in way.findall('tag')}, [nodes[node.get('ref')] for node in way.findall('nd')]
    else:
        for way in json.loads(source.read_text())['elements']:
            if way['type'] == 'way':
                yield str(way['id']), way.get('tags', {}), [(pt['lon'], pt['lat']) for pt in way.get('geometry', [])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', type=Path, nargs='+')
    parser.add_argument('--trim', action='store_true')
    parser.add_argument('--raw-models', type=Path, help='LOD0 generator output directory (before packing)')
    args = parser.parse_args()
    layout = ROOT / 'docs/layout'
    boundary = next(item['replace']['polygon'] for item in json.loads((ROOT/'pipeline/landmarks.json').read_text()) if item['id'] == 'wangcheng_market')
    district = Polygon(ring(boundary))
    ways = {}
    for source in args.sources:
        for identifier, tags, coords in read_ways(source):
            walking = tags.get('highway') in {'footway', 'pedestrian', 'path', 'steps', 'living_street'} or tags.get('service') == 'alley'
            if walking and tags.get('area') != 'yes' and len(coords) > 1:
                axis = LineString(ring(coords))
                if axis.distance(district) <= 1.5:
                    ways[identifier] = axis
    if not ways:
        raise ValueError('Missing mapped lanes')
    buffer = unary_union([axis.buffer(1.5) for axis in ways.values()]).intersection(district)
    cameras = json.loads((layout/'dongxi-estimated-cameras.json').read_text())
    setbacks = [axis.buffer(2.75, quad_segs=3, join_style='mitre') for axis in ways.values()]
    for name, shot in cameras.items():
        if Path(name).name[:2] in ('03','05','06'):
            x,z,angle = shot['x'],shot['z'],math.radians(shot['heading'])
            setbacks.append(LineString([(x,z),(x+5*math.sin(angle),z-5*math.cos(angle))]).buffer(1.65,quad_segs=3))
    setback = unary_union(setbacks).intersection(district.buffer(1.5))
    roofs = {}
    for filename in ('dongxi-layout.geojson', 'dongxi-infill.geojson'):
        path=layout/filename
        catalog=json.loads(path.read_text())
        output=[]
        for feature in catalog['features']:
            props = feature['properties']
            if props['kind'] in ('roof', 'covered_passage') and props.get('render', True):
                shape=polygon(feature['geometry']['coordinates'])
                if args.trim and shape.intersection(setback).area>.001:
                    cut=shape.difference(setback)
                    parts=sorted([part for part in getattr(cut,'geoms',[cut]) if part.geom_type=='Polygon' and part.area>.1],key=lambda part:-part.area)
                    for index,part in enumerate(parts):
                        key=props['name']+(f'-lane{index}' if index else '')
                        coords=[[list(reversed(xz2ll(*vertex))) for vertex in edge.coords] for edge in [part.exterior,*part.interiors]]
                        output.append({**feature,'properties':{**props,'name':key},'geometry':{'type':'Polygon','coordinates':coords}})
                        roofs[key]=part
                    continue
                roofs[props['name']] = shape
            output.append(feature)
        if args.trim:
            catalog['features']=output
            path.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
    violations = {name: round(shape.intersection(buffer).area, 3) for name, shape in roofs.items() if shape.intersection(buffer).area > 1e-6}
    print('OSM ways:', ', '.join(sorted(ways)), '\nRoof footprints with overlaps (m²):', violations, '\nViolations:', len(violations))
    mesh_fail=False
    if args.raw_models:
        import numpy as np
        import shapely
        import trimesh
        config={entry['id']:entry for entry in json.loads((ROOT/'public/world/manifest.json').read_text())['landmarks']}
        for name in ('wangcheng_market','dongxixiang'):
            scene=trimesh.load_scene(args.raw_models/(name+'.glb'))
            mesh=scene.geometry[scene.graph['lod0_joinery'][1]]
            atlas=np.floor(mesh.visual.uv[mesh.faces[:,0]]*4).astype(int)
            tile=(atlas[:,0]==2)&(atlas[:,1]==3)
            if not tile.any():
                raise ValueError('Missing tile faces: '+name)
            tri=mesh.triangles[tile][:,:,[0,2]]+np.array(config[name]['position'])[::2]
            shapes=shapely.polygons(tri)
            selected=shapes[(shapely.area(shapes)>1e-6)&shapely.intersects(shapes,buffer)]
            overlap=shapely.union_all(selected).intersection(buffer)
            print(name,'actual tile/eave overlap area (m²):',round(overlap.area,3))
            if name=='wangcheng_market':
                from shapely.affinity import rotate,translate
                from shapely.geometry import box
                origin_x,_,origin_z=config[name]['position']
                for label,x,z,angle,width,depth in [('横巷回望门楼',42,13.9,-1.29,9.4,3.4),('东西巷横巷封闭过街楼',62,41,-1.39,9.65,5.7)]:
                    roof=translate(rotate(box(-width/2,-depth/2,width/2,depth/2),angle,origin=(0,0),use_radians=True),origin_x+x,origin_z+z)
                    print('  allowed:',label,round(overlap.intersection(roof).area,3),'m²')
                    overlap=overlap.difference(roof.buffer(.001))
            for part in getattr(overlap,'geoms',[overlap]):
                if part.area>.001:
                    print('  overlap at world XZ:',tuple(round(value,2) for value in part.centroid.coords[0]),'area:',round(part.area,3))
            mesh_fail |= overlap.area>.001
            print('  non-exempt roof overlap:',round(overlap.area,3),'m²')
    obstructed=False
    for name, shot in cameras.items():
        number = Path(name).name[:2]
        if number not in ('03', '05', '06'):
            continue
        start = Point(shot['x'], shot['z'])
        angle = math.radians(shot['heading'])
        ray = LineString([start, (start.x + 300*math.sin(angle), start.y - 300*math.cos(angle))])
        hits = [(start.distance(ray.intersection(shape)), roof) for roof, shape in roofs.items() if ray.intersects(shape)]
        distance, roof=min(hits,default=(math.inf,None))
        print('Y'+number, 'first footprint:', distance, roof)
        obstructed |= distance < 3
    return bool(violations) or obstructed or mesh_fail


if __name__ == '__main__':
    sys.exit(main())
