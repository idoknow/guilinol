"""Pack subsets of PK02 for the browser; full PK02 remains the build/audit input."""
import gzip
import math
import struct
from collections import defaultdict
from pathlib import Path


def write_peak_sectors(output: Path, peaks):
    source = gzip.decompress((output/peaks['file']).read_bytes())
    groups = defaultdict(list)
    entries = [entry for entry in peaks['entries'] if not entry.get('model')]
    size = 2048
    for entry in entries:
        x, _, z = entry['center']
        groups[math.floor(x/size), math.floor(z/size)].append(entry)

    def write(name, selected, coarse):
        data = bytearray(b'PK02')
        offsets = {}
        table = bytearray()
        for entry in selected:
            for level in range(2):
                section = entry['lods'][1 if coarse else level]
                for key, length in [('indexOffset', section['indices']*2), ('offset', section['vertices']*11)]:
                    pos = section[key]
                    if pos not in offsets:
                        offsets[pos] = len(data)
                        data.extend(source[pos:pos+length])
                    table.extend(struct.pack('<I', offsets[pos]))
        (output/name).write_bytes(table + gzip.compress(data, compresslevel=6, mtime=0))

    write('peaks-far.bin', entries, True)
    for (x,z), group in groups.items():
        write(f'peaks-{x}_{z}.bin', group, False)
    peaks['sectorSize'] = size


def write_distant_buildings(output, chunks):
    """Keep the largest GL04 building fragment in each 48 m cell of each tile."""
    import json
    payload = bytearray()
    for chunk in chunks:
        data = gzip.decompress((output/chunk['file']).read_bytes())
        vertices, indices, length = struct.unpack_from('<3I',data,4)
        offset = 24 + 2*65*65*2 + vertices*9 + indices*4
        rings = json.loads(data[offset:offset+length])[0]
        boxes = {}
        for base,roof,loops,kind,*_ in rings:
            xs,zs = zip(*loops[0])
            width,depth = (max(xs)-min(xs))/100,(max(zs)-min(zs))/100
            if min(width,depth)<4 or roof-base<40:
                continue
            x,z = (max(xs)+min(xs))/200,(max(zs)+min(zs))/200
            key = int(x//48),int(z//48)
            score = width*depth*(roof-base)
            if score>boxes.get(key,(0,))[0]:
                boxes[key] = (score,chunk['x']+x,chunk['z']+z,base,roof,width,depth,kind)
        for _,x,z,base,roof,width,depth,kind in boxes.values():
            payload.extend(struct.pack('<7h',round(x),round(z),base,roof,round(width),round(depth),kind))
    name = 'distant-buildings.bin'
    (output/name).write_bytes(gzip.compress(payload,mtime=0))
    return dict(file=name,bytes=(output/name).stat().st_size)


def write_opening(output, manifest):
    """Self-contained first terrain LOD: bounds, 64 m relief and baked colour."""
    import numpy as np
    view = manifest['overview']
    left, top, width, depth = manifest['extent']
    step = view['step']
    grid = np.fromfile(output/view['heights']['file'], dtype='<i2').reshape(depth//step+1, width//step+1)
    header = struct.pack('<4s4d4iI', b'GLF1', *manifest['bbox'], left, top, width, depth, 2*step)
    with (output/'opening.bin').open('wb') as out:
        out.write(header)
        out.write(grid[::2, ::2].tobytes())
        out.write((output/view['texture']['file']).read_bytes())


def write_city_lods(output, manifest):
    from PIL import Image
    if len(manifest['chunks'])<=512:
        return
    underlay = output/manifest['overview']['underlay']['file']
    packed = underlay.with_name('underlay-packed.bin')
    packed.write_bytes(gzip.compress(underlay.read_bytes(),mtime=0))
    manifest['overview']['packedUnderlay'] = dict(file=packed.name,bytes=packed.stat().st_size)
    write_peak_sectors(output, manifest['peaks'])
    manifest['distantBuildings'] = write_distant_buildings(output,manifest['chunks'])
    texture = output/manifest['overview']['texture']['file']
    width,depth = manifest['extent'][2:]
    with Image.open(texture) as image:
        reduced = image.convert('RGB').resize((width//16,depth//16), Image.Resampling.BOX).quantize(32)
    reduced.save(texture,optimize=True)
    manifest['overview']['texture']['bytes'] = texture.stat().st_size
    write_opening(output, manifest)


if __name__ == '__main__':
    import argparse
    import json

    parser = argparse.ArgumentParser(description='Build only the opening terrain from a finished world.')
    parser.add_argument('world', type=Path)
    directory = parser.parse_args().world
    write_opening(directory, json.loads((directory/'manifest.json').read_bytes()))
