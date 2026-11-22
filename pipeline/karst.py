import gzip
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates, minimum_filter
from shapely.geometry import Polygon

from common import GRID, ll2xz
from auto_peaks import detect, suppress
import wind_cave


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
    shoulder,taper = peak['shoulder'],peak['taper']
    lean = radii.mean()*(.08+.045*np.cos(phases[1]))
    lean_x,lean_z = lean*np.cos(phases[0]),lean*np.sin(phases[0])
    stride = 4 if far else 1
    angles, radii = angles[::stride], radii[::stride]
    count = len(angles)
    ridge = .08*np.sin(21*angles+phases[0]+.9*np.sin(3*angles+phases[1]))
    if far:
        ridge = np.zeros_like(angles)
    relief = summit-floor
    skirt = min(4/relief,.09)
    rings = [(1,0),(.916,skirt)]
    for progress in (.20,.40,.60,.80,1):
        rings.append((.916+(.084-taper)*progress,skirt+(shoulder-skirt)*progress))
    for latitude in (.30,.61,.91,1.18,1.39):
        rings.append(((1-taper)*np.cos(latitude),shoulder+(1-shoulder)*np.sin(latitude)))
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
        if peak['name']=='伏波山':
            river=np.clip((np.cos(angles)-.08)/.68,0,1)
            fold=1.7*np.sin(9*angles+fraction)+.8*np.sin(23*angles-3*fraction)
            radius+=river*(5*np.sin(np.pi*fraction)+fold+4*fraction)
            mouth=np.exp(-(np.sin(angles/2)/.15)**4)*river
            if level==1:
                radius-=mouth*12
                height+=mouth*1.2
            elif level==2:
                height-=mouth*4.3
                radius+=mouth*2
        vertices.extend(zip(east+radius*np.cos(angles)+lean_x*fraction**2, height,
                            south+radius*np.sin(angles)+lean_z*fraction**2))
        if level:
            for col in range(count):
                outer = (level-1)*count + col
                adjacent = (level-1)*count + (col+1)%count
                faces.extend([(outer,outer+count,adjacent),(adjacent,outer+count,adjacent+count)])
    cap = len(vertices)
    faces.extend((cap-count+col,cap,cap-count+(col+1)%count) for col in range(count))
    vertices = np.asarray([*vertices,(east+lean_x,summit,south+lean_z)],dtype='<f4')
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
    cols_all = (triangles[:,:,0]-left)/GRID
    rows_all = (triangles[:,:,2]-top)/GRID
    r0 = np.maximum(np.ceil(rows_all.min(axis=1)).astype(int),0)
    c0 = np.maximum(np.ceil(cols_all.min(axis=1)).astype(int),0)
    r1 = np.minimum(np.floor(rows_all.max(axis=1)).astype(int),terrain.shape[0]-1)
    c1 = np.minimum(np.floor(cols_all.max(axis=1)).astype(int),terrain.shape[1]-1)
    dc_all = cols_all[:,1:]-cols_all[:,:1]
    dr_all = rows_all[:,1:]-rows_all[:,:1]
    det_all = dc_all[:,0]*dr_all[:,1]-dc_all[:,1]*dr_all[:,0]
    for i in np.flatnonzero((r1>=r0) & (c1>=c0) & (det_all!=0)):
        window = np.s_[r0[i]:r1[i]+1,c0[i]:c1[i]+1]
        row,col = np.ogrid[window]
        triangle, cols, rows = triangles[i], cols_all[i], rows_all[i]
        dc, dr, det = dc_all[i], dr_all[i], det_all[i]
        first_weight = ((col-cols[0])*dr[1]-(row-rows[0])*dc[1])/det
        second_weight = ((row-rows[0])*dc[0]-(col-cols[0])*dr[0])/det
        inside = (first_weight>=0)&(second_weight>=0)&(first_weight+second_weight<=1)
        heights = triangle[:,1]
        surface = heights[0]+first_weight*(heights[1]-heights[0])+second_weight*(heights[2]-heights[0])
        patch = terrain[window]
        patch[inside] = np.maximum(patch[inside],np.rint(10*surface[inside]))


def generate(original, terrain, left, top, bbox, output, wet, mountain_trees=None, area_per_tree=40):
    catalog = json.loads(Path(__file__).with_name('peaks.json').read_text())
    south,west,north,east = bbox
    entries, payload = [], bytearray(b'PK02')
    index_offsets = {}
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
    def plan(peak,sample):
        cx,cz = ll2xz(peak['lat'],peak['lon'])
        entry = dict(name=peak['name'],center=[cx,peak['target'],cz],lods=[])
        entries.append(entry)
        shape,floor = profile(sample,cx,cz,angles)
        floor = peak.get('baseHeight',floor)
        aspect = peak.get('aspect',.8)
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
            if 'baseHeight' not in peak:
                radii = np.minimum(radii,limit)
        entry['baseHeight'] = float(floor)
        reach = 1.8*radii.max()+GRID
        rows,cols = original.shape
        row0,col0 = max(0,int((cz-reach-top)//GRID)),max(0,int((cx-reach-left)//GRID))
        row1,col1 = min(rows,int((cz+reach-top)//GRID)+2),min(cols,int((cx+reach-left)//GRID)+2)
        window = np.s_[row0:row1,col0:col1]
        row,col = np.ogrid[window]
        dx,dz = left+col*GRID-cx,top+row*GRID-cz
        radial_extent = np.interp(np.arctan2(dz,dx),angles,radii,period=2*np.pi)
        fraction = np.hypot(dx,dz)/np.maximum(radial_extent,radii.mean())
        blend = np.clip((1.8-fraction)/.65,0,1)
        weight = np.where(wet[window],0,blend*blend*(3-2*blend))
        original[window] = np.minimum(original[window],np.rint(dem[window]*(1-weight)+floor*10*weight))
        if 'model' in peak:
            entry['model'] = peak['model']
            footprints.append(Polygon(np.column_stack((cx+radii*np.cos(angles), cz+radii*np.sin(angles)))))
            return
        shapes.append((entry,peak,cx,cz,radii,floor))
    for peak in catalog:
        if south <= peak['lat'] <= north and west <= peak['lon'] <= east:
            plan(peak,sample)
    auto,ground = detect(original,wet,left,top,centers.values())
    residual_sample = sampler(original.copy())
    centers.update({peak['name']:ll2xz(peak['lat'],peak['lon']) for peak in auto})
    for peak in auto:
        plan(peak,residual_sample)
    auto_file = 'auto-peaks.json'
    (output/auto_file).write_text(json.dumps(auto,ensure_ascii=False,separators=(',',':'))+'\n')
    suppress(original,wet,ground)
    terrain[:] = original
    ground_at = sampler(original)
    skirt_at = sampler(minimum_filter(original,size=17,mode='nearest'))
    trail_points=[]
    for entry,peak,cx,cz,radii,floor in shapes:
        phases = np.random.default_rng(peak.get('seed',peak.get('osm'))).uniform(0,2*np.pi,3)
        for far in [False,True]:
            data,faces = mesh(cx,cz,peak,ground_at,skirt_at,angles,radii,floor,phases,far)
            segments = len(angles)//(4 if far else 1)
            footprints.append(Polygon(data[:segments][:,[0,2]]))
            if not far:
                imprint(terrain,left,top,data[faces,:3])
                if entry['name']=='伏波山':
                    rows,cols=np.ogrid[:terrain.shape[0],:terrain.shape[1]]
                    shore=(left+cols*GRID>cx+12)&(left+cols*GRID<cx+65)&(abs(top+rows*GRID-cz)<22)
                    terrain[shore]=original[shore]
                if entry['name']=='明月峰':
                    faces=wind_cave.cut(data,faces,terrain,left,top,GRID)
                    path=wind_cave.trail(data[:-1,:3].reshape(12,128,3),data[-1,:3])
                    trail_points=[path(fraction) for fraction in np.linspace(0,1,600)]
                if mountain_trees is not None:
                    rng = np.random.default_rng(peak.get('seed',peak.get('osm')))
                    triangles = data[faces]
                    cross = np.cross(triangles[:,1,:3]-triangles[:,0,:3],triangles[:,2,:3]-triangles[:,0,:3])
                    areas = np.linalg.norm(cross,axis=1)/2
                    for tri,normal,size in zip(triangles,cross,areas):
                        if size==0 or tri[:,6].min()>=.5:
                            continue
                        normal = normal/(2*size)
                        for _ in range(rng.poisson(size/area_per_tree)):
                            weights = rng.dirichlet([1,1,1])
                            if weights@tri[:,6]<.5:
                                mountain_trees.append((weights@tri[:,:3]-.3*normal,normal))
            template = 'wind_cave' if not far and entry['name']=='明月峰' else far
            if template not in index_offsets:
                index_offsets[template] = len(payload)
                payload.extend(faces.tobytes())
            entry['lods'].append(dict(offset=len(payload),vertices=len(data),indices=faces.size,indexOffset=index_offsets[template]))
            cm = np.rint((data[:,:3]-entry['center'])*100)
            if cm.min() < -32768 or cm.max() > 32767:
                raise ValueError(f"PK02 position out of range: {entry['name']}")
            payload.extend(cm.astype('<i2').tobytes())
            payload.extend(np.rint(data[:,3:6]*127).astype('i1').tobytes())
            payload.extend(np.rint(data[:,6:]*255).astype('u1').tobytes())
    compressed = gzip.compress(payload,compresslevel=6,mtime=0)
    terrain[wet] = dem[wet]
    for px,py,pz in trail_points:
        col,row=round((px-left)/GRID),round((pz-top)/GRID)
        window=np.s_[row-2:row+3,col-2:col+3]
        terrain[window]=np.minimum(terrain[window],round((py-.65)*10))
    (output/'peaks.bin').write_bytes(compressed)
    return dict(file='peaks.bin',bytes=len(compressed),autoCatalog=auto_file,entries=entries), footprints
