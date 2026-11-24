"""Apply the remaining terrain-quantization and road interpolation error to finished roads."""
import gzip
import json
import struct
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from shapely import Point, STRtree, box

from station_levels import STYLE

ROOT = Path(__file__).resolve().parents[1]
CORE = 40.  # Includes the two 32 m terrain border support knots.
RADIUS = 110.


def lower_approaches(directory, chunks, corrections):
    points = [Point(x,z) for x,z,_ in corrections]
    tree = STRtree(points)
    for tile in chunks:
        x,z = tile['x'], tile['z']
        near = tree.query(box(x-8,z-8,x+264,z+264),predicate='dwithin',distance=RADIUS)
        if not len(near):
            continue

        def offsets(size, step, halo, quantized=False):
            xx,zz = np.meshgrid(x+np.arange(size)*step-halo,z+np.arange(size)*step-halo)
            drop = np.zeros_like(xx,dtype=float)
            for i in near:
                cx,cz,error = corrections[i]
                if quantized:
                    error = np.ceil(10*error)/10
                t = np.clip((RADIUS-np.hypot(xx-cx,zz-cz))/(RADIUS-CORE),0,1)
                drop = np.maximum(drop,error*t*t*(3-2*t))
            return drop

        file = directory/tile['file']
        raw = gzip.decompress(file.read_bytes())
        verts,indices,size,image,decks = struct.unpack_from('<5I',raw,4)
        start = 24+16900+9*verts+4*indices
        end = start+size
        tail = end+image+18*decks
        collision = json.loads(raw[start:end])
        paths = collision[1]
        if len(paths)>5 and paths[5]:
            base,values = paths[5]
            levels = base+np.asarray(values).reshape(35,35)-np.rint(1000*offsets(35,8,8)).astype(int)
            base = int(levels.min())
            paths[5] = [base,(levels-base).ravel().tolist()]
        def field(at):
            return np.frombuffer(raw,'<i2',4225,at).reshape(65,65)
        # A decimetre field can round a small correction away. Keep the road
        # spline authoritative and clear just the dry terrain under it.
        drop = np.rint(10*offsets(65,4,0,quantized=True)).astype('<i2')
        drop[field(8474)!=-32768] = 0
        surface = field(24)-drop
        underlay = field(tail if len(raw)>tail else 24)-drop
        encoded = json.dumps(collision,separators=(',',':')).encode()
        payload = (raw[:12]+struct.pack('<I',len(encoded))+raw[16:24]+surface.tobytes()+
                   raw[8474:start]+encoded+raw[end:tail])
        if np.any(surface!=underlay):
            payload += underlay.tobytes()
        from protected_road_grades import follow_graded_ground
        encoded_tile = gzip.compress(payload,compresslevel=5,mtime=0)
        trees = file.with_suffix('.trees')
        trees.write_bytes(follow_graded_ground(trees.read_bytes(),gzip.compress(raw,mtime=0),encoded_tile))
        file.write_bytes(encoded_tile)
        tile['bytes'] = file.stat().st_size


def fit_rendered_underpasses(directory, manifest, crossings):
    inventory = ROOT/'docs/railway-crossings.json'
    surfaces = {'/'.join(str(r[k]) for k in ('rail','road','lat','lon')):r for r in crossings
                if r['type']=='rail_over' and r['surfaceRoad']}
    affected = set()
    with NamedTemporaryFile(mode='w',suffix='.json',dir=directory) as metadata:
        json.dump(manifest,metadata);metadata.flush()
        command = [ROOT/'node_modules/.bin/tsx',ROOT/'scripts/railway-road-heights.mjs',
                   directory.resolve(),inventory,'--branch-deck',metadata.name]
        for _ in range(3):
            hits = json.loads(subprocess.check_output(command,input=b'[]',cwd=ROOT))
            corrections = []
            for key,record in surfaces.items():
                road = hits[key]['road']
                if road is None:
                    continue
                excess = road+STYLE['structureDepth']+STYLE['roadClearance']-record['railY']
                if excess>.0005:
                    center = record['x'],record['z']
                    affected.add(center)
                    corrections.append((*center,excess+.006))
            if not corrections:
                break
            lower_approaches(directory,manifest['chunks'],corrections)
    return [Point(x,z).buffer(RADIUS) for x,z in affected]
