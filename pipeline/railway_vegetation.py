"""Vegetation support on the final paved railway approaches."""
import gzip
import json
import struct

import numpy as np


def stem_support(stems,tile):
    from shapely import Polygon, STRtree, points
    from road_grading import eval_bspline_grid
    x,z = stems[:,:2].T.astype(float)/100
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
    offset = np.zeros(len(stems))
    paved = np.zeros(len(stems),dtype=bool)
    if len(paths)>5 and paths[5]:
        base,values = paths[5]
        ctrl = (base+np.array(values).reshape(35,35))/1000
        surface = eval_bspline_grid(ctrl,0,0,x,z)
        rings = paths[0][:paths[11][0]] if len(paths)>11 and paths[11] else paths[0]
        for kinds,lift in (((0,5),.045),((2,),.06),((1,4,6),.195)):
            shapes = [Polygon(shell,holes) for kind,shell,*holes in rings if kind in kinds and len(shell)>=3]
            hits,_ = STRtree(shapes).query(points(stems[:,:2]),predicate='within')
            y[hits] = np.maximum(surface[hits],y[hits])
            offset[hits] = lift
            if 0 in kinds:
                paved[hits] = True
    return y+offset,paved

def plant_graded_approaches(directory, manifest, grades):
    """Place vegetation after the final street paving, bridge and terrain pass."""
    from scipy.ndimage import maximum_filter
    from shapely import box, points
    from landmarks.world_surface import PeakSurface


    ox,oz = manifest['extent'][:2]
    peaks = PeakSurface(directory,manifest['peaks'],ox,oz,manifest['chunkSize'])
    for tile in manifest['chunks']:
        x,z = tile['x'],tile['z']
        masks = []
        for field,previous,step,size in zip(grades.after,grades.before,(4,4,8),(65,65,35)):
            i,j = (x-grades.left)//step,(z-grades.top)//step
            window = np.s_[j:j+size,i:i+size]
            masks.append(field[window]!=previous[window])
        new_paving = grades.pavement
        on_paving = new_paving is not None and len(new_paving.query(box(x,z,x+256,z+256)))
        if not on_paving and not any(mask.any() for mask in masks):
            continue
        file = directory/tile['file']
        trees = file.with_suffix('.trees')
        stems = np.frombuffer(gzip.decompress(trees.read_bytes()),'<u2').reshape(-1,6).copy()
        if not len(stems):
            continue
        y,paved = stem_support(stems,file.read_bytes())
        existing = stems[:,2].view('<i2')/10
        tx,tz = stems[:,:2].T.astype(float)/100
        active = np.zeros(len(stems),dtype=bool)
        for mask,step in zip(masks,(4,4,8)):
            # Include the 32 m boundary chord and cubic street supports.
            halo = int(step==8)
            active |= maximum_filter(mask,size=17 if step==4 else 5)[
                np.minimum((tz/step).astype(int)+halo,mask.shape[0]-1),
                np.minimum((tx/step).astype(int)+halo,mask.shape[1]-1)]
        new_surface = np.zeros(len(stems),dtype=bool)
        if on_paving:
            hits,_ = new_paving.query(points(x+tx,z+tz),predicate='intersects')
            new_surface[hits] = True
        paved &= new_surface
        changed = (active|new_surface)&(abs(existing-y)>.075)
        for idx in np.flatnonzero(changed):
            px,pz = stems[idx,:2]/100
            rock = peaks.height(x+px,z+pz,y[idx])
            if abs(rock-existing[idx])<abs(y[idx]-existing[idx]):
                changed[idx] = False
        if not (changed.any() or paved.any()):
            continue
        stems[changed,2] = np.rint(10*y[changed]).astype('<i2')
        trees.write_bytes(gzip.compress(stems[~paved].tobytes(),mtime=0))
