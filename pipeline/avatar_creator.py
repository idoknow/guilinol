"""Generate the two CC0 creator bodies from the shipped CC0 rig and bake their gait."""
import json
import struct
import numpy as np
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
    triangles = triangles[~remove[triangles].any(axis=1)]
    head = (p[:, 1] > 1.535) & (abs(p[:, 0]) < .13)
    p[head, 0] *= 1.10 if body == 'm' else 1.04
    p[head, 2] *= .95
    bump = head & (p[:, 2] > .08)
    p[bump, 2] = .08 + .66*(p[bump,2]-.08)
    if body == 'f':
        torso = (abs(p[:, 0]) < .24) & (p[:, 1] < 1.51)
        p[torso, 0] *= np.interp(p[torso, 1], [.72, .95, 1.06, 1.42], [1, 1.10, .89, .93])
    data = np.column_stack([p, color, g.J, g.W])
    # A closed crew-neck torso. Skin each ring to the neighbouring spine joints.
    rings = [( .938,.171,.124,-.021,'pelvis'),(1.004,.169,.120,-.021,'spine_01'),
             (1.118,.151,.111,-.021,'spine_02'),(1.29,.17,.122,-.018,'spine_03'),
             (1.41,.194,.117,-.031,'spine_03'),(1.448,.184,.103,-.033,'spine_03'),
             (1.478,.062,.059,-.035,'spine_03'),(1.485,.055,.052,-.035,'spine_03')]
    extra, faces = [], []
    sides=24
    for k,(height,width,depth,center,bone) in enumerate(rings):
        joint=g.joints.index(g.idx[bone])
        for n in range(sides):
            t=n*2*np.pi/sides
            scale=np.interp(height,[.958,1.118,1.448],[1.05,.89,.94]) if body=='f' else 1
            extra.append([width*scale*np.sin(t),height,center+depth*np.cos(t),
                          *color[np.where(hexes==0xf09a4a)[0][0]],joint,0,0,0,1,0,0,0])
            if k:
                a=len(data)+(k-1)*sides+n
                b=len(data)+(k-1)*sides+(n+1)%sides
                faces.extend([[a,b,a+sides],[b,b+sides,a+sides]])
    # Sleeves share shoulder movement between the clavicle and upper arm.
    # The cuffs end at the original wrist. The 66-bone bind transforms stay exact.
    sleeve_rings=[(.09,.024,.040),(.145,.042,.064),(.184,.052,.075),(.222,.055,.070),
                  (.30,.052,.060),(.438,.048,.051),(.49,.048,.050),(.61,.044,.047),
                  (.72,.038,.044),(.747,.038,.043)]
    for side,sign in [('l',1),('r',-1)]:
        first=len(data)+len(extra)
        for k,(x,ry,rz_) in enumerate(sleeve_rings):
            upper=g.joints.index(g.idx['upperarm_'+side])
            lower=g.joints.index(g.idx['lowerarm_'+side])
            clav=g.joints.index(g.idx['clavicle_'+side])
            j1,j2=(clav,upper) if x<.23 else (upper,lower)
            blend=np.interp(x,[.112,.222],[0,1]) if x<.23 else np.interp(x,[.438,.49],[0,1])
            for n in range(sides):
                angle=n*2*np.pi/sides
                extra.append([sign*x,np.interp(x,[.09,.145,.205],[1.405,1.426,1.44])+ry*np.cos(angle),-.059+rz_*np.sin(angle),
                              *color[np.where(hexes==0xf09a4a)[0][0]],j1,j2,0,0,1-blend,blend,0,0])
                if k:
                    a=first+(k-1)*sides+n;b=first+(k-1)*sides+(n+1)%sides
                    tris=[[a,b,a+sides],[b,b+sides,a+sides]]
                    faces.extend(tris if sign==1 else [tri[::-1] for tri in tris])
    data=np.vstack([data,extra]);triangles=np.vstack([triangles,faces])
    vertices, indices = np.unique(data[triangles.flatten()], axis=0, return_inverse=True)
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
        clip, report = bake(g,name,pose,cycle,keys,toes)
        print(body,name,report)
        assert report['ground_err_cm'] < 1
        channels, samplers = [], []
        for channel in clip['channels']:
            target = channel['target']
            if target['path'] != 'rotation' and not (target['path']=='translation' and g.names[target['node']]=='pelvis'):
                continue
            sampler = clip['samplers'][channel['sampler']]
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
    g.save(GLB.with_name(f'figure_{body}.glb'),clips+[wave])
    print(body,len(vertices),'vertices')


def hairstyles():
    """Each root is a rigid hair piece in attach_head coordinates. Share index and curl geometry."""
    nodes, meshes, accessors, views, roots = [], [], [], [], []
    data=bytearray()
    def attribute(values,dtype,kind):
        arr=np.asarray(values,dtype)
        data.extend(bytes(-len(data)%4))
        views.append(dict(buffer=0,byteOffset=len(data),byteLength=arr.nbytes))
        data.extend(arr.tobytes())
        a=dict(bufferView=len(views)-1,componentType=5126 if kind=='VEC3' else 5123,type=kind,count=len(arr))
        if kind=='VEC3':a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        accessors.append(a)
        return len(accessors)-1
    def grid(sides,rows):
        faces=[]
        for k in range(1,rows+1):
            for i in range(sides):
                a=k*sides+i;b=k*sides+(i+1)%sides
                faces.extend([a-sides,b-sides,a,b-sides,b,a])
        return attribute(faces,'<u2','SCALAR')
    def mesh(pos,idx):
        meshes.append(dict(primitives=[dict(attributes=dict(POSITION=attribute(pos,'<f4','VEC3')),indices=idx)]))
        return len(meshes)-1
    def node(**kwargs):
        nodes.append(kwargs)
        return len(nodes)-1
    sin,cos,pi=np.sin,np.cos,np.pi
    cap_index=grid(24,8)
    sphere=mesh([(sin(row*pi/7)*sin(i*pi/5),cos(row*pi/7),-sin(row*pi/7)*cos(i*pi/5))
                 for row in range(8) for i in range(10)],grid(10,7))
    for style in ['m_buzz','m_crop','m_perm','m_fade','m_mullet','m_part','f_long','f_pony','f_bun','f_lob','f_wolf','f_bangs']:
        length={'f_long':.33,'f_lob':.18,'f_wolf':.12,'m_mullet':.12,'f_bangs':.12}.get(style,0)
        volume=.024 if style=='m_perm' else 0 if style=='m_buzz' else .012
        pos=[]
        for row in range(9):
            t=row/8
            for i in range(24):
                a=i*pi/12
                front=(1+cos(a))/2
                fringe=.033 if style=='f_bangs' else .027*(.5+.5*sin(a*2+1)) if style=='m_crop' else 0
                part=.018*abs(sin(a*2)) if style=='m_part' else 0
                # Different crown profiles and hairlines, with continuous waves flowing from the part.
                hairline=2.25-.93*front**3+(fringe+part)*9
                if style=='m_fade':hairline-=.31*(1-front**4)
                if style=='m_mullet':hairline-=.35*abs(sin(a))**3
                if style=='f_bangs':hairline=2.34-.84*front**2
                if style=='m_crop':hairline+=.14*front*sin(a+.5)
                theta=t*hairline
                crown=np.exp(-((theta-.80)/.65)**2)
                sweep=cos(a*6+theta*3)
                ridge=.0008*cos(a*10+t*2)*sin(pi*t)
                lift=0
                if style in ['m_crop','m_fade','m_part']:
                    lift=crown*(.012+.017*(1+sin(a+.7))/2+.006*sweep)
                    if style=='m_part':lift=crown*(.030*abs(sin(a))-.008*cos(a*4))
                if style=='m_perm':
                    lift=.013*crown*(1+cos(a*7+theta*3)*cos(theta*6))
                    ridge+=.005*crown*sin(a*7+theta*4)
                if style=='f_wolf' or style=='m_mullet':
                    ridge+=.005*sin(7*a+2*t)*t
                drop=length*(1-front**1.8)**2*t**4
                if style=='f_wolf':drop*=.65+.5*abs(sin(3*a))
                radius=sin(theta)
                if length:radius=max(radius,.94*t**4*(1-front**5))
                width=.097+volume*.4+ridge
                pos.append([width*radius*sin(a),
                            .091+(.103+volume)*cos(theta)+lift-drop,
                            .025-(.119+ridge)*radius*cos(a)+.28*drop])
        root=node(name=style,mesh=mesh(pos,cap_index))
        roots.append(root)
        children=[]
        def oval(x,y,z,w,h,d,tilt=0):
            children.append(node(mesh=sphere,translation=[x,y,z],scale=[w,h,d],rotation=[0,0,sin(tilt/2),cos(tilt/2)]))
        if style=='f_pony':oval(0,.05,.146,.039,.14,.05,-.15)
        if style=='f_bun':oval(0,.06,.142,.058,.052,.055)
        if children:nodes[root]['children']=children
    data.extend(bytes(-len(data)%4))
    doc=dict(asset=dict(version='2.0',copyright='CC0-1.0'),scene=0,scenes=[dict(nodes=roots)],
             meshes=meshes,nodes=nodes,accessors=accessors,bufferViews=views,buffers=[dict(byteLength=len(data))])
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    glb=struct.pack('<IIIII',0x46546c67,2,28+len(js)+len(data),len(js),0x4e4f534a)+js
    GLB.with_name('creator-hair.glb').write_bytes(glb+struct.pack('<II',len(data),0x004e4942)+data)


if __name__ == '__main__':
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
