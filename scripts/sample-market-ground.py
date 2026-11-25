"""Save the 4 m terrain vertices below the market for independent GLB builds."""
import gzip
import json
import sys
from pathlib import Path

import numpy as np

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'pipeline'))
from common import ll2xz

world=root/'public/world'
market=next(entry for entry in json.loads((root/'pipeline/landmarks.json').read_text()) if entry['id']=='wangcheng_market')
ring=np.array([ll2xz(lat,lon) for lon,lat in market['replace']['polygon']]);lower=(np.floor(ring.min(axis=0)/4)*4).astype(int);upper=(np.ceil(ring.max(axis=0)/4)*4).astype(int)
grid=np.full(tuple((upper-lower)[::-1]//4+1),-32768,dtype='<i2')
for chunk in json.loads((world/'manifest.json').read_text())['chunks']:
    start=np.array([chunk['x'],chunk['z']]);lo=np.maximum(start,lower);hi=np.minimum(start+256,upper)
    if (hi<lo).any():continue
    def slices(origin):
        return tuple(slice(int(a),int(b)+1) for a,b in zip(((lo-origin)//4)[::-1],((hi-origin)//4)[::-1]))
    heights=np.frombuffer(gzip.decompress((world/chunk['file']).read_bytes()),'<i2',65*65,24).reshape(65,65)
    grid[slices(lower)]=heights[slices(start)]
assert grid.min()>-32768
np.savez_compressed(root/'.ops-docs/layout/dongxi-ground.npz',lower=lower,heights=grid)
