"""Closed head and hair surfaces in attach_head space (metres, looking towards -Z)."""
import numpy as np

TAU = 2 * np.pi
CRANIUM = np.array([.089, .105, .111])
CENTER = np.array([0., .086, .019])
HEAD = np.array([0., 1.56849, .0114245])


def surface(rings, bottom, top):
    """Cap both ends with single shared poles. All internal edges have two incident faces."""
    rows, sides, _ = np.shape(rings)
    points = np.vstack([bottom, np.reshape(rings, (-1, 3)), top])
    faces = []
    for i in range(sides):
        j = (i+1) % sides
        faces.append([0, 1+j, 1+i])
        for k in range(rows-1):
            a, b = 1+k*sides+i, 1+k*sides+j
            faces.extend([[a,b,b+sides],[a,b+sides,a+sides]])
        faces.append([1+(rows-1)*sides+i,1+(rows-1)*sides+j,len(points)-1])
    faces = np.array(faces)
    # Enforce outward winding for different local section frames.
    a,b,c = points[faces].transpose(1,0,2)
    if np.sum(a*np.cross(b,c)) < 0:
        faces = faces[:,::-1]
    return points,faces


def face(body):
    angles = np.arange(48)*TAU/48
    s,c = np.sin(angles),np.cos(angles)
    rings = []
    female = body=='f'
    # Cross-sections follow the mandibular angle into the neck. The chin is anterior
    # to the cranial centre; the occiput rounds back above the nape.
    levels=[-.046,-.039,-.024,-.004,.023,.051,.070,.086]
    jaw_width=[.008,.029,.048,.065,.077,.085,.088,.089] if female else [.014,.037,.058,.074,.082,.086,.088,.089]
    front_profile=[-.045,-.062,-.075,-.081,-.084,-.087,-.089,-.092]
    rear_profile=[-.042,-.023,.016,.044,.075,.111,.126,.130]
    for y in np.r_[np.linspace(-.045,.086,20,endpoint=False),.086+.105*np.sin(np.linspace(0,1.54,15))]:
        if y>=.086:
            radius=np.sqrt(max(0,1-((y-.086)/.105)**2))
            width=.089*radius;center=.019;depth=.111*radius
        else:
            width=np.interp(y,levels,jaw_width)
            near=np.interp(y,levels,front_profile);far=np.interp(y,levels,rear_profile)
            center=(near+far)/2;depth=(far-near)/2
        x=width*s
        z=center-depth*c
        # Broad cheekbones, shallow sockets, a continuous low bridge, tip and alae.
        front = np.maximum(0,c)**2
        bridge = .012*np.exp(-(x/.016)**2-((y-.049)/.039)**2)
        tip = .011*np.exp(-(x/.016)**2-((y-.033)/.015)**2)
        wings = .006*np.exp(-((abs(x)-.012)/.006)**2-((y-.031)/.006)**2)
        cheek = .006*np.exp(-((abs(x)-.048)/.026)**2-((y-.041)/.025)**2)
        socket = .005*np.exp(-((abs(x)-.034)/.021)**2-((y-.068)/.012)**2)
        mouth = .009*np.exp(-(x/.032)**2-((y-.007)/.017)**2)
        z -= front*(bridge+tip+wings+cheek+mouth-socket)
        rings.append(np.column_stack([x,np.full_like(x,y),z]))
    p,f=surface(rings,[0,-.046,-.044],[0,.191,.017])
    return HEAD+p*[-1,1,-1],f


def lock(path,width,depth,across,sides=9):
    """Closed swept lock with rounded cross sections perpendicular to its centreline."""
    path=np.array(path)
    rings=[]
    for i,center in enumerate(path):
        axis=path[min(i+1,len(path)-1)]-path[max(i-1,0)]
        axis/=np.linalg.norm(axis)
        lateral=across-axis*np.dot(axis,across)
        lateral/=np.linalg.norm(lateral)
        normal=np.cross(axis,lateral)
        a=np.arange(sides)*TAU/sides
        rings.append(center+width[i]*np.cos(a)[:,None]*lateral+depth[i]*np.sin(a)[:,None]*normal)
    unit=lambda v:v/np.linalg.norm(v)
    return surface(rings,path[0]-.006*unit(path[1]-path[0]),path[-1]+.006*unit(path[-1]-path[-2]))


def curtain(style):
    """A curved, solid mantle. Both surfaces turn around the temple and the hem."""
    n=27; u=np.linspace(-1,1,n)
    span={'m_mullet':1.18,'f_wolf':2.02,'f_bangs':2.09,'f_lob':2.00,'f_long':2.06}[style]
    a=u*span;sn,cs=np.sin(a),np.cos(a)
    lo={'f_long':-.276,'f_lob':-.134,'f_wolf':-.098,'f_bangs':-.076,'m_mullet':-.076}[style]
    ends=lo+.018*u**2+.006*np.cos(5*a+.3)
    if style=='m_mullet':ends+=.060*abs(u)**1.6
    if style=='f_wolf':ends+=.018*np.cos(9*a)+.052*abs(u)**3
    ys=[.175,.156,.128,.090,.048,.016]
    outer=[];inner=[]
    for k,y in enumerate([*ys,.005,lo+.023,lo]):
        t=k/8
        yy=np.full(n,y) if k<6 else ((ends+.016)/2 if k==6 else ends+(.016 if k==7 else 0))
        flare=.024 if style!='m_mullet' else -.025
        rx=[.039,.065,.082,.097,.110,.108,.104+flare*.40,.10+flare,.101+flare][k]
        rz=[.059,.087,.105,.116,.122,.122,.124,.128,.126][k]
        center=.019+max(0,-lo)*.20*t**2
        ridges=(.002+.002*t)*np.sin(14*a+t*1.4)*t
        direction=np.column_stack([sn,np.zeros(n),cs])
        ring=np.column_stack([(rx+ridges)*sn,yy,center+(rz+ridges)*cs])
        outer.append(ring)
        inner.append(ring-direction*(.024+.007*t))
    # Continuous perimeter on each horizontal section, rounded front edges.
    loops=[]
    for outside,inside in zip(outer,inner):
        end=(outside[-1]+inside[-1])/2+.008*np.array([cs[-1],0,-sn[-1]])
        start=(outside[0]+inside[0])/2-.008*np.array([cs[0],0,-sn[0]])
        loops.append(np.vstack([outside,end,inside[::-1],start]))
    m=2*n+2
    pts=np.vstack(loops);tri=[]
    for k in range(8):
        for i in range(m):
            a=k*m+i;b=k*m+(i+1)%m
            tri.extend([[a,b,b+m],[a,b+m,a+m]])
    # Close the crescent locally across its thickness rather than spanning the open face.
    for k in [0,8]:
        base=k*m
        cap=[[i,i+1,m-2-i] for i in range(n-1)]+[[i+1,m-3-i,m-2-i] for i in range(n-1)]
        cap.extend([[0,m-2,m-1],[n-1,n,n+1]])
        for f in cap:tri.append([base+i for i in (f[::-1] if k==0 else f)])
    tri=np.array(tri)
    aa,bb,cc=pts[tri].transpose(1,0,2)
    if np.sum(aa*np.cross(bb,cc))<0:tri=tri[:,::-1]
    colors=np.tile(np.r_[.52+.29*np.sin(14*u*span),.42,np.full(n,.32),.42],9)
    return pts,tri,np.stack([colors,np.zeros(len(pts))],1)


def hair(style):
    sides=30
    angles=np.arange(sides)*TAU/sides
    s,c=np.sin(angles),np.cos(angles)
    front=np.maximum(c,0)
    back=np.maximum(-c,0)
    # Keep the temples open around the ears; a rounded nape drops behind them.
    edge=1.88-.62*front**2+.62*back**2+.18*np.exp(-((abs(c)-.37)/.15)**2)*front
    short=style in ['m_buzz','m_fade']
    if short:edge-=.08
    if style=='f_bangs': edge+=(1.62-edge)*np.clip(2.7*front,0,1)+.025*np.cos(13*angles)*front
    if style=='m_part':edge+=front*(.21+.24*np.exp(-((abs(s)-.53)/.25)**2)-.19*np.exp(-(s/.20)**2))
    if style=='m_perm':edge+=front*(.20+.06*np.cos(7*angles))
    if style=='m_mullet':edge-=.16*abs(s)**3
    rings=[]; tones=[]
    for t in np.linspace(.08,1,10):
        theta=t*edge
        unit=np.column_stack([np.sin(theta)*s,np.cos(theta),-np.sin(theta)*c])
        crown=np.maximum(0,unit[:,1])
        ripple=.0015*np.cos(10*angles+theta*2)*np.sin(theta)
        puff={'m_buzz':.004,'m_fade':.004,'m_perm':.013,'m_crop':.009,'m_part':.010}.get(style,.008)
        skull=CENTER+unit*CRANIUM
        # Below the brow plane, trace the occiput back into the nape rather than
        # extrapolating the ellipsoid into space behind the neck.
        y=skull[:,1];low=y<.086
        levels=[-.004,.023,.051,.070,.086]
        width=np.interp(y,levels,[.071,.080,.087,.088,.089])
        near=np.interp(y,levels,[-.081,-.084,-.087,-.089,-.092])
        far=np.interp(y,levels,[.044,.075,.111,.126,.130])
        skull[low,0]=(width*s)[low]
        skull[low,2]=((near+far)/2-(far-near)*c/2)[low]
        extra=puff+(0 if short else ripple)
        if style=='m_fade':
            extra=extra+.014*crown**1.6+.019*np.exp(-((unit[:,0]+.19)/.54)**2-((unit[:,2]+.53)/.48)**2)*crown
        if style=='m_part':
            seam=np.exp(-(unit[:,0]/.12)**2)
            extra=extra+.015*crown+.016*front*np.sin(theta)*abs(s)-.012*seam*(1-back)
        if style=='m_perm':
            extra=extra+.010*crown
            for j in range(17):
                v=(j+.5)/18;az=j*2.4
                center=np.array([np.sqrt(1-v*v)*np.sin(az),v,-np.sqrt(1-v*v)*np.cos(az)])
                extra+=.022*np.exp(-np.sum((unit-center)**2,axis=1)/.065)
        pos=skull+unit*np.broadcast_to(extra,(sides,))[:,None]
        rings.append(pos)
        fade=(1-crown)**3*(1-.6*front) if short else np.zeros(sides)
        tones.append(np.stack([.5+.35*np.cos(10*angles+theta*2),fade],axis=1))
    # Roll the edge around the skull and continue up the inside, 24 mm under the outside.
    edge_dir=unit
    for k,offset in [(1,.009),(2,.024)]:
        rings.append(pos-edge_dir*offset+[0,-.003 if k==1 else 0,0])
        tones.append(tones[-1])
    for ring,tone in zip(rings[:9][::-2],tones[:9][::-2]):
        direction=ring-CENTER
        rings.append(ring-.024*direction/np.linalg.norm(direction,axis=1)[:,None]);tones.append(tone)
    top=rings[0][:,1].max()+.001
    cap,faces=surface(rings,[0,top,.019],[0,top-.024,.019])
    points=list(cap);indices=list(faces);colors=list(np.vstack([[.5,0],np.vstack(tones),[.5,0]]))
    def strand(path,w,d,across=(1.,0.,0.),shade=.50):
        pts,tris=lock(path,w,d,np.array(across))
        indices.extend(tris+len(points));points.extend(pts)
        colors.extend([[shade,0]]*len(pts))
    if style=='m_crop':
        for i,x in enumerate(np.linspace(-.062,.057,5)):
            strand([[x-.022,.162,-.022+.035*(x/.063)**2],[x-.020,.153,-.057+.028*(x/.063)**2],[x-.013,.137,-.080+.028*(x/.063)**2],[x-.001,.118,-.092+.028*(x/.063)**2],[x+.009,.095+.006*abs(i-2)+.007*np.sin(i*2),-.096+.034*(x/.063)**2]],
                   [.012,.024,.021,.016,.005],[.010,.012,.012,.012,.010],shade=.34+.12*i)
    if style in ['f_long','f_lob','f_wolf','f_bangs','m_mullet']:
        pts,tris,shades=curtain(style)
        indices.extend(tris+len(points));points.extend(pts);colors.extend(shades)
    if style=='f_pony':
        strand([[0,.149,.104],[0,.157,.132],[.008,.111,.151],[.016,.002,.155],[.013,-.116,.132]],
               [.028,.036,.040,.033,.013],[.026,.031,.033,.028,.012])
    if style=='f_bun':
        strand([[-.032,.052,.127],[-.020,.069,.145],[.007,.072,.154],[.032,.053,.139],[.015,.040,.130]],
               [.018,.041,.044,.032,.014],[.020,.032,.035,.030,.014])
    return np.array(points),np.array(indices),np.array(colors)
