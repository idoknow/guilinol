"""Prepare raw/ from a regional Overture export and project data mirrors."""

import argparse
import csv
import hashlib
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from refresh_osm import NODES, fetch_shards

from PIL import Image

SOUTH, WEST, NORTH, EAST = 25.188, 110.02, 25.372, 110.43
STAMP = '2026-11-23T00:38:06Z'


def export_overture(parquet, columns, destination, extra_filter=''):
    def literal(path):
        return "'" + str(path).replace("'", "''") + "'"

    query = f"""COPY (
      SELECT {columns} FROM read_parquet({literal(parquet)})
      WHERE bbox.xmax >= {WEST} AND bbox.xmin <= {EAST}
        AND bbox.ymax >= {SOUTH} AND bbox.ymin <= {NORTH} {extra_filter}
      ORDER BY id
    ) TO {literal(destination)} (HEADER, DELIMITER '\t')"""
    subprocess.run(['duckdb', ':memory:', '-c', 'LOAD spatial; ' + query], check=True)


def prepare(args, raw):
    dem = raw/'dem'
    dem.mkdir()
    def tile_x(lon):
        return math.floor((lon+180)/360 * 2**14)

    def tile_y(lat):
        return math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2 * 2**14)

    for x in range(tile_x(WEST), tile_x(EAST)+1):
        for y in range(tile_y(NORTH), tile_y(SOUTH)+1):
            path = dem/f'14_{x}_{y}.png'
            with urlopen(f'{args.terrarium.rstrip("/")}/14/{x}/{y}.png', timeout=60) as source:
                path.write_bytes(source.read())
            with Image.open(path) as tile:
                if tile.format != 'PNG' or tile.size != (256, 256):
                    raise ValueError(f'Invalid DEM tile {path.name}')
                tile.verify()

    handoff = re.sub(r'\[date:"[^"]+"\]', '', args.query.read_text())
    query, count = re.subn(r'\[bbox:[^\]]+\]', f'[date:"{STAMP}"][bbox:{SOUTH},{WEST},{NORTH},{EAST}]',
                           handoff, count=1)
    if count != 1 or ');' not in query:
        raise ValueError('Expected the handoff Overpass bbox and union in q.txt')
    query = re.sub(r'\[timeout:\d+\](?:\[maxsize:\d+\])?', '[timeout:900][maxsize:1073741824]', query, count=1)
    start, close, tail = query.rpartition(');')
    osm = raw/'osm-2026-11.json'
    try:
        if args.overpass:
            osm.write_bytes(fetch_shards(args.overpass, start + NODES + close + tail))
    except (URLError, TimeoutError, ValueError) as exc:
        if not args.pbf:
            raise
        print(f'Overpass failed ({exc}); using {args.pbf}', file=sys.stderr)
    if not osm.exists():
        subprocess.run([sys.executable, Path(__file__).with_name('pbf_to_overpass.py'), args.pbf, osm],
                       check=True)
    (raw/'q.txt').write_text(query)

    export_overture(args.buildings, 'id,height,num_floors,class,subtype,names.primary AS name,'
                    'roof_shape,ST_AsText(geometry) AS wkt,sources[1].dataset AS src', raw/'overture_buildings.csv')
    export_overture(args.places, 'id,names.primary AS name,ST_AsText(geometry) AS wkt', raw/'places.tsv')
    places = raw/'longmen.tsv'
    export_overture(args.places, 'id,names.primary AS name,ST_AsText(geometry) AS wkt', places,
                    "AND contains(to_json(names)::VARCHAR, '龙门村')")
    with places.open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            print(row)
    files = sorted(p for p in raw.rglob('*') if p.is_file())
    (raw/'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(raw)}\n'
                                         for p in files))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--query', required=True, type=Path, help='Original handoff raw/q.txt')
    parser.add_argument('--pbf', type=Path, help='Regional OSM PBF, used directly or on Overpass failure')
    parser.add_argument('--overpass', help='Project Overpass interpreter endpoint')
    parser.add_argument('--terrarium', required=True, help='Terrarium mirror URL prefix')
    parser.add_argument('--buildings', required=True, help='Local regional building Parquet path or glob')
    parser.add_argument('--places', required=True, help='Local regional place Parquet path or glob')
    parser.add_argument('--output', required=True, type=Path, help='New directory for this snapshot')
    args = parser.parse_args()
    if not args.overpass and not args.pbf:
        parser.error('supply --overpass or --pbf')
    if args.output.exists():
        parser.error('--output must name a new directory')
    with tempfile.TemporaryDirectory(dir=args.output.parent) as staging:
        snapshot = Path(staging)/'raw'
        snapshot.mkdir()
        prepare(args, snapshot)
        snapshot.rename(args.output)
