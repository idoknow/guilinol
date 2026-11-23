"""Check the IDOK-165 campus release against a larger world by world coordinates."""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import struct

from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from legacy_core import CAMPUS_IDS, CAMPUS_TILES, CHUNK, Downtown


def verify(reference, candidate):
    worlds = (reference, candidate)
    manifests = [json.loads((world/'manifest.json').read_bytes()) for world in worlds]
    tiles = [{(tile['x'], tile['z']): tile['file'] for tile in manifest['chunks']} for manifest in manifests]
    inner = {coord for coord in tiles[0] if Downtown.depth(coord[0]+CHUNK/2, coord[1]+CHUNK/2)>=CHUNK*1.5}
    if len(inner)!=252:
        raise ValueError('Reference must include the 252 downtown tiles')
    for coord in inner | CAMPUS_TILES:
        for suffix in ('.glc', '.trees'):
            files = [(world/table[coord]).with_suffix(suffix) for world, table in zip(worlds, tiles)]
            if files[0].read_bytes()!=files[1].read_bytes():
                raise ValueError(f'Different {suffix} at {coord}')
    landmarks = [{entry['id']:entry for entry in manifest['landmarks'] if entry['id'] in CAMPUS_IDS}
                 for manifest in manifests]
    if set(landmarks[0])!=CAMPUS_IDS or landmarks[0]!=landmarks[1]:
        raise ValueError('Different campus landmarks')
    region = prep(unary_union([box(east,south,east+CHUNK,south+CHUNK) for east,south in CAMPUS_TILES]))
    def atlas_buildings(world):
        atlas = json.loads(gzip.decompress((world/'atlas.bin').read_bytes()))
        return Counter(tuple(ring) for ring in atlas['buildings'] if region.intersects(Polygon(zip(ring[::2],ring[1::2]))))
    def distant_buildings(world):
        records = struct.iter_unpack('<7h',gzip.decompress((world/'distant-buildings.bin').read_bytes()))
        return Counter(row for row in records if (row[0]//CHUNK*CHUNK,row[1]//CHUNK*CHUNK) in CAMPUS_TILES)
    for extract in (atlas_buildings,distant_buildings):
        before, after = map(extract,worlds)
        if before!=after:
            raise ValueError(f'{extract.__name__}: +{(after-before).total()} -{(before-after).total()}')
        print(f'{extract.__name__}: {before.total()} matches')
    print(f'{len(inner)} inner tiles, {len(CAMPUS_TILES)} unique campus tiles, four landmarks: identical')


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference',type=Path)
    parser.add_argument('candidate',type=Path)
    args = parser.parse_args()
    verify(args.reference,args.candidate)
