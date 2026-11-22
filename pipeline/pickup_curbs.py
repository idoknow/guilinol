import gzip
import json
from pathlib import Path


def align_jiefang_pickups(cars):
    curbs = {
        (-455.4, -47.4): (-432.7, 151.8, -59.0, 1.256),
        (-989.7, -195): (-1001.5, 151.5, -197.3, 1.393),
    }
    for car in cars:
        replacement = curbs.get((car[0], car[2]))
        if replacement:
            car[:4] = replacement


if __name__ == '__main__':
    from common import OUT

    output = Path(OUT)
    vehicles = output / 'vehicles.bin'
    manifest = output / 'manifest.json'
    data = json.loads(gzip.decompress(vehicles.read_bytes()))
    align_jiefang_pickups(data['cars'])
    vehicles.write_bytes(gzip.compress(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
    index = json.loads(manifest.read_text())
    index['vehicles']['bytes'] = vehicles.stat().st_size
    manifest.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
