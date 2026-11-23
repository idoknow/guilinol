"""The approved local-metre boundary shared by world generation and clients."""
import json
from pathlib import Path

from shapely.geometry import shape

from common import xz2ll


class PlayRegion:
    def __init__(self):
        definition = json.loads(Path(__file__).with_name('region.json').read_bytes())
        self.geometry = shape(definition['finalGeometry'])
        self.tiles = {(x, int(z)) for z, row in definition['chunkOriginsByZ'].items() for x in row}
        west, north, east, south = self.geometry.bounds
        north_lat, west_lon = xz2ll(west, north)
        south_lat, east_lon = xz2ll(east, south)
        self.bbox = [south_lat, west_lon, north_lat, east_lon]

    def manifest(self):
        ring = list(self.geometry.exterior.coords)
        return dict(local=ring, geographic=[xz2ll(x,z)[::-1] for x,z in ring],
                    chunks=sorted(self.tiles))


def restore_protected_tiles(output, chunks, entries):
    """Copy campus and inner-city assets by world origin from the published baseline."""
    import tarfile
    from shapely.geometry import box
    from shapely import union_all
    from legacy_core import CAMPUS_TILES, Downtown, cached_archive

    digest = '822cf08b60ac44bca075f9ac93a0f6492d16f26b3e05e677cf1f0e9b513f9b4e'
    archive = cached_archive(digest)
    definition = json.loads(Path(__file__).with_name('region.json').read_bytes())
    campus_zones = [f for f in definition['zones'] if any(word in f['name'] for word in
                    ('大学','学院','校区','学校','中学','小学'))]
    campuses = union_all([shape(f['geometry']) for f in campus_zones
                         if f['geometry']['type'] in ('Polygon','MultiPolygon')])
    campus_names = {f['name'] for f in campus_zones}
    with tarfile.open(archive, 'r:gz') as packed:
        manifest = json.load(packed.extractfile('world/manifest.json'))
    previous = {(t['x'],t['z']):t for t in manifest['chunks']}
    copies = {}
    for tile in chunks:
        x,z = tile['x'],tile['z']
        if (x,z) not in CAMPUS_TILES and Downtown.depth(x+128,z+128)<384 and not campuses.intersects(box(x,z,x+256,z+256)):
            continue
        ref = previous.get((x,z))
        if ref is None:
            continue
        tile['bytes'] = ref['bytes']
        for suffix in ('.glc','.trees'):
            src = Path(ref['file']).with_suffix(suffix)
            copies['world/'+str(src)] = (output/tile['file']).with_suffix(suffix)
    with tarfile.open(archive, 'r|gz') as packed:
        for member in packed:
            target = copies.pop(member.name,None)
            if target:
                target.write_bytes(packed.extractfile(member).read())
    if copies:
        raise ValueError('Missing protected tiles in the baseline archive')
    campus_entries = {e['id']:e for e in manifest['landmarks'] if e['name'] in campus_names}
    entries[:] = [campus_entries.get(e['id'],e) for e in entries]
