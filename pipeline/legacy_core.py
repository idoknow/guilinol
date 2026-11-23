"""Preserve the published downtown tiles and blend their outer 256 m ring."""
import gzip
import hashlib
import io
import json
import os
import struct
import subprocess
import tarfile
import tempfile
from pathlib import Path

import numpy as np

from common import CHUNK, GRID, ll2xz

DIGEST = 'd604950786524c6c0b805cab104934c155c67ca57b85939503ff83d536a9be1a'
EXPANDED_DIGEST = '2e678ff382e823a95f406cc94a317bf9ed81b3bc2d66eace717a5a4d23edd32d'
EXTENT = (-2304, -2560, 3584, 5888)

PINGFENG_ROWS = {-4:(3,4,5,6), -3:(3,4,5,6,7), -2:(3,4,5,6), -1:(3,4,5,6), 0:(3,4)}
THREE_CAMPUS_ROWS = {-5:(11,12,13), -4:(10,11,12,13,14), -3:(7,8,10,11,12,13),
                     -2:(7,8,10,11,12,13), -1:(7,8), 3:(7,8,9), 4:(6,7,8,9,10,11),
                     5:(6,7,8,9,10,11), 6:(7,8,9,10,11)}
CAMPUS_TILES = {(col*CHUNK,row*CHUNK) for rows in (PINGFENG_ROWS,THREE_CAMPUS_ROWS)
                for row,cols in rows.items() for col in cols}
CAMPUS_IDS = {'glut_pingfeng','guet_jinjiling','gxnu_yucai','guet_liuhe'}


def cached_archive(digest):
    release = 'world-' + digest[:12]
    cache = Path(__file__).resolve().parents[1]/'.world-cache'
    cache.mkdir(exist_ok=True)
    path = cache/(release+'.tar.gz')
    if not path.exists():
        with tempfile.TemporaryDirectory(dir=cache) as staging:
            incoming = Path(staging)/'world.tar.gz'
            subprocess.run(['gh','release','download',release,'-R','idoknow/guilinol',
                            '-p','world.tar.gz','-D',staging],check=True)
            if hashlib.sha256(incoming.read_bytes()).hexdigest()!=digest:
                raise ValueError('Incorrect downtown world release checksum')
            os.replace(incoming,path)
    with path.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest()!=digest:
            raise ValueError(f'Invalid cached world release: {path}')
    return path


def snapshot():
    packed = cached_archive(DIGEST).read_bytes()
    with tarfile.open(fileobj=io.BytesIO(packed),mode='r:gz') as archive:
        return {f.name.removeprefix('world/'):archive.extractfile(f).read()
                for f in archive if f.isfile() and f.name.startswith('world/')}


def preserve_campus_indexes(output, entries):
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    from shapely.prepared import prep

    with tarfile.open(cached_archive(EXPANDED_DIGEST),'r:gz') as archive:
        baseline = json.load(archive.extractfile('world/manifest.json'))
        reference = json.loads(gzip.decompress(archive.extractfile('world/atlas.bin').read()))
    campuses = [entry for entry in baseline['landmarks'] if entry['id'] in CAMPUS_IDS]
    if {entry['id'] for entry in campuses} != CAMPUS_IDS:
        raise ValueError('Missing published campus landmark')
    entries[:] = [entry for entry in entries if entry['id'] not in CAMPUS_IDS] + campuses
    region = prep(unary_union([box(east,south,east+CHUNK,south+CHUNK) for east,south in CAMPUS_TILES]))
    def overlaps(ring):
        return region.intersects(Polygon(zip(ring[::2],ring[1::2])))
    path = output/'atlas.bin'
    atlas = json.loads(gzip.decompress(path.read_bytes()))
    atlas['buildings'] = ([ring for ring in atlas['buildings'] if not overlaps(ring)] +
                          [ring for ring in reference['buildings'] if overlaps(ring)])
    compressed = gzip.compress(json.dumps(atlas,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
    if len(compressed)>400_000:
        raise ValueError('Merged campus atlas exceeds 400 KB')
    path.write_bytes(compressed)


class Downtown:
    def __init__(self):
        self.files = snapshot()
        self.manifest = json.loads(self.files['manifest.json'])
        if tuple(self.manifest['extent'])!=EXTENT:
            raise ValueError('Unexpected downtown extent')
        self.tiles = {(t['x'],t['z']):t['file'] for t in self.manifest['chunks']}

    @staticmethod
    def depth(x,z):
        west,north,width,height = EXTENT
        return min(x-west,west+width-x,z-north,north+height-z)

    def published_core(self, preserve_campuses=True):
        with tarfile.open(cached_archive(EXPANDED_DIGEST),'r:gz') as archive:
            manifest = json.load(archive.extractfile('world/manifest.json'))
            tiles = {(tile['x'],tile['z']):tile['file'] for tile in manifest['chunks']}
            inner = {origin for origin in tiles if self.depth(origin[0]+CHUNK/2,origin[1]+CHUNK/2) >= CHUNK*1.5}
            names = {origin:tiles[origin] for origin in (inner | CAMPUS_TILES if preserve_campuses else inner)}
        if len(inner)!=252:
            raise ValueError('Unexpected published downtown tile count')
        members = {'world/'+name for filename in names.values() for name in (filename, filename.replace('.glc','.trees'))}
        with tarfile.open(cached_archive(EXPANDED_DIGEST),'r|gz') as archive:
            files = {item.name:archive.extractfile(item).read() for item in archive if item.name in members}
        return {origin:(files['world/'+name],files['world/'+name.replace('.glc','.trees')]) for origin,name in names.items()}

    @staticmethod
    def fubo_tile(x,z):
        # Both the released outcrop and the new park footprint are in these two tiles.
        return x == -256 and z in (-1024,-768)

    def blend(self, terrain, water, original, ctrl, left, top, fubo=None):
        # Merge into a single grid first so a shared border is blended once.
        west,north,w,h = EXTENT
        shape = (h//GRID+1,w//GRID+1)
        fields = [np.empty(shape,dtype='<i2') for _ in range(3)]
        controls = np.full((h//8+3,w//8+3),np.nan)
        for (x,z),file in self.tiles.items():
            raw = gzip.decompress(self.files[file])
            nv,ni,collision,image,deck = struct.unpack_from('<5I',raw,4)
            tile_slice = np.s_[(z-north)//GRID:(z-north)//GRID+65,(x-west)//GRID:(x-west)//GRID+65]
            at = 24+16900+nv*9+ni*4
            tail = at+collision+image+deck*18
            for field,offset in zip(fields,(24,8474,tail if len(raw)==tail+8450 else 24)):
                field[tile_slice] = np.frombuffer(raw,'<i2',4225,offset).reshape(65,65)
            streets = json.loads(raw[at:at+collision])[1]
            if len(streets)>5 and streets[5]:
                base,deltas = streets[5]
                r,c = (z-north)//8,(x-west)//8
                controls[r:r+35,c:c+35] = (base+np.array(deltas).reshape(35,35))/1000

        def weight(xs,zs):
            # The south side abuts surveyed school foundations. The north,
            # west and east have room for a full tile of road-grade transition.
            horizontal = np.minimum(xs,w-xs)[None,:]/CHUNK
            vertical = np.minimum(zs/CHUNK,(h-zs)/64)[:,None]
            t = np.clip(np.minimum(horizontal,vertical),0,1)
            return t*t*(3-2*t)
        r,c = (north-top)//GRID,(west-left)//GRID
        window = np.s_[r:r+shape[0],c:c+shape[1]]
        alpha = weight(np.arange(shape[1])*GRID,np.arange(shape[0])*GRID)
        # Keep published road grades outside the old skirt and surveyed park,
        # including the approaches along Fengbei and northern Longzhu Road.
        xx = west+np.arange(shape[1])[None,:]*GRID
        zz = north+np.arange(shape[0])[:,None]*GRID
        edge = np.minimum(np.minimum(xx+190,-6-xx),np.minimum(zz+844,-586-zz))
        alpha *= 1-np.clip(edge/12,0,1)
        for dest,src in zip((terrain,water,original),fields):
            patch = dest[window]
            matched = (src!=-32768)&(patch!=-32768)
            patch[matched] = np.rint(patch[matched]*(1-alpha[matched])+src[matched]*alpha[matched])
            copy = ~matched & (alpha>=.5)
            patch[copy] = src[copy]
        if fubo is not None:
            fubo.retain_street_grade(terrain[window],original[window],water[window],fields[2],west,north)
        r,c = (north-top)//8,(west-left)//8
        patch = ctrl[r:r+controls.shape[0],c:c+controls.shape[1]]
        alpha = weight((np.arange(controls.shape[1])-1)*8,(np.arange(controls.shape[0])-1)*8)
        valid = np.isfinite(controls)
        patch[valid] += (controls[valid]-patch[valid])*alpha[valid]

    def landmarks(self, entries):
        previous = {entry['id']:entry for entry in self.manifest['landmarks']}
        for entry in entries:
            x,_,z = entry['position']
            if self.depth(x,z)>=CHUNK and entry['id'] in previous and entry['id']!='fubo':
                entry['position'] = list(previous[entry['id']]['position'])
                if entry['id']=='zhengyang':
                    # Published paving spans -0.142..+0.363 m about the
                    # rendered ground. Centre it within the 0.30 m tolerance.
                    entry['position'][1] -= .07

    def peaks(self, output, peaks):
        old = self.manifest['peaks']
        target = output/peaks['file']
        selected = []
        data = bytearray(b'PK02')
        for catalog,source,inside in [(old,self.files[old['file']],True),(peaks,target.read_bytes(),False)]:
            raw = gzip.decompress(source)
            offsets = {}
            for e in catalog['entries']:
                x,_,z = e['center']
                if (self.depth(x,z)>=CHUNK and e['name']!='伏波山')!=inside:
                    continue
                if not inside and e['name'].startswith('auto-'):
                    e['name'] = 'auto-ext-'+e['name'][5:]
                for section in e['lods']:
                    for key,n in [('indexOffset',2*section['indices']),('offset',11*section['vertices'])]:
                        pos = section[key]
                        if pos not in offsets:
                            offsets[pos]=len(data)
                            data.extend(raw[pos:pos+n])
                        section[key]=offsets[pos]
                selected.append(e)
        packed = gzip.compress(data,compresslevel=6,mtime=0)
        target.write_bytes(packed)
        peaks.update(entries=selected, bytes=len(packed))
        auto = []
        path = output/peaks['autoCatalog']
        for rows,inside in [(json.loads(self.files[old['autoCatalog']]),True),(json.loads(path.read_bytes()),False)]:
            for row in rows:
                if (self.depth(*ll2xz(row['lat'],row['lon']))>=CHUNK)==inside:
                    if not inside:
                        row['name']='auto-ext-'+row['name'][5:]
                    auto.append(row)
        path.write_text(json.dumps(auto,ensure_ascii=False,separators=(',',':'))+'\n')
