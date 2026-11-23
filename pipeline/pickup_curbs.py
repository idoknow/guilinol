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


def open_jiefang_westbound_lane(output, chunks, vehicles):
    """Allow the rendered primary carriageway beside the Zhengyang pedestrian entrance."""
    import struct
    import base64
    import numpy as np
    from shapely import LineString, Polygon, box, intersects_xy, union_all
    from common import load_osm
    from features import points

    way = next(el for el in load_osm() if el['type']=='way' and el['id']==258909993)
    districts = json.loads((Path(__file__).resolve().parents[1]/'web/src/game/car-free-polygons.json').read_bytes())
    entrance = next(z['rings'] for z in districts if z['osm']=='way/221821082')
    pedestrian = Polygon(entrance[0], entrance[1:])
    lane = LineString(points(way)).buffer(6).difference(pedestrian)
    carriageway = []
    for tile in chunks:
        x,z = tile['x'],tile['z']
        if not lane.intersects(box(x,z,x+256,z+256)):
            continue
        raw = gzip.decompress((output/tile['file']).read_bytes())
        vertices,indices,size = struct.unpack_from('<3I',raw,4)
        start = 24+16900+9*vertices+4*indices
        for kind,*loops in json.loads(raw[start:start+size])[1][0]:
            if kind==0:
                shell,*holes = [np.array(ring)/100+(x,z) for ring in loops]
                carriageway.append(Polygon(shell,holes).buffer(0))
    allowed = union_all(carriageway).intersection(lane)
    if allowed.is_empty:
        raise ValueError('Missing rendered Jiefang East Road westbound lane')
    left,top,width,height,step = vehicles['motorGrid']
    x0,z0,x1,z1 = allowed.bounds
    cols = np.arange(max(0,int((x0-left)//step)),min(width,int((x1-left)//step)+1))
    rows = np.arange(max(0,int((z0-top)//step)),min(height,int((z1-top)//step)+1))
    rr,cc = np.nonzero(intersects_xy(allowed,left+step*cols[None,:],top+step*rows[:,None]))
    cells = rows[rr]*width+cols[cc]
    mask = np.frombuffer(base64.b64decode(vehicles['motorMask']),dtype=np.uint8).copy()
    np.bitwise_or.at(mask,cells//8,(128>>(cells%8)).astype(np.uint8))
    vehicles['motorMask'] = base64.b64encode(mask).decode()


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
