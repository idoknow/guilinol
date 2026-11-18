"""Read back a generated default world; print its peak acceptance table."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import Polygon
from scipy.ndimage import map_coordinates

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
    houses = []
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
        vertices,indices,collision,_ = struct.unpack_from('<4I',blob,4)
        start = 20+16900+vertices*9+indices*4
        for _,_,rings in json.loads(blob[start:start+collision]):
            rings = [np.asarray(ring)/100+[tile['x'],tile['z']] for ring in rings]
            houses.append(Polygon(rings[0],rings[1:]))
    house_index = STRtree(houses)
    assert field.min()!=-32768
    assert np.array_equal(display[::8,::8].ravel(),np.fromfile(output/'overview.i16','<i2'))
    underlay = np.fromfile(output/'underlay.i16','<i2').reshape(display[::8,::8].shape)/10
    asset = output/manifest['peaks']['file']
    assert asset.stat().st_size<=1500000
    data = gzip.decompress(asset.read_bytes())
    assert data[:4]==b'PK01'
    print('|山名|目标 m|网格顶 m|OSM 最近 4 m 格点 m|基底平均半径 / 相对高度（m；比值）|shoulder|锥度|山脚至肩部平均坡度|来源|三角面（近/远）|\n|---|---:|---:|---:|---|---:|---:|---:|---|---:|')
    for entry in entries:
        name = entry['name']
        if 'model' in entry:
            continue
        peak = catalog[name]
        cx,target,cz = entry['center']
        assert target==peak['target']
        counts = []
        for level,lod in enumerate(entry['lods']):
            vertices = np.frombuffer(data,'<f4',lod['vertices']*8,lod['offset']).reshape(-1,8)
            indices = np.frombuffer(data,'<u2',lod['indices'],lod['offset']+vertices.nbytes)
            counts.append(len(indices)//3)
            assert indices.max()<len(vertices) and np.isfinite(vertices).all()
            assert np.allclose(np.linalg.norm(vertices[:,3:6],axis=1),1,atol=.0001)
            assert vertices[:,6:].min()>=0 and vertices[:,6:].max()<=1
            summit = vertices[:,1].max()
            assert abs(summit-target)<.001
            segments = 128 if level==0 else 32
            rings = vertices[:-1].reshape(-1,segments,8)
            outline = rings[0][:,[0,2]]
            coarse = map_coordinates(underlay,[(outline[:,1]-top)/32,(outline[:,0]-left)/32],order=1,mode='nearest')
            assert np.all(rings[0,:,1]<=coarse),name
            assert not house_index.query(Polygon(outline).buffer(-.01),predicate='intersects').size,name
            if level==0:
                assert len(rings)>=10 and counts[0]<=4000
                radii = np.linalg.norm(rings[:,:,[0,2]]-[cx,cz],axis=2)
                radius = radii[0].mean()
                relief = target-entry['baseHeight']
                shoulder = rings[6,:,1].mean()-entry['baseHeight']
                shoulder_fraction = shoulder/relief
                offset = vertices[-1,[0,2]]-[cx,cz]
                assert np.linalg.norm(offset)<=.15*radius,name
                shoulder_radii = np.linalg.norm(rings[6][:,[0,2]]-[cx,cz]-offset*shoulder_fraction**2,axis=1)
                shrink = radius-shoulder_radii.mean()
                taper = shrink/radius
                slope = np.rad2deg(np.arctan2(shoulder,shrink))
                assert abs(shoulder_fraction-peak['shoulder'])<.001 and .50<=peak['shoulder']<=.65,name
                assert abs(taper-peak['taper'])<.003 and .10<=taper<=.25 and slope>=70,name
                tip = np.linalg.norm(rings[-1][:,[0,2]]-[cx,cz]-offset,axis=1).mean()/radius
                assert .13<=tip<=.17 and radius/relief<=peak.get('aspect',.8)+.0001,name
        assert counts[0]>counts[1]
        grid_height = field[round((cz-top)/4),round((cx-left)/4)]/10
        if name in ('独秀峰','穿山','塔山'):
            assert abs(grid_height-target)<=3
        print(f"|{name}|{target:g}|{summit:g}|{grid_height:g}|{radius:.1f} / {relief:.1f}（{radius/relief:.2f}）|{shoulder_fraction:.1%}|{taper:.1%}|{slope:.1f}°|{peak['source']}|{counts[0]}/{counts[1]}|")


if __name__=='__main__':
    verify()
