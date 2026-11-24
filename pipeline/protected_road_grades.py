"""Carry only changed road elevation samples into the published city tiles."""
import gzip
import json
import struct

import numpy as np


class ProtectedRoadGrades:
    def __init__(self, left, top, terrain, underlay, control):
        self.left, self.top = left, top
        self.after = (terrain, underlay, control)
        self.before = tuple(grid.copy() for grid in self.after)

    def affects_carriageway(self, start, end, half_width):
        """Compare the two supporting fields along this lane before fitting wheels."""
        from road_grading import eval_bspline_grid
        a,b = np.asarray(start),np.asarray(end)
        length = np.linalg.norm(b-a)
        if length<.01:
            return False
        along = np.linspace(0.,1.,max(2,int(np.ceil(length/3))+1))
        axis = a+(b-a)*along[:,None]
        side = (b-a)[::-1]*[-1.,1.]/length
        x,z = np.vstack([axis+side*d for d in (-half_width,0.,half_width)]).T
        # The ground mesh uses the native 4 m field or its 8 m decimation.
        # Check the containing vertices for both tessellations.
        for grid,old in zip(self.after[:2],self.before[:2]):
            for stride in (1,2):
                cols = np.clip(((x-self.left)/(4*stride)).astype(int)*stride,0,grid.shape[1]-stride-1)
                rows = np.clip(((z-self.top)/(4*stride)).astype(int)*stride,0,grid.shape[0]-stride-1)
                for di,dj in ((0,0),(stride,0),(0,stride),(stride,stride)):
                    if np.any(grid[rows+dj,cols+di]!=old[rows+dj,cols+di]):
                        return True
        cy = eval_bspline_grid(self.after[2],self.left,self.top,x,z)
        old_y = eval_bspline_grid(self.before[2],self.left,self.top,x,z)
        return bool(np.max(abs(cy-old_y))>.001)

    def apply(self, data, x, z):
        windows = []
        for grid, old, step, size in zip(self.after, self.before, (4,4,8), (65,65,35)):
            i,j = (x-self.left)//step,(z-self.top)//step
            patch = np.s_[j:j+size,i:i+size]
            windows.append((grid[patch], old[patch]))
        if all(np.array_equal(after,before) for after,before in windows):
            return data
        raw = gzip.decompress(data)
        magic, verts, indices, size, image, decks = struct.unpack_from('<4s5I',raw)
        field_size = 65*65*2
        start = 24+2*field_size+9*verts+4*indices
        end = start+size
        tail = end+image+decks*18
        if magic!=b'GL04' or len(raw)-tail not in (0,field_size):
            raise ValueError('Unsupported protected tile')
        surface = np.frombuffer(raw,'<i2',65*65,24).reshape(65,65)
        underlay = np.frombuffer(raw,'<i2',65*65,tail if len(raw)>tail else 24).reshape(65,65)
        def apply_bound(field, pair):
            after,before = pair
            return np.where(after>before,np.maximum(field,after),
                            np.where(after<before,np.minimum(field,after),field))
        surface = apply_bound(surface, windows[0]).astype('<i2')
        underlay = apply_bound(underlay, windows[1]).astype('<i2')
        collision = json.loads(raw[start:end])
        streets = collision[1]
        if len(streets)>5 and streets[5] and not np.array_equal(*windows[2]):
            base,deltas = streets[5]
            ctrl = (base+np.array(deltas).reshape(35,35))/1000
            mm = np.rint(1000*apply_bound(ctrl,windows[2])).astype(int)
            base = int(mm.min())
            streets[5] = [base,(mm-base).ravel().tolist()]
        encoded = json.dumps(collision,separators=(',',':')).encode()
        header = struct.pack('<4s5I',magic,verts,indices,len(encoded),image,decks)
        return gzip.compress(header+surface.tobytes()+raw[24+field_size:start]+encoded+
                             raw[end:tail]+(underlay.tobytes() if np.any(underlay!=surface) else b''),mtime=0)
