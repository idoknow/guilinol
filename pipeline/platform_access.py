"""Refine the existing GL04 terrain triangles at the mapped ends of passenger islands."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import Point, Polygon, box, constrained_delaunay_triangles
from shapely.geometry.polygon import orient

from landmarks.world_surface import Surface
from check_rail_platforms import pavement


def bake_access(world, manifest):
    config = json.loads(Path(__file__).with_name('rail-sections').joinpath('09-guilinbei-yard.json').read_bytes())
    surface = Surface(world, manifest)
    for ramp in config['platformAccess']:
        end = np.array(ramp['endXZ'])
        along = np.array(ramp['inward'])
        side = along[::-1]*[-1, 1]
        half = ramp['width']/2
        width = half+ramp['shoulder']
        length = ramp['length']
        toe = end-length*along
        def location(s, offset):
            return toe+(s+offset*ramp["endSkew"])*along+offset*side
        strip = Polygon([location(s,v) for s,v in [(0,-width),(length,-width),(length,width),(0,width)]])
        lip = np.array([location(length+.035,v) for v in [-half,half]])
        top = pavement(world.resolve(), [strip.buffer(2).bounds], lip)
        if not np.all(np.isfinite(top)):
            raise ValueError(f"Platform {ramp['platform']} has an unsupported ramp landing")
        tiles = []
        for tile in manifest['chunks']:
            origin = np.array([tile['x'],tile['z']])
            if not strip.intersects(box(*origin,*(origin+256))):
                continue
            grid, _, step = surface.tile(tuple(origin))
            grid = grid.copy()
            raw = gzip.decompress((world/tile['file']).read_bytes())
            v,i,n = struct.unpack_from('<3I',raw,4)
            offset = 16924+9*v+4*i
            collision = json.loads(raw[offset:offset+n])
            for idx, cm in collision[6] if len(collision)>6 else []:
                grid.flat[idx] = cm/100
            tiles.append((tile,origin,grid,step))

        def native(p):
            for _,origin,grid,step in tiles:
                local = (p-origin)/step
                if np.all(local>=0) and np.all(local<=len(grid)-1):
                    x,z = np.minimum(local.astype(int),len(grid)-2)
                    u,v = local-[x,z]
                    a,b,c,d = grid[z:z+2,x:x+2].flat
                    return a+(b-a)*u+(c-a)*v if u+v<=1 else d+(c-d)*(1-u)+(b-d)*(1-v)
            raise ValueError('Missing ramp terrain')
        low = np.array([native(location(0,v)) for v in [-half,half]])
        # Use the native crossfall at the toe and the passenger slab crossfall at the lip.
        if max(abs(top-low))/length>.08 or max(abs(top[1]-top[0]),abs(low[1]-low[0]))/ramp['width']>.02:
            raise ValueError(f"Platform access exceeds its grade limit: {ramp['platform']}, {low}, {top}")
        for tile, origin, grid, step in tiles:
            record = tile.setdefault('platformAccess', [])
            raster = []
            bounds = (np.array(strip.bounds).reshape(2,2)-origin)/step
            for z in range(max(0,int(np.floor(bounds[0,1]))),min(len(grid)-1,int(np.ceil(bounds[1,1])))):
                for x in range(max(0,int(np.floor(bounds[0,0]))),min(len(grid)-1,int(np.ceil(bounds[1,0])))):
                    idx = z*len(grid)+x
                    for ids in [(idx,idx+len(grid),idx+1),(idx+len(grid),idx+len(grid)+1,idx+1)]:
                        xy = origin+np.array([[j%len(grid),j//len(grid)] for j in ids])*step
                        face = Polygon(xy)
                        if face.intersection(strip).area<1e-8:
                            continue
                        tris = []
                        def append(poly,graded):
                            for tri in constrained_delaunay_triangles(poly).geoms:
                                pts = np.array(orient(tri,sign=-1).exterior.coords[:3])
                                for p in pts:
                                    y = native(p)
                                    if graded:
                                        off = np.dot(p-toe,side)
                                        s = np.clip((np.dot(p-toe,along)-off*ramp["endSkew"])/length,0,1)
                                        cap = np.interp(off,[-half,half],(1-s)*low+s*top)
                                        blend = np.clip((width-abs(off))/ramp['shoulder'],0,1)
                                        y += (cap-y)*blend
                                    tris.append([p[0]-origin[0],float(y),p[1]-origin[1]])
                        append(face.difference(strip), False)
                        for a,b in [(-width,-half),(-half,half),(half,width)]:
                            band = Polygon([location(s,v) for s,v in [(0,a),(length,a),(length,b),(0,b)]])
                            part = face.intersection(band)
                            if part.area>1e-9:append(part, True)
                        raster.append([list(ids),np.round(tris,6).tolist()])
            if raster:
                record.extend(raster)
