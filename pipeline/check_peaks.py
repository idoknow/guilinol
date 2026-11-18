"""Read back a generated default world; print its peak acceptance table."""
import gzip
import json
from pathlib import Path

import numpy as np

from common import OUT, load_osm


def verify():
    output = Path(OUT)
    manifest = json.loads((output/'manifest.json').read_text())
    left,top,width,depth = manifest['extent']
    south,west,north,east = manifest['bbox']
    catalog = {peak['name']:peak for peak in json.loads(Path(__file__).with_name('peaks.json').read_text())}
    expected = {node['tags']['name'] for node in load_osm() if node.get('tags',{}).get('natural')=='peak'
                and south<=node['lat']<=north and west<=node['lon']<=east}
    entries = manifest['peaks']['entries']
    assert {entry['name'] for entry in entries}==expected
    shape = depth//4+1,width//4+1
    field = np.full(shape,-32768,dtype='<i2')
    display = np.empty_like(field)
    for tile in manifest['chunks']:
        blob = gzip.decompress((output/tile['file']).read_bytes())
        assert blob[:4]==b'GL02'
        row,col = (tile['z']-top)//4,(tile['x']-left)//4
        ground,water = np.frombuffer(blob,'<i2',8450,20).reshape(2,65,65)
        window = np.s_[row:row+65,col:col+65]
        previous = field[window]
        assert ((previous==-32768)|(previous==ground)).all(), tile['file']
        field[window] = ground
        display[window] = np.where(water==-32768,ground,water)
    assert field.min()!=-32768
    assert np.array_equal(display[::8,::8].ravel(),np.fromfile(output/'overview.i16','<i2'))
    asset = output/manifest['peaks']['file']
    assert asset.stat().st_size<=1500000
    data = gzip.decompress(asset.read_bytes())
    assert data[:4]==b'PK01'
    print('|山名|目标 m|网格顶 m|最近 4 m 格点 m|来源|三角面（近/远）|\n|---|---:|---:|---:|---|---:|')
    for entry in entries:
        name = entry['name']
        if 'model' in entry:
            continue
        peak = catalog[name]
        cx,target,cz = entry['center']
        assert target==peak['target']
        counts = []
        for lod in entry['lods']:
            vertices = np.frombuffer(data,'<f4',lod['vertices']*8,lod['offset']).reshape(-1,8)
            indices = np.frombuffer(data,'<u2',lod['indices'],lod['offset']+vertices.nbytes)
            counts.append(len(indices)//3)
            assert indices.max()<len(vertices) and np.isfinite(vertices).all()
            assert np.allclose(np.linalg.norm(vertices[:,3:6],axis=1),1,atol=.0001)
            assert vertices[:,6:].min()>=0 and vertices[:,6:].max()<=1
            summit = vertices[:,1].max()
            assert abs(summit-target)<.001
        assert counts[0]>counts[1]
        grid_height = field[round((cz-top)/4),round((cx-left)/4)]/10
        if name in ('独秀峰','穿山','塔山'):
            assert abs(grid_height-target)<=3
        print(f"|{name}|{target:g}|{summit:g}|{grid_height:g}|{peak['source']}|{counts[0]}/{counts[1]}|")


if __name__=='__main__':
    verify()
