"""Carry only changed road elevation samples into the published city tiles."""
import gzip
import json
import struct

import numpy as np


class ProtectedRoadGrades:
    def __init__(self, left, top, terrain, underlay, control):
        self.pavement = None
        self.left, self.top = left, top
        self.after = (terrain, underlay, control)
        self.before = tuple(grid.copy() for grid in self.after)

    def retain_foundations(self, crossings):
        """Keep surveyed landmark pads and their terrain support continuous."""
        from pathlib import Path
        from shapely import Point, Polygon, STRtree, distance, points
        from common import ll2xz

        rail = STRtree([Point(r['x'],r['z']) for r in crossings])
        specs = json.loads(Path(__file__).with_name('landmarks.json').read_bytes())
        for spec in specs:
            coords = spec.get('flatten', {}).get('polygon', ())
            if len(coords)<3:
                continue
            foundation = Polygon([ll2xz(lat,lon) for lon,lat in coords])
            if len(rail.query(foundation,predicate='dwithin',distance=64)):
                continue
            xmin,zmin,xmax,zmax = foundation.buffer(60).bounds
            for step,field,old in zip((4,4,8),self.after,self.before):
                # The road control grid carries a one-knot halo.
                ox = self.left-(step if step==8 else 0)
                oz = self.top-(step if step==8 else 0)
                x,z = np.maximum(0,np.floor([(xmin-ox)/step,(zmin-oz)/step])).astype(int)
                xx,zz = np.minimum(field.shape[::-1],np.ceil([(xmax-ox)/step,(zmax-oz)/step])+1).astype(int)
                patch = np.s_[z:zz,x:xx]
                if np.array_equal(field[patch],old[patch]):
                    continue
                xs,zs = np.meshgrid(ox+step*np.arange(x,xx),oz+step*np.arange(z,zz))
                gap = distance(points(xs,zs),foundation)
                blend = np.clip((gap-16)/40,0,1)
                y = old[patch]+blend**2*(3-2*blend)*(field[patch].astype(float)-old[patch])
                field[patch] = np.rint(y) if step==4 else y

    def mark_pavement(self, patches):
        from shapely import STRtree
        self.pavement = STRtree(patches) if patches else None

    def affects_carriageway(self, start, end, half_width):
        """Compare the two supporting fields along this lane before fitting wheels."""
        from road_grading import eval_bspline_grid
        from shapely import LineString
        if self.pavement is not None and len(self.pavement.query(
                LineString([start,end]),predicate='dwithin',distance=half_width)):
            return True
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


def follow_graded_ground(trees, old_tile, new_tile):
    """Move restored vegetation with its original terrain or street support."""
    from shapely import Polygon, STRtree, points
    from road_grading import eval_bspline_grid

    stems = np.frombuffer(gzip.decompress(trees),'<u2').reshape(-1,6).copy()
    if not len(stems):
        return trees
    x,z = stems[:,:2].T.astype(float)/100
    def support(tile):
        raw = gzip.decompress(tile)
        verts,indices,size,image,decks = struct.unpack_from('<5I',raw,4)
        start = 24+16900+9*verts+4*indices
        tail = start+size+image+18*decks
        field = np.frombuffer(raw,'<i2',4225,tail if len(raw)>tail else 24).reshape(65,65)/10
        water = np.frombuffer(raw,'<i2',4225,8474).reshape(65,65)
        for bed,wet in ((field[0],water[0]),(field[-1],water[-1]),
                        (field[:,0],water[:,0]),(field[:,-1],water[:,-1])):
            if np.all(wet==-32768):
                bed[:] = np.interp(np.arange(65),np.arange(0,65,8),bed[::8])
        stride = 1 if np.any(water!=-32768) else 2
        u,v = x/(4*stride),z/(4*stride)
        i,j = (np.minimum(t.astype(int),64//stride-1) for t in (u,v))
        u,v = u-i,v-j
        g = field[::stride,::stride]
        a,b,c,d = g[j,i],g[j,i+1],g[j+1,i],g[j+1,i+1]
        y = np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))
        paths = json.loads(raw[start:start+size])[1]
        if len(paths)>5 and paths[5]:
            base,values = paths[5]
            ctrl = (base+np.array(values).reshape(35,35))/1000
            surface = eval_bspline_grid(ctrl,0,0,x,z)
            rings = paths[0][:paths[11][0]] if len(paths)>11 and paths[11] else paths[0]
            shapes = [Polygon(shell,holes) for kind,shell,*holes in rings if kind in (0,1,2) and len(shell)>=3]
            hits,_ = STRtree(shapes).query(points(stems[:,:2]),predicate='within')
            y[hits] = np.maximum(surface[hits],y[hits])
        return y
    delta = np.rint(10*(support(new_tile)-support(old_tile))).astype('<i2')
    if not delta.any():
        return trees
    stems[:,2] = stems[:,2].view('<i2')+delta
    return gzip.compress(stems.tobytes(),mtime=0)
