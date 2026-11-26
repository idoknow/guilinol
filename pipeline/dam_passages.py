"""Apply the same surveyed dam mask before both vessel graph builds."""
import json
from pathlib import Path

from common import GRID


def apply_dams(surface, left, top):
    directory = Path(__file__).parent
    footprints = json.loads((directory/'dam-cells.json').read_bytes())
    passages = json.loads((directory/'dam-passages.json').read_bytes())
    dry = -32768
    height, width = surface.shape
    for dam, runs in footprints.items():
        passage = passages.get(dam, {})
        openings = set(map(tuple, passage.get('cells', [])))
        if 'gateCell' in passage:
            openings.add(tuple(passage['gateCell']))
        for row, start, end in runs:
            for col in range(start, end+1):
                iz, ix = row-top//GRID, col-left//GRID
                if 0 <= iz < height and 0 <= ix < width and (col,row) not in openings:
                    surface[iz,ix] = dry
        missing = []
        for col,row in openings:
            iz, ix = row-top//GRID, col-left//GRID
            if 0 <= iz < height and 0 <= ix < width and surface[iz,ix] == dry:
                missing.append((iz,ix))
        levels = []
        for iz,ix in missing:
            nearby = surface[max(0,iz-2):iz+3, max(0,ix-2):ix+3]
            wet = nearby[nearby != dry]
            if not wet.size:
                raise ValueError(f'{dam}: no water adjacent to ferry passage')
            levels.append(round(wet.mean()))
        for (iz,ix),level in zip(missing, levels):
            surface[iz,ix] = level


def fit_shore_banks(directory):
    """Seat the two ferry-affected bank reaches on the shipped ground triangles."""
    import gzip
    import struct

    from landmarks.world_surface import Surface

    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    ground = Surface(directory, manifest)
    reaches = ((-202, -1578, -180, -1562), (-1568, 1058, -1548, 1078))
    for tile in manifest["chunks"]:
        ox, oz = tile["x"], tile["z"]
        nearby = [(x0,z0,x1,z1) for x0,z0,x1,z1 in reaches
                  if ox-2 <= x1 and ox+ground.size+2 >= x0
                  and oz-2 <= z1 and oz+ground.size+2 >= z0]
        if not nearby:
            continue
        path = directory / tile["file"]
        data = gzip.decompress(path.read_bytes())
        vertices, indices, size = struct.unpack_from("<3I", data, 4)
        offset = 16924 + vertices*9 + indices*4
        collision = json.loads(data[offset:offset+size])
        changed = False
        for bank in collision[1][2]:
            old_start, old_end = bank[4], bank[6] if len(bank) > 6 else bank[4]
            tops = [old_start, old_end]
            for end in (0, 1):
                x, z = ox+bank[2*end]/10, oz+bank[2*end+1]/10
                if any(x0 <= x <= x1 and z0 <= z <= z1 for x0,z0,x1,z1 in nearby):
                    height, _ = ground.sample(x, z, include_peaks=False)
                    tops[end] = round(10*height)
            if tops != [old_start, old_end]:
                bank[4:] = [tops[0], min(bank[5], min(tops)-12), tops[1]]
                changed = True
        if changed:
            encoded = json.dumps(collision, separators=(",", ":")).encode()
            packed = gzip.compress(data[:12]+struct.pack("<I",len(encoded))+data[16:offset]
                                   +encoded+data[offset+size:], compresslevel=5, mtime=0)
            path.write_bytes(packed)
            tile["bytes"] = len(packed)
    manifest_path.write_text(json.dumps(manifest,separators=(",", ":"))+"\n")
