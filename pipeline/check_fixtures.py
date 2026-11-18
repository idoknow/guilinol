"""Compare the shipped GL04 fixture positions to the input OSM nodes."""
import gzip
import json
import struct
from collections import Counter
from pathlib import Path

from common import OUT, ll2xz, load_osm


world = Path(OUT)
manifest = json.loads((world/'manifest.json').read_text())
west,north,width,depth = manifest['extent']
expected,actual = Counter(),Counter()
for node in load_osm():
    kind=node.get('tags',{}).get('highway')
    if node['type']=='node' and kind in ('bus_stop','traffic_signals'):
        east,south=ll2xz(node['lat'],node['lon'])
        if west<east<west+width and north<south<north+depth:
            expected[kind,round(10*east),round(10*south)]+=1
for tile in manifest['chunks']:
    data=gzip.decompress((world/tile['file']).read_bytes())
    vertices,indices,size=struct.unpack_from('<III',data,4)
    start=24+4*65**2+9*vertices+4*indices
    _,streets=json.loads(data[start:start+size])
    for kind,items in zip(('traffic_signals','bus_stop'),streets[3:]):
        for east,south in items:
            actual[kind,10*tile['x']+east,10*tile['z']+south]+=1
assert actual==expected,(actual-expected,expected-actual)
print(Counter(key[0] for key in actual.elements()),'exact matches at decimetre precision')
