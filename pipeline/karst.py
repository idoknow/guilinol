import gzip
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates, minimum_filter
from shapely.geometry import Polygon

from common import GRID, ll2xz


def profile(sample, east, south, angles):
    distance = np.arange(0, 321, GRID)
    rays = sample(east + np.cos(angles[:, None])*distance,
                  south + np.sin(angles[:, None])*distance)
    floor = np.percentile(rays[:, 40:], 18)
    raised = rays > floor + 7
    outside = np.argmax(np.pad(~raised, ((0, 0), (0, 1)), constant_values=True), axis=1)
    radii = gaussian_filter1d(np.where(outside < 5, 48, outside*GRID), 6, mode='wrap')
    return np.clip(radii/radii.mean(),.55,1.65),floor


def mesh(east, south, peak, ground_at, skirt_at, angles, radii, floor, phases, far):
    summit = peak['target']
    stride = 4 if far else 1
    angles, radii = angles[::stride], radii[::stride]
    count = len(angles)
    ridge = .08*np.sin(21*angles+phases[0]+.9*np.sin(3*angles+phases[1]))
    if far:
        ridge = np.zeros_like(angles)
    relief = summit-floor
    skirt = min(4/relief,.09)
    rings = [(1,0),(.92,skirt),(.918,.19),(.923,.33),(.912,.48),(.903,.62),(.89,.74)]
    for latitude in (.30,.61,.91,1.18,1.42):
        rings.append((.89*np.cos(latitude),.74+.26*np.sin(latitude)))
    if far:
        rings = [rings[index] for index in [0,1,4,6,8,10]]
    vertices, faces = [], []
    for level,(scale, fraction) in enumerate(rings):
        radius = radii*scale*(1+(ridge if level else 0))
        height = np.full_like(angles,floor+relief*fraction)
        height += .025*relief*np.sin(2*angles+phases[2])*np.sin(np.pi*fraction)**2
        if not level:
            ground = skirt_at(east+radius*np.cos(angles),south+radius*np.sin(angles))
            height = np.minimum(ground,floor)-4
        elif level==1:
            height = np.minimum(height,ground_at(east+radius*np.cos(angles),south+radius*np.sin(angles))+4)
        vertices.extend(zip(east+radius*np.cos(angles), height, south+radius*np.sin(angles)))
        if level:
            for col in range(count):
                outer = (level-1)*count + col
                adjacent = (level-1)*count + (col+1)%count
                faces.extend([(outer,outer+count,adjacent),(adjacent,outer+count,adjacent+count)])
    cap = len(vertices)
    faces.extend((cap-count+col,cap,cap-count+(col+1)%count) for col in range(count))
    vertices = np.asarray([*vertices,(east,summit,south)],dtype='<f4')
    vertices[:,[0,2]] = np.rint(vertices[:,[0,2]]*256)/256
    faces = np.asarray(faces,dtype='<u2')
    tris = vertices[faces]
    normals = np.zeros_like(vertices)
    cross = np.cross(tris[:,1]-tris[:,0],tris[:,2]-tris[:,0])
    for corner in faces.T:
        np.add.at(normals,corner,cross)
    normals /= np.linalg.norm(normals,axis=1)[:,None]
    rock = np.clip(1.35*(1-normals[:,1])+.12*np.sin(vertices[:,0]*.17+phases[1]),0,1)
    normalized = (vertices[:,1]-vertices[:,1].min())/(summit-vertices[:,1].min())
    data = np.column_stack((vertices,normals,np.rint(rock*4096)/4096,np.rint(normalized*4096)/4096)).astype('<f4')
    return data,faces


def imprint(terrain, left, top, triangles):
    for triangle in triangles:
        cols = (triangle[:,0]-left)/GRID
        rows = (triangle[:,2]-top)/GRID
        first = np.maximum(np.ceil([min(rows),min(cols)]).astype(int),0)
        last = np.minimum(np.floor([max(rows),max(cols)]).astype(int),np.array(terrain.shape)-1)
        if np.any(last < first):
            continue
        window = np.s_[first[0]:last[0]+1,first[1]:last[1]+1]
        row,col = np.ogrid[window]
        dc,dr = cols[1:]-cols[0],rows[1:]-rows[0]
        det = dc[0]*dr[1]-dc[1]*dr[0]
        first_weight = ((col-cols[0])*dr[1]-(row-rows[0])*dc[1])/det
        second_weight = ((row-rows[0])*dc[0]-(col-cols[0])*dr[0])/det
        inside = (first_weight>=0)&(second_weight>=0)&(first_weight+second_weight<=1)
        heights = triangle[:,1]
        surface = heights[0]+first_weight*(heights[1]-heights[0])+second_weight*(heights[2]-heights[0])
        patch = terrain[window]
        patch[inside] = np.maximum(patch[inside],np.rint(10*surface[inside]))


def generate(original, terrain, left, top, bbox, output):
    catalog = json.loads(Path(__file__).with_name('peaks.json').read_text())
    south,west,north,east = bbox
    entries, payload = [], bytearray(b'PK01')
    angles = np.arange(128)*2*np.pi/128
    shapes, footprints = [], []
    dem = original.copy()
    centers = {peak['name']:ll2xz(peak['lat'],peak['lon']) for peak in catalog}
    saddles = [('仙鹤峰','四望山'),('四望山','于越山'),('于越山','明月峰'),
               ('普陀山','辅星山'),('辅星山','月牙山')]
    def sampler(field):
        def sample(xs,zs):
            return map_coordinates(field, [(zs-top)/GRID,(xs-left)/GRID], order=1,mode='nearest')/10
        return sample
    sample = sampler(dem)
    for peak in catalog:
        if not (south <= peak['lat'] <= north and west <= peak['lon'] <= east):
            continue
        cx,cz = ll2xz(peak['lat'],peak['lon'])
        entry = dict(name=peak['name'],center=[cx,peak['target'],cz],lods=[])
        entries.append(entry)
        if 'model' in peak:
            entry['model'] = peak['model']
            continue
        shape,floor = profile(sample,cx,cz,angles)
        aspect = peak.get('aspect',1.2)
        relief = peak['target']-floor
        radius_budget = aspect*relief
        radii = shape/shape.mean()*radius_budget*.98
        for neighbor,(nx,nz) in centers.items():
            if neighbor != peak['name']:
                direction = np.arctan2(nz-cz,nx-cx)
                limit = .82*np.hypot(nx-cx,nz-cz)/np.maximum(.01,np.cos(angles-direction))
                radii = np.minimum(radii,limit)
        for pair in saddles:
            if peak['name'] not in pair:
                continue
            neighbor = pair[1-pair.index(peak['name'])]
            dx,dz = centers[neighbor][0]-cx,centers[neighbor][1]-cz
            along = np.maximum(0,np.cos(angles-np.arctan2(dz,dx)))**8
            radii = np.maximum(radii,.65*np.hypot(dx,dz)*along)
        radii *= min(1,radius_budget/radii.mean())
        for delta,minimum,maximum in [(np.cos(angles),left-cx,left+(original.shape[1]-1)*GRID-cx),
                                      (np.sin(angles),top-cz,top+(original.shape[0]-1)*GRID-cz)]:
            limit = np.where(delta>0,maximum,-minimum)/np.maximum(np.abs(delta),1e-9)
            radii = np.minimum(radii,limit)
        entry['baseHeight'] = float(floor)
        reach = radii.max()+GRID
        rows,cols = original.shape
        row0,col0 = max(0,int((cz-reach-top)//GRID)),max(0,int((cx-reach-left)//GRID))
        row1,col1 = min(rows,int((cz+reach-top)//GRID)+2),min(cols,int((cx+reach-left)//GRID)+2)
        window = np.s_[row0:row1,col0:col1]
        row,col = np.ogrid[window]
        dx,dz = left+col*GRID-cx,top+row*GRID-cz
        fraction = np.hypot(dx,dz)/np.interp(np.arctan2(dz,dx),angles,radii,period=2*np.pi)
        weight = np.clip((1-fraction)*4,0,1)
        original[window] = np.minimum(original[window],np.rint(dem[window]*(1-weight)+floor*10*weight))
        shapes.append((entry,peak,cx,cz,radii,floor))
    terrain[:] = original
    ground_at = sampler(original)
    skirt_at = sampler(minimum_filter(original,size=17,mode='nearest'))
    for entry,peak,cx,cz,radii,floor in shapes:
        phases = np.random.default_rng(peak.get('seed',peak['osm'])).uniform(0,2*np.pi,3)
        for far in [False,True]:
            data,faces = mesh(cx,cz,peak,ground_at,skirt_at,angles,radii,floor,phases,far)
            segments = len(angles)//(4 if far else 1)
            footprints.append(Polygon(data[:segments][:,[0,2]]))
            if not far:
                imprint(terrain,left,top,data[faces,:3])
            entry['lods'].append(dict(offset=len(payload),vertices=len(data),indices=faces.size))
            payload.extend(data.tobytes()+faces.tobytes())
    compressed = gzip.compress(payload,compresslevel=6,mtime=0)
    (output/'peaks.bin').write_bytes(compressed)
    return dict(file='peaks.bin',bytes=len(compressed),entries=entries), footprints
