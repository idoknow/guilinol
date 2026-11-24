"""Generate the two CC0 creator bodies from the shipped CC0 rig and bake their gait."""
import json
import struct
import numpy as np
from creator_head import face, hair, surface, HEAD
from avatar_walk import Glb, GLB, bake, walk_pose, idle_pose, WALK_KEYS, WALK_CYCLE, IDLE_KEYS, IDLE_CYCLE, rz, qmul


def generate(body):
    g = Glb(GLB)
    g.new_acc, g.new_raw = {}, {}
    g.j['asset']['generator']='guilinol pipeline/avatar_creator.py'
    mesh = g.j['meshes'][0]['primitives'][0]
    color = g.acc(mesh['attributes']['COLOR_0'])[:, :3]
    rgb = np.round(255*np.where(color <= .0031308, color*12.92, 1.055*color**(1/2.4)-.055)).astype(int)
    hexes = rgb @ [65536, 256, 1]
    triangles = g.acc(mesh['indices']).reshape(-1, 3)
    p = g.P[:, :3].copy()
    # Remove hair and backpack components. Keep dark laces and the belt.
    remove = (hexes == 0x1f1b19) | (hexes == 0x66737b) | ((hexes == 0x343b40) & (p[:, 1] > 1.0))
    dominant = np.array([g.names[g.joints[j]] for j in g.J[np.arange(len(p)), np.argmax(g.W,axis=1)]])
    shirt_colors = np.isin(hexes,[0xf09a4a,0xc06a2c,0xf2efe8])
    remove |= shirt_colors & (p[:,1] > .94) & ((abs(p[:,0])>.17) | np.isin(dominant,['pelvis','spine_01','spine_02','spine_03','neck_01','clavicle_l','clavicle_r','upperarm_l','upperarm_r']))
    remove |= (dominant == 'head') | ((p[:,1] > 1.531) & (abs(p[:,0])<.13))
    remove |= (hexes==0xdcb48e) & (abs(p[:,0])<.080) & (p[:,1]>1.42)
    triangles = triangles[~remove[triangles].any(axis=1)]
    if body == 'f':
        torso = (abs(p[:, 0]) < .24) & (p[:, 1] < 1.51)
        p[torso, 0] *= np.interp(p[torso, 1], [.72, .95, 1.06, 1.42], [1, 1.10, .89, .93])
    # Tuck the original separate pelvis volume behind the waistband and trouser fronts.
    hip=(dominant=='pelvis') & (p[:,1]<1.015)
    p[hip,2]=-.018+(p[hip,2]+.018)*.82
    p[hip,1]+=.025*np.clip((1.002-p[hip,1])/.150,0,1)
    data = np.column_stack([p, color, g.J, g.W])
    # A closed crew-neck torso. Skin each ring to the neighbouring spine joints.
    rings = [( .927,.182,.137,-.021,'pelvis'),(1.004,.169,.120,-.021,'spine_01'),
             (1.118,.151,.111,-.021,'spine_02'),(1.29,.17,.122,-.018,'spine_03'),
             (1.41,.194,.117,-.031,'spine_03'),(1.448,.184,.103,-.033,'spine_03'),
             (1.478,.062,.059,-.035,'spine_03'),(1.485,.055,.052,-.035,'spine_03')]
    extra, faces = [], []
    sides=16
    for k,(height,width,depth,center,bone) in enumerate(rings):
        joint=g.joints.index(g.idx[bone])
        for n in range(sides):
            t=n*2*np.pi/sides
            scale=np.interp(height,[.958,1.118,1.448],[1.08,.84,.92]) if body=='f' else 1
            extra.append([width*scale*np.sin(t),height,center+depth*np.cos(t),
                          *color[np.where(hexes==0xf09a4a)[0][0]],joint,0,0,0,1,0,0,0])
            if k:
                a=len(data)+(k-1)*sides+n
                b=len(data)+(k-1)*sides+(n+1)%sides
                faces.extend([[a,b,a+sides],[b,b+sides,a+sides]])
    # Sleeves share shoulder movement smoothly with near-round deltoid rings (no square shoulder pad
    # bump when raising the arm) and dense smoothstep rings across the elbow (x ≈ 0.470).
    sleeve_rings=[(.090,.024,.036),(.135,.037,.048),(.165,.046,.054),(.195,.050,.056),
                  (.230,.051,.055),(.300,.049,.053),(.385,.048,.051),(.425,.048,.050),
                  (.450,.048,.050),(.470,.048,.050),(.490,.047,.049),(.515,.046,.048),
                  (.570,.044,.046),(.650,.040,.044),(.720,.036,.041),(.747,.035,.040)]
    for side,sign in [('l',1),('r',-1)]:
        first=len(data)+len(extra)
        for k,(x,ry,rz_) in enumerate(sleeve_rings):
            upper=g.joints.index(g.idx['upperarm_'+side])
            lower=g.joints.index(g.idx['lowerarm_'+side])
            clav=g.joints.index(g.idx['clavicle_'+side])
            j1,j2=(clav,upper) if x<.235 else (upper,lower)
            if x<.235:
                t=np.clip((x-.115)/(.230-.115),0,1)
            else:
                t=np.clip((x-.415)/(.525-.415),0,1)
            blend=float(t*t*(3.0-2.0*t))
            for n in range(sides):
                angle=n*2*np.pi/sides
                extra.append([sign*x,np.interp(x,[.09,.145,.205],[1.405,1.426,1.44])+1.16*ry*np.cos(angle),-.059+1.13*rz_*np.sin(angle),
                              *color[np.where(hexes==0xf09a4a)[0][0]],j1,j2,0,0,1-blend,blend,0,0])
                if k:
                    a=first+(k-1)*sides+n;b=first+(k-1)*sides+(n+1)%sides
                    tris=[[a,b,a+sides],[b,b+sides,a+sides]]
                    faces.extend(tris if sign==1 else [tri[::-1] for tri in tris])
    face_points,face_tris=face(body)
    head_joint=g.joints.index(g.idx['head'])
    skin_rgb=color[np.where(hexes==0xdcb48e)[0][0]]
    def add_head(points,tris):
        faces.extend(tris+len(data)+len(extra))
        extra.extend([[*point,*skin_rgb,head_joint,0,0,0,1,0,0,0] for point in points])
    add_head(face_points,face_tris)
    # Connect the jaw to the collar across the animated neck joint.
    neck_joint=g.joints.index(g.idx['neck_01'])
    angles=np.arange(20)*np.pi/10
    nr=.040 if body=='f' else .046
    neck_rings=[np.column_stack([nr*r*np.sin(angles),np.full(20,y),z+.86*nr*r*np.cos(angles)])
                for y,r,z in [(1.447,1.15,-.033),(1.482,1.02,-.029),(1.518,.92,-.014),(1.552,.88,-.008)]]
    points,tris=surface(neck_rings,[0,1.445,-.033],[0,1.554,-.008])
    faces.extend(tris+len(data)+len(extra))
    for point in points:
        w=np.clip((point[1]-1.50)/.055,0,1)
        extra.append([*point,*skin_rgb,neck_joint,head_joint,0,0,1-w,w,0,0])
    for side in [-1,1]:
        ear_center=HEAD+[side*.085,.050,-.015]
        angles=np.arange(12)*np.pi/6
        rings=[np.column_stack([.014*np.sin(t)*np.sin(angles),np.full(12,-.024*np.cos(t)),
                                .015*np.sin(t)*np.cos(angles)])+ear_center for t in np.linspace(.3,np.pi-.3,3)]
        add_head(*surface(rings,ear_center-[0,.024,0],ear_center+[0,.024,0]))
    # Scale the entire articulated assembly, including attachment anchors, around the soles.
    data=np.vstack([data,extra]);triangles=np.vstack([triangles,faces])
    vertices, first, indices = np.unique(data[triangles.flatten()], axis=0, return_index=True, return_inverse=True)
    order=np.argsort(first)
    vertices=vertices[order]
    indices=np.argsort(order)[indices]
    g.P = np.column_stack([vertices[:, :3], np.ones(len(vertices))])
    g.J, g.W = vertices[:, 6:10].astype(int), vertices[:, 10:14]
    def attr(values, typ, component, normalized=False):
        i = 100000 + len(g.new_acc)
        dtype = {5121:'u1',5123:'<u2',5126:'<f4'}[component]
        g.new_raw[i] = np.asarray(values, dtype).tobytes()
        g.new_acc[i] = dict(componentType=component, count=len(values), type=typ)
        if normalized:
            g.new_acc[i]['normalized'] = True
        return i
    pos = attr(vertices[:, :3], 'VEC3', 5126)
    g.new_acc[pos].update(min=vertices[:, :3].min(0).tolist(), max=vertices[:, :3].max(0).tolist())
    mesh['attributes'] = dict(POSITION=pos, COLOR_0=attr(np.round(np.c_[vertices[:, 3:6],np.ones(len(vertices))]*65535),'VEC4',5123,True),
                              JOINTS_0=attr(g.J,'VEC4',5121), WEIGHTS_0=attr(np.round(g.W*255),'VEC4',5121,True))
    mesh['indices'] = attr(indices.flatten(), 'SCALAR',5123)
    old = next(a for a in g.j['animations'] if a['name']=='walk')
    g.j['animations'].append(dict(old, name='walk_src'))
    clips = []
    for name, pose, cycle, keys, toes in [('walk',walk_pose,WALK_CYCLE,WALK_KEYS,True),('idle',idle_pose,IDLE_CYCLE,IDLE_KEYS,False)]:
        clip, report = bake(g,name,pose,cycle,keys,toes,finger_curl=.48 if name=="idle" else 1.)
        print(body,name,report)
        assert report['ground_err_cm'] < 1
        channels, samplers = [], []
        for channel in clip['channels']:
            target = channel['target']
            if target['path'] != 'rotation' and not (target['path']=='translation' and g.names[target['node']]=='pelvis'):
                continue
            sampler = clip['samplers'][channel['sampler']]
            if target['path']=='rotation':
                quats=np.frombuffer(g.new_raw[sampler['output']],dtype='<i2').reshape(-1,4)/32767
                if np.max(abs(quats-quats[0]))<.0001:
                    if abs(np.dot(quats[0],g.R[target['node']]))>1-1e-8:
                        continue
                    sampler=dict(input=g.add_float(np.array([0.,cycle])[:,None],'SCALAR'),
                                 output=g.add_float(quats[[0,-1]],'VEC4',True))
            channels.append(dict(target=target,sampler=len(samplers)))
            samplers.append(sampler)
        clips.append(dict(name=name,channels=channels,samplers=samplers))
    # Lift the right arm and rock the wrist twice above the shoulder.
    wave = dict(name='wave',channels=[],samplers=[])
    times = g.add_float(np.array([0,.25,.48,.67,.86,1.2])[:,None], 'SCALAR')
    for name, angles in [('upperarm_r',[80,-48,-48,-48,-48,80]),('lowerarm_r',[0,-55,-40,-63,-40,0])]:
        node=g.idx[name]
        world=g.worldq(g.R)
        parent=world[g.parent[node]]
        from avatar_walk import qinv
        values=[qmul(qinv(parent),qmul(rz(np.deg2rad(a)),world[node])) for a in angles]
        wave['channels'].append(dict(target=dict(node=node,path='rotation'),sampler=len(wave['samplers'])))
        wave['samplers'].append(dict(input=times,output=g.add_float(values,'VEC4',True)))
    roots=g.j['scenes'][0]['nodes']
    head_scale=1.14
    head_node=g.j['nodes'][g.idx['head']]
    head_node['scale']=(np.array(head_node.get('scale',[1.,1.,1.]))*head_scale).tolist()
    scale=(1.62 if body=='f' else 1.72)/(HEAD[1]+.191*head_scale)
    g.j['nodes'].append(dict(name='CreatorProportions',children=roots,scale=[scale*(.94 if body=='f' else 1),scale,scale]))
    g.j['scenes'][0]['nodes']=[len(g.j['nodes'])-1]
    g.save(GLB.with_name(f'figure_{body}.glb'),clips+[wave])
    print(body,len(vertices),'vertices')


def hairstyles():
    """Each root is a rigid hair piece in attach_head coordinates. Share index and curl geometry."""
    nodes, meshes, accessors, views, roots = [], [], [], [], []
    data=bytearray()
    identical={}
    def attribute(values,dtype,kind):
        arr=np.asarray(values,dtype)
        key=(kind,arr.tobytes())
        if key in identical:return identical[key]
        identical[key]=len(accessors)
        data.extend(bytes(-len(data)%4))
        views.append(dict(buffer=0,byteOffset=len(data),byteLength=arr.nbytes))
        data.extend(arr.tobytes())
        a=dict(bufferView=len(views)-1,componentType=5126 if kind=='VEC3' else 5123,type=kind,count=len(arr))
        if kind=='VEC3':a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        accessors.append(a)
        return len(accessors)-1
    for style in ['m_buzz','m_crop','m_perm','m_fade','m_mullet','m_part','f_long','f_pony','f_bun','f_lob','f_wolf','f_bangs']:
        pos,tri,tones=hair(style)
        print(style,len(pos),'vertices')
        assert len(pos)<=600
        attr=dict(POSITION=attribute(pos,'<f4','VEC3'))
        # Two material controls (strand lightness and shaven-side fade), padded to a four-byte stride.
        color=np.round(255*np.column_stack([tones,np.zeros(len(pos)),np.ones(len(pos))])).astype('u1')
        attr['COLOR_0']=attribute(color,'u1','VEC4')
        accessors[attr['COLOR_0']].update(componentType=5121,normalized=True)
        meshes.append(dict(primitives=[dict(attributes=attr,indices=attribute(tri.flatten(),'<u2','SCALAR'))]))
        nodes.append(dict(name=style,mesh=len(meshes)-1))
        roots.append(len(nodes)-1)
    data.extend(bytes(-len(data)%4))
    doc=dict(asset=dict(version='2.0',copyright='CC0-1.0'),scene=0,scenes=[dict(nodes=roots)],
             meshes=meshes,nodes=nodes,accessors=accessors,bufferViews=views,buffers=[dict(byteLength=len(data))])
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    glb=struct.pack('<IIIII',0x46546c67,2,28+len(js)+len(data),len(js),0x4e4f534a)+js
    GLB.with_name('creator-hair.glb').write_bytes(glb+struct.pack('<II',len(data),0x004e4942)+data)


if __name__ == '__main__':
    from avatar_hands import rebuild
    rebuild()
    hairstyles()
    for body in 'mf':
        generate(body)

    # Share identical geometry and animation data across the two glTFs.
    # Only the positions differ between these bind-compatible bodies.
    shared = bytearray()
    slices = {}
    bodies = []
    for body in 'mf':
        path = GLB.with_name(f'figure_{body}.glb')
        data = path.read_bytes()
        size = struct.unpack_from('<I',data,12)[0]
        doc = json.loads(data[20:20+size])
        binary = data[28+size:]
        for view in doc['bufferViews']:
            offset, length = view['byteOffset'], view['byteLength']
            raw = binary[offset:offset+length]
            if raw not in slices:
                shared.extend(bytes(-len(shared)%4))
                slices[raw] = len(shared)
                shared.extend(raw)
            view['byteOffset'] = slices[raw]
        bodies.append((path,doc))
    for path,doc in bodies:
        doc['buffers'] = [dict(uri='creator-rig.bin',byteLength=len(shared))]
        js=json.dumps(doc,separators=(',',':')).encode()
        js+=b' '*(-len(js)%4)
        path.write_bytes(struct.pack('<IIIII',0x46546c67,2,20+len(js),len(js),0x4e4f534a)+js)
    GLB.with_name('creator-rig.bin').write_bytes(shared)
