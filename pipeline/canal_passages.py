"""Grade the two surface streets and open only the mapped ground-floor passages."""
import gzip
import json
import math
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, box
from features import area, building_mesh, points, polygons

# Service road, residential footprint, existing short bridge.
CROSSINGS = ((1025751314, 1551968228, 1025751315), (1034716138, 1568418630, 1034716139))


def sample_road_heights(output, manifest, positions):
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as tmp:
        request = Path(tmp)/'heights.json'
        request.write_text(json.dumps(dict(manifest=manifest,positions=positions)))
        subprocess.run([str(root/'node_modules/.bin/tsx'),'scripts/vehicle-grounding.ts',
                        'passage-heights',str(output.resolve()),str(request)],cwd=root,check=True)
        return json.loads(request.read_text())


def plan(output, manifest, elements, widths):
    wanted = {ref for crossing in CROSSINGS for ref in crossing}
    ways = {w['id']: w for w in elements if w['type']=='way' and w['id'] in wanted}
    positions, roads = [], []
    x,z,w,h = manifest['extent']
    for street, house, bridge in CROSSINGS:
        if not all(ref in ways for ref in (street,house,bridge)):
            continue
        axis = LineString(points(ways[street]))
        if not box(x,z,x+w,z+h).covers(axis):
            continue
        half = widths.get(street,4)/2+.5
        coords = list(axis.coords)
        for ref,(px,pz) in zip(ways[street]['nodes'],coords,strict=True):
            sample = dict(x=px,z=pz)
            bridge_nodes = ways[bridge]['nodes']
            if ref in (bridge_nodes[0],bridge_nodes[-1]):
                neighbor = points(ways[bridge])[1 if ref==bridge_nodes[0] else -2]
                sample['bridge'] = [neighbor[0]-px,neighbor[1]-pz]
            positions.append(sample)
        roads.append((house,axis,half))
    if not roads:
        return []
    levels = iter(sample_road_heights(output,manifest,positions))
    grades = []
    for house,axis,half in roads:
        coords = list(axis.coords)
        ys = [next(levels) for _ in coords]
        structure = area(ways[house])
        heights = []
        for a,b,ya,yb in zip(coords,coords[1:],ys,ys[1:]):
            line = LineString([a,b])
            if abs(yb-ya) > .08*line.length:
                raise ValueError(f'Canal passage {house} exceeds the 8% grade limit')
            grades.append((line,half,ya,yb,.08,0))
            overlap = line.intersection(structure.buffer(half))
            if not overlap.is_empty:
                # The grade baker eases the linear interpolation at the ends.
                # Bound its height over the opening, including mesh quantization.
                blend = max(0,min(.12,1-abs(yb-ya)/(.08*line.length)))
                for point in overlap.coords:
                    t=line.project(Point(point))/line.length
                    f=t if not blend else (t*t/(2*blend) if t<blend else
                       1-blend-(1-t)**2/(2*blend) if t>1-blend else t-blend/2)/(1-blend)
                    heights.append(ya+(yb-ya)*f)
        soffit = math.ceil((max(heights)+3.51)*10)/10
        open_building(output,manifest['chunks'],structure,axis,half,soffit,house)
    return grades


def open_building(output, chunks, footprint, axis, half, soffit, ident):
    corridor = axis.buffer(half)
    # Old tiles can omit a residential wing altogether. Reconstruct the
    # entrance bay within its OSM outline, keeping the rest of the tile intact.
    bay = footprint.intersection(axis.buffer(half+3))
    lane_interior = corridor.buffer(-.02)
    for tile in chunks:
        x,z = tile['x'],tile['z']
        bounds = box(x,z,x+256,z+256)
        if not bay.intersects(bounds):
            continue
        origin = np.array([x,z])
        file = output/tile['file']
        data = gzip.decompress(file.read_bytes())
        magic,nv,ni,size,png,deck = struct.unpack_from('<4s5I',data)
        start = 24+16900
        offset = start+nv*9+ni*4
        collision = json.loads(data[offset:offset+size])
        parts, split = [], []
        found = False
        for bottom,top,loops,kind,floors,seed,anchor,rect,complex_shape,*flags in collision[0]:
            shell,*holes = [np.array(loop)/100+origin for loop in loops]
            poly = Polygon(shell,holes)
            center = Point(np.array(anchor)/100+origin) if anchor else Point(x-1,z-1)
            attrs = (kind,floors,seed,center,rect,complex_shape)
            if poly.intersection(lane_interior).area>.01 and footprint.intersection(poly).area>.9*poly.area:
                found = True
                if not any(flags):
                    split.append((poly,bottom/10,top/10,attrs))
                    continue
            parts.append((poly,(bottom/10,top/10,*attrs,*flags)))
        if not found:
            for poly in polygons(bay.intersection(bounds)):
                if poly.area>.01:
                    split.append((poly,soffit-3.6,soffit+5.7,(0,3,ident%65536,poly.representative_point(),[],False)))
        if not split:
            continue
        for poly,base,roof,attrs in split:
            if soffit >= roof:
                raise ValueError(f'Insufficient building height for {ident}')
            parts.append((poly,(soffit,roof,*attrs,True)))
            for wing in polygons(poly.difference(corridor)):
                parts.append((wing,(base,soffit,attrs[0],1,attrs[2],Point(x-1,z-1),[],False)))
        vertices,normals,indices,collision[0] = building_mesh(parts,origin)
        packed = json.dumps(collision,separators=(',',':')).encode()
        header = struct.pack('<4s5I',magic,len(vertices)//6,len(indices)//4,len(packed),png,deck)
        file.write_bytes(gzip.compress(header+data[24:start]+vertices+normals+indices+packed+data[offset+size:],mtime=0))
        tile['bytes']=file.stat().st_size
