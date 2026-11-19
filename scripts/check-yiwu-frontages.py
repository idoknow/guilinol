"""After npm run world: check the model envelopes against compiled streets."""
import gzip
import json
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import trimesh
from shapely import affinity
from shapely.geometry import Polygon, box

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'pipeline'))
from common import load_osm
from features import area

world = root/'public/world'
manifest = json.loads((world/'manifest.json').read_bytes())
elements = {f"{item['type']}/{item['id']}": item for item in load_osm()}
entries = json.loads((root/'pipeline/landmarks.json').read_bytes())
for name in ('yiwu_office','yiwu_old_house'):
    entry = next(item for item in entries if item['id']==name)
    assert entry['replace']==[entry['anchor']]
    position = next(item['position'] for item in manifest['landmarks'] if item['id']==name)
    with tempfile.TemporaryDirectory() as temp:
        subprocess.run([sys.executable,root/'pipeline/landmarks'/f'{name}.py',temp],check=True)
        low,high = trimesh.load_scene(Path(temp)/f'{name}.glb').bounds
    envelope = box(low[0],low[2],high[0],high[2])
    envelope = affinity.rotate(envelope,-entry['rotation'],origin=(0,0))
    envelope = affinity.translate(envelope,position[0],position[2])
    assert area(elements[entry['anchor']]).covers(envelope), f'{name} outside its OSM footprint'
    distances = [float('inf'),float('inf')]
    for tile in manifest['chunks']:
        east,south = tile['x'],tile['z']
        if envelope.distance(box(east,south,east+256,south+256))>30:continue
        data = gzip.decompress((world/tile['file']).read_bytes())
        magic,vertices,indices,length,_,_ = struct.unpack_from('<4s5I',data)
        assert magic==b'GL04'
        offset = 24+4*65*65+9*vertices+4*indices
        paths = json.loads(data[offset:offset+length])[1][0]
        for kind,*rings in paths:
            if kind not in (0,1):continue
            loops=[[(east+dx/100,south+dz/100) for dx,dz in ring] for ring in rings]
            shape=Polygon(loops[0],loops[1:])
            distances[kind]=min(distances[kind],envelope.distance(shape))
    assert all(0<distance<30 for distance in distances), (name,distances)
    print(f'{name}: road {distances[0]:.2f} m, sidewalk {distances[1]:.2f} m')
