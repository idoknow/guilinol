"""Heights on the rendered GL04 terrain triangles and water quads."""
import gzip
import json
import math
import struct
from functools import lru_cache
from pathlib import Path

import numpy as np
import shapely

WORLD = Path(__file__).resolve().parents[2] / 'public/world'
DRY = -32768


class PeakSurface:
    def __init__(self, directory, peaks, left, top, size):
        self.left, self.top, self.size = left, top, size
        self.peak_tiles = {}
        packed = gzip.decompress((directory / peaks['file']).read_bytes())
        if packed[:4] != b'PK02':
            raise ValueError('Invalid packed mountain header')
        for peak in peaks['entries']:
            if not peak.get('model') and peak['lods']:
                lod = peak['lods'][0]
                vertices = np.frombuffer(packed,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100 + peak['center']
                faces = np.frombuffer(packed,'<u2',lod['indices'],lod['indexOffset']).reshape(-1,3)
                tris = vertices[faces]
                normal = np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
                valid = normal[:,1]>1e-8
                tris, normal = tris[valid], normal[valid]
                tree = shapely.STRtree(shapely.polygons(tris[:,:,::2]))
                lo,hi = np.floor((vertices[:,::2].min(axis=0)-[self.left,self.top])/self.size).astype(int), np.floor((vertices[:,::2].max(axis=0)-[self.left,self.top])/self.size).astype(int)
                for row in range(lo[1],hi[1]+1):
                    for col in range(lo[0],hi[0]+1):
                        self.peak_tiles.setdefault((col,row),[]).append((tree,tris[:,0],normal))

    def height(self,x,z,y):
        key = (math.floor((x-self.left)/self.size),math.floor((z-self.top)/self.size))
        for tree,points,normal in self.peak_tiles.get(key,()):
            faces = tree.query(shapely.Point(x,z),predicate='intersects')
            if len(faces):
                a, n = points[faces], normal[faces]
                heights = a[:,1]-((x-a[:,0])*n[:,0]+(z-a[:,2])*n[:,2])/n[:,1]
                y=max(y,float(heights.max()))
        return y


class Surface:
    def __init__(self, directory=WORLD):
        self.directory = Path(directory)
        manifest = json.loads((self.directory / 'manifest.json').read_text())
        self.left, self.top, self.width, self.depth = manifest['extent']
        self.size = manifest['chunkSize']
        self.grid = manifest['grid']
        self.files = {(c['x'], c['z']): c['file'] for c in manifest['chunks']}
        self.entries = {p['id']: p for p in manifest['landmarks']}

        self.peaks = PeakSurface(self.directory, manifest['peaks'], self.left, self.top, self.size)
        for peak in manifest['peaks']['entries']:
            if model := peak.get('model'):
                x, y, z = peak['center']
                self.entries[Path(model).stem] = dict(file=model, position=[x, peak.get('baseHeight', y), z], rotation=0)

    @lru_cache(maxsize=96)
    def tile(self, origin):
        data = gzip.decompress((self.directory / self.files[origin]).read_bytes())
        magic, vertices, indices, collision, image, deck = struct.unpack_from('<4s5I', data)
        n = self.size // self.grid + 1
        field_bytes = n * n * 2
        tail = 24 + 2 * field_bytes + vertices * 9 + indices * 4 + collision + image + deck * 18
        extra = len(data) - tail
        if magic != b'GL04' or extra not in (0, field_bytes):
            raise ValueError(f'Invalid GL04 at {origin}')
        def field(offset):
            return np.frombuffer(data, '<i2', n*n, offset).reshape(n, n)
        water = field(24 + field_bytes)
        ground = field(tail if extra else 24).astype(float) / 10
        # world.ts stitches dry chunk edges to the 32 m overview grid.
        for edge, wet in ((ground[0], water[0]), (ground[-1], water[-1]),
                          (ground[:, 0], water[:, 0]), (ground[:, -1], water[:, -1])):
            if np.all(wet == DRY):
                edge[:] = np.interp(np.arange(n), np.arange(0, n, 8), edge[::8])
        stride = 1 if np.any(water != DRY) else 2
        return ground[::stride, ::stride], water, self.grid * stride

    @lru_cache(maxsize=24)
    def roof_tile(self, origin):
        data = gzip.decompress((self.directory/self.files[origin]).read_bytes())
        _, vertices, indices, length, _, _ = struct.unpack_from('<4s5I',data)
        n = self.size//self.grid+1
        offset = 24+4*n*n+9*vertices+4*indices
        rings = json.loads(data[offset:offset+length])[0]
        shapes, levels = [], []
        for _,top,loops,*_ in rings:
            outlines = [np.asarray(loop)/100+origin for loop in loops]
            shapes.append(shapely.Polygon(outlines[0],outlines[1:]))
            levels.append(top/10)
        return shapely.STRtree(shapes),np.array(levels)

    def roof(self,x,z):
        origin=(self.left+math.floor((x-self.left)/self.size)*self.size,
                self.top+math.floor((z-self.top)/self.size)*self.size)
        tree,levels=self.roof_tile(origin)
        ids=tree.query(shapely.Point(x,z),predicate='intersects')
        return float(levels[ids].max()) if len(ids) else None

    def sample(self, x, z):
        if not (self.left <= x <= self.left+self.width and self.top <= z <= self.top+self.depth):
            raise ValueError(f'Outside world extent at {(x, z)}')
        ox = min(self.left+self.width-self.size, self.left + math.floor((x-self.left)/self.size)*self.size)
        oz = min(self.top+self.depth-self.size, self.top + math.floor((z-self.top)/self.size)*self.size)
        ground, water, step = self.tile((ox, oz))
        def cell(spacing):
            u, v = (x-ox)/spacing, (z-oz)/spacing
            i, j = min(int(u), self.size//spacing-1), min(int(v), self.size//spacing-1)
            return i, j, u-i, v-j
        i, j, u, v = cell(step)
        (a, b), (c, d) = ground[j:j+2, i:i+2]
        y = a+(b-a)*u+(c-a)*v if u+v <= 1 else d+(c-d)*(1-u)+(b-d)*(1-v)
        y = self.peaks.height(x,z,y)
        i, j, _, _ = cell(self.grid)
        level = water[j:j+2, i:i+2].max()
        return float(y), None if level == DRY else float(level)/10


class LandmarkSurface:
    def __init__(self, surface, landmark):
        self.name = landmark
        self.surface = surface
        entry = surface.entries[landmark]
        self.x, self.y, self.z = entry['position']
        angle = math.radians(entry['rotation'])
        self.cos, self.sin = math.cos(angle), math.sin(angle)

    def sample(self, x, z):
        ground, water = self.surface.sample(self.x+self.cos*x+self.sin*z, self.z-self.sin*x+self.cos*z)
        return ground-self.y, None if water is None else water-self.y

    def roof(self,x,z):
        height=self.surface.roof(self.x+self.cos*x+self.sin*z,self.z-self.sin*x+self.cos*z)
        return None if height is None else height-self.y

    def ground(self, x, z):
        return self.sample(x, z)[0]

    def water(self, x, z):
        return self.sample(x, z)[1]
