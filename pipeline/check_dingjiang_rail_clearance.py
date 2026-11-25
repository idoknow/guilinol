"""Check the contact-wire envelope where the Dingjiang viaduct crosses other tracks."""
import argparse
import gzip
import json
import math
from pathlib import Path
import struct
import subprocess
from tempfile import NamedTemporaryFile

import numpy as np

from shapely import LineString, Point
from shapely.ops import substring

from common import CHUNK, load_osm
from dingjiang import RAIL, TIES
from dingjiang_structures import BRIDGES, TUNNEL as ROAD_TUNNEL
from features import points
from railways import BRIDGE, ELECTRIC, LEVEL, ROOT, TUNNEL


def encoded_track(world, tile, point, alignment):
    """GL04 has no way IDs. Match both segment ends to the source alignment."""
    x, z = point.coords[0]
    raw = gzip.decompress((world / tile['file']).read_bytes())
    vertices, indices, size = struct.unpack_from('<3I', raw, 4)
    start = 16924 + 9 * vertices + 4 * indices
    rails = json.loads(raw[start:start+size])[4]
    matches = []
    for ax, az, ay, bx, bz, by, _, flags, *_ in rails:
        a = Point(tile['x'] + ax/100, tile['z'] + az/100)
        b = Point(tile['x'] + bx/100, tile['z'] + bz/100)
        if max(alignment.distance(a), alignment.distance(b)) > .001:
            continue
        segment = LineString([a, b])
        distance = segment.distance(point)
        if distance <= .002:
            ratio = segment.project(point, normalized=True)
            matches.append((distance, (ay + ratio * (by-ay)) / 100, flags))
    if not matches:
        raise ValueError(f'No matching rail at {x:.3f}, {z:.3f} in {tile["file"]}')
    _, height, flags = min(matches)
    return height, flags


def check(world):
    manifest = json.loads((world / 'manifest.json').read_bytes())
    tiles = {(t['x'], t['z']): t for t in manifest['chunks']}
    tracks = {w['id']: LineString(points(w)) for w in load_osm()
              if w['type'] == 'way' and w.get('tags', {}).get('railway') == 'rail'}
    active = substring(tracks[RAIL], *TIES)
    checks = []
    for wid, line in tracks.items():
        if wid == RAIL:
            continue
        hits = active.intersection(line)
        for p in getattr(hits, 'geoms', [hits]):
            if p.is_empty:
                continue
            if p.geom_type != 'Point':
                raise ValueError(f'Overlapping centreline geometry on way {wid}')
            origin = tuple(math.floor(v/CHUNK)*CHUNK for v in p.coords[0])
            tile = tiles[origin]
            upper, top_flags = encoded_track(world, tile, p, tracks[RAIL])
            lower, low_flags = encoded_track(world, tile, p, line)
            if not top_flags & BRIDGE:
                raise ValueError(f'Missing viaduct at {origin} for way {wid}')
            # railwayGeometry emits the wire 6.10 m above an electrified,
            # non-level surface rail. Its bridge slab extends 1.20 m down.
            if low_flags & ELECTRIC and not low_flags & (LEVEL | TUNNEL):
                clear = upper - 1.20 - lower
                checks.append(dict(lowerWay=wid, stationM=tracks[RAIL].project(p),
                                   x=p.x, z=p.y, upperRailM=upper, lowerRailM=lower,
                                   targetM=7.5, soffitClearanceM=clear, wireHeadroomM=clear-6.10))
    return sorted(checks, key=lambda r: r['stationM'])


def coupled_road_crossings(world):
    """Use the baked bridge underside and the independent finished tunnel floor."""
    manifest = json.loads((world / 'manifest.json').read_bytes())
    tiles = {(t['x'], t['z']): t for t in manifest['chunks']}
    ways = {w['id']: w for w in load_osm() if w['type'] == 'way'}
    inventory = json.loads((ROOT/'docs/railway-crossings.json').read_bytes())
    rows = [r for r in inventory if r['road'] in BRIDGES | {ROAD_TUNNEL}]
    with NamedTemporaryFile(mode='w') as sample_file:
        json.dump(rows,sample_file)
        sample_file.flush()
        deck = json.loads(subprocess.check_output([
            ROOT/'node_modules/.bin/tsx',ROOT/'scripts/railway-road-heights.mjs',
            world,sample_file.name]))
    result = []
    for row in rows:
        rail,road = row['rail'],row['road']
        track = LineString(points(ways[rail]))
        p = track.intersection(LineString(points(ways[road])))
        tile = tiles[tuple(math.floor(v/CHUNK)*CHUNK for v in p.coords[0])]
        rail_y,_ = encoded_track(world,tile,p,track)
        if road in BRIDGES:
            key = '/'.join(str(row[k]) for k in ('rail','road','lat','lon'))
            road_y = deck[key]['deck']
            clear = deck[key]['soffit'] - rail_y
            target, wire = 7.5, clear - 6.10
        else:
            bore, = [t for t in manifest['tunnels'] if t['way']==road]
            axis = LineString([(x,z) for x,_,z in bore['portals']])
            road_y = float(np.interp(axis.project(p), *np.array(bore['stations']).T))
            clear = rail_y - 1.2 - road_y
            target, wire = 4.5, None
        result.append(dict(rail=rail,road=road,railheadM=rail_y,roadM=road_y,
                           targetM=target,actualM=clear,wireHeadroomM=wire))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    parser.add_argument('--roads',action='store_true',help='Audit both S2201 directions and the road tunnel')
    args = parser.parse_args()
    if args.roads:
        rows = coupled_road_crossings(args.world)
        print(json.dumps(rows,indent=2))
        raise SystemExit(len(rows)!=10 or any(r['actualM'] < r['targetM']-.00001 for r in rows))
    rows = check(args.world)
    print(json.dumps(rows, indent=2))
    expected = {259082251, 815078170, 983856620, 983856621, 983856622, 983856623}
    raise SystemExit({r['lowerWay'] for r in rows} != expected or
                     any(r['soffitClearanceM'] < r['targetM'] for r in rows))
