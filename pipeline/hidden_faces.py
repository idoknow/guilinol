"""Trim render indices in generator GLBs without re-exporting materials or collision nodes."""
import gzip
import json
import math
import struct

import numpy as np
from trimesh.transformations import quaternion_matrix


class GroundFloor:
    """A conservative lower bound on the rendered ground over a mesh footprint."""
    def __init__(self, world):
        self.world = world
        manifest = world / 'manifest.json'
        data = json.loads(manifest.read_bytes()) if manifest.exists() else {}
        self.entries = {e['id']: e for e in data.get('landmarks', [])}
        tiles = data.get('chunks', [])
        if tiles:
            self.west, self.north, width, depth = data['extent']
            # Include the ninth support sample on both edges of each 32 m cell.
            # This bounds wet 4 m terrain, dry 8 m terrain, seam interpolation
            # and the 32 m overview even where their triangles differ.
            self.minimum = np.full((depth//32+2,width//32+2), -np.inf)
            for tile in tiles:
                grid, wet = self.underlay(world / tile['file'])
                cells = np.lib.stride_tricks.sliding_window_view(grid,(9,9))[::8,::8]
                col = (tile['x']-self.west)//32+1
                row = (tile['z']-self.north)//32+1
                # Preserve submerged caps. Pier footings and hull draft are
                # geometric contacts even where the water obscures their bases.
                water_cells = np.lib.stride_tricks.sliding_window_view(wet,(9,9))[::8,::8]
                dry = (water_cells == -32768).all(axis=(2,3))
                self.minimum[row:row+8,col:col+8] = np.where(dry,cells.min(axis=(2,3))/10,-np.inf)

    @staticmethod
    def underlay(path):
        raw = gzip.decompress(path.read_bytes())
        vertices, indices, collision, png, tris = struct.unpack_from('<5I', raw, 4)
        tail = 24 + 16900 + vertices*9 + indices*4 + collision + png + tris*18
        offset = tail if len(raw) == tail + 8450 else 24
        def grid(at):
            return np.frombuffer(raw, '<i2', count=4225, offset=at).reshape(65,65)
        return grid(offset),grid(24+8450)

    def local_floor(self, key, points, faces):
        entry = self.entries.get(key)
        if not entry:
            return -math.inf
        x, y, z = entry['position']
        angle = math.radians(entry['rotation'])
        c, s = math.cos(angle), math.sin(angle)
        east = x + points[:, 0]*c + points[:, 2]*s
        south = z - points[:, 0]*s + points[:, 2]*c
        def limits(axis, start, size):
            cells = np.clip(np.floor((axis-start)/32).astype(int)+1,0,size-1)[faces]
            return cells.min(axis=1),cells.max(axis=1)
        x0,x1 = limits(east,self.west,self.minimum.shape[1])
        z0,z1 = limits(south,self.north,self.minimum.shape[0])
        floor = np.minimum.reduce([self.minimum[row,col] for row in (z0,z1) for col in (x0,x1)])
        # Large polygons can cross an unsampled interior cell.
        return np.where((x1-x0<=1)&(z1-z0<=1),floor-y,-np.inf)


def internal_contacts(ids, faces, pos, pairs):
    # Double-sided cards can also have reversed coincident triangles. An internal
    # interface has solid geometry extending away on BOTH sides of its perimeter.
    if not len(pairs):
        return pairs
    n = int(ids.max()) + 1
    def edges(a,b):
        return np.minimum(a,b).astype(np.int64)*n + np.maximum(a,b)
    candidate = {}
    for i, (face, _) in enumerate(pairs):
        for k in range(3):
            a,b = ids[face,k],ids[face,(k+1)%3]
            candidate.setdefault(int(edges(a,b)), []).append(i)
    keys = np.fromiter(candidate,np.int64)
    tris = pos[faces[pairs[:,0]]].astype(np.float64)
    normal = np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
    length = np.linalg.norm(normal,axis=1)
    sides = np.zeros(len(pairs),np.uint8)
    for k in range(3):
        edge = edges(ids[:,k],ids[:,(k+1)%3])
        for f in np.flatnonzero(np.isin(edge,keys)):
            point = pos[faces[f,(k+2)%3]]
            for i in candidate[edge[f]]:
                dot = np.dot(point-tris[i,0],normal[i])
                if dot > 1e-5*length[i]: sides[i] |= 1
                if dot < -1e-5*length[i]: sides[i] |= 2
    return pairs[sides==3]


def prune(path, key, ground):
    raw = path.read_bytes()
    length, = struct.unpack_from('<I', raw, 12)
    doc = json.loads(raw[20:20+length])
    binary = bytearray(raw[28+length:])
    uses = {}
    def visit(idx, parent, collision, underground):
        node = doc['nodes'][idx]
        name_l = node.get('name', '').lower()
        collision |= name_l.startswith('collision')
        underground |= 'underground' in name_l
        if 'matrix' in node:
            local = np.array(node['matrix']).reshape(4,4).T
        else:
            x,y,z,w = node.get('rotation', (0,0,0,1))
            local = quaternion_matrix((w,x,y,z)) @ np.diag([*node.get('scale',(1,1,1)),1])
            local[:3,3] = node.get('translation',(0,0,0))
        transform = parent @ local
        if 'mesh' in node:
            uses.setdefault(node['mesh'], []).append((collision,underground,transform))
        for child in node.get('children', []):
            visit(child, transform, collision, underground)
    for scene in doc['scenes']:
        for idx in scene['nodes']:
            visit(idx, np.eye(4), False, False)

    def read(idx, components):
        acc = doc['accessors'][idx]
        view = doc['bufferViews'][acc['bufferView']]
        dt = np.dtype({5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[acc['componentType']])
        return np.ndarray((acc['count'], components),dt,binary,
                          offset=view.get('byteOffset',0)+acc.get('byteOffset',0),
                          strides=(view.get('byteStride',dt.itemsize*components),dt.itemsize)).copy()

    before = removed = 0
    for idx, mesh in enumerate(doc['meshes']):
        nodes = uses.get(idx, [])
        if not nodes or any(is_collision for is_collision, _, _ in nodes):
            continue
        is_underground = any(is_ug for _, is_ug, _ in nodes)
        for primitive in mesh['primitives']:
            if primitive.get('mode',4)!=4:
                continue
            pos = read(primitive['attributes']['POSITION'],3)
            faces = (read(primitive['indices'],1) if 'indices' in primitive else np.arange(len(pos),dtype='<u4')).reshape(-1,3)
            before += len(faces)
            ids = np.unique(pos,axis=0,return_inverse=True)[1].reshape(-1)[faces]
            # Pair only distinct, opposite-winding coincident triangles. Same-facing
            # layers and triples can be paint, trim, or deliberate two-sided detail.
            _,inv,counts = np.unique(np.sort(ids,axis=1),axis=0,return_inverse=True,return_counts=True)
            pairs = np.flatnonzero(counts[inv]==2)
            pairs = pairs[np.argsort(inv[pairs])].reshape(-1,2)
            ordered = np.take_along_axis(ids,(np.argmin(ids,axis=1)[:,None]+np.arange(3))%3,axis=1)
            mates = pairs[ordered[pairs[:,0],1]==ordered[pairs[:,1],2]]
            hidden = np.zeros(len(faces),bool)
            hidden[internal_contacts(ids, faces, pos, mates).ravel()] = True
            if len(nodes)==1 and not is_underground:
                matrix = nodes[0][2]
                points = pos @ matrix[:3,:3].T + matrix[:3,3]
                floor = ground.local_floor(key,points,faces)
                tris = points[faces]
                normals = np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
                hidden |= (tris[:,:,1].max(axis=1)<=floor+1e-6) & (normals[:,1]<0)
            if not hidden.any() or hidden.all():
                continue
            kept = faces[~hidden].reshape(-1)
            removed += int(hidden.sum())
            binary.extend(bytes(-len(binary)%4))
            view = len(doc['bufferViews'])
            doc['bufferViews'].append(dict(buffer=0,byteOffset=len(binary),byteLength=kept.nbytes,target=34963))
            binary.extend(kept.tobytes())
            acc = dict(type='SCALAR',componentType={1:5121,2:5123,4:5125}[kept.itemsize],bufferView=view,
                       count=len(kept),min=[int(kept.min())],max=[int(kept.max())])
            primitive['indices'] = len(doc['accessors'])
            doc['accessors'].append(acc)
    if removed:
        doc['buffers'][0]['byteLength'] = len(binary)
        meta = json.dumps(doc,separators=(',',':')).encode()
        meta += b' '*(-len(meta)%4)
        binary.extend(bytes(-len(binary)%4))
        path.write_bytes(struct.pack('<4s4I',b'glTF',2,28+len(meta)+len(binary),len(meta),0x4E4F534A)
                         + meta + struct.pack('<II',len(binary),0x004E4942) + binary)
    return before, before-removed
