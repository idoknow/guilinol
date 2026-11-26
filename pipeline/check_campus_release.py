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


def check_tree_delta(before, after, removed):
    def records(data):
        return Counter(row[0] for row in struct.iter_unpack('12s', gzip.decompress(data)))

    old, new = records(before), records(after)
    expected = Counter(bytes.fromhex(record) for record in removed)
    return bool(expected) and not (new - old) and old - new == expected


def check_paving_delta(before, after, patches):
    if not patches:
        return False
    raw = gzip.decompress(before)
    vertices, indices, size = struct.unpack_from('<3I', raw, 4)
    start = 24 + 16900 + 9 * vertices + 4 * indices
    collision = json.loads(raw[start:start+size])
    streets = collision[1]
    lower = streets[11] if len(streets) > 11 else None
    insert = lower[0] if lower else len(streets[0])
    added = []
    for patch in patches:
        material, shell, *holes = patch['face']
        mask_shell, *mask_holes = patch['gap']
        face, gap = Polygon(shell, holes), Polygon(mask_shell, mask_holes)
        if (material not in (0, 1) or material != patch['kind'] or not face.is_valid or not gap.is_valid
                or face.area == 0 or not box(0, 0, 25600, 25600).covers(gap) or not gap.covers(face)):
            return False
        added.append(patch['face'])
    streets[0][insert:insert] = added
    if lower:
        lower[0] += len(added)
    encoded = json.dumps(collision, separators=(',', ':')).encode()
    expected = raw[:12] + struct.pack('<I', len(encoded)) + raw[16:start] + encoded + raw[start+size:]
    return gzip.decompress(after) == expected


def verify(reference, candidate, allowance=None):
    worlds = (reference, candidate)
    manifests = [json.loads((world/'manifest.json').read_bytes()) for world in worlds]
    tiles = [{(tile['x'], tile['z']): tile['file'] for tile in manifest['chunks']} for manifest in manifests]
    inner = {coord for coord in tiles[0] if Downtown.depth(coord[0]+CHUNK/2, coord[1]+CHUNK/2)>=CHUNK*1.5}
    if len(inner)!=252:
        raise ValueError('Reference must include the 252 downtown tiles')
    for coord in inner | CAMPUS_TILES:
        for suffix in ('.glc', '.trees'):
            files = [(world/table[coord]).with_suffix(suffix) for world, table in zip(worlds, tiles)]
            old, new = (file.read_bytes() for file in files)
            key = f'{coord[0]},{coord[1]}'
            rows = allowance[suffix].get(key, []) if allowance else []
            if rows:
                validate = check_tree_delta if suffix == '.trees' else check_paving_delta
                if not validate(old, new, rows):
                    raise ValueError(f'Unexplained {suffix} difference at {coord}')
            elif old != new:
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
    print(f'{len(inner)} inner tiles, {len(CAMPUS_TILES)} unique campus tiles, four landmarks: verified')


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference',type=Path)
    parser.add_argument('candidate',type=Path)
    parser.add_argument('--allow-idok279', type=Path, nargs=2, metavar=('DELETIONS', 'PAVING'))
    args = parser.parse_args()
    allowance = ({suffix: json.loads(file.read_bytes()) for suffix, file in zip(('.trees', '.glc'), args.allow_idok279)}
                 if args.allow_idok279 else None)
    verify(args.reference,args.candidate,allowance)
