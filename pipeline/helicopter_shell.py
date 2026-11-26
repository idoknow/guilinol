"""Lofted fairings, shell panels and soft furnishings for the tour helicopter."""
import math
import numpy as np
import trimesh


def loft(h, rings, material, frame='airframe', close=False):
    """Join closed contours with shared vertices for continuous curvature."""
    rings=np.asarray(rings)
    rows,n=rings.shape[:2]
    faces=[]
    for row in range(rows-1):
        for i in range(n):
            a=row*n+i
            b=row*n+(i+1)%n
            faces.extend([(a,b,b+n),(a,b+n,a+n)])
    if close:
        for i in range(1,n-1):
            faces.extend([(0,i+1,i),((rows-1)*n,(rows-1)*n+i,(rows-1)*n+i+1)])
    h.surface(rings.reshape(-1,3),faces,material,frame)


def cowling(h):
    """Two swept nacelles with a rolled inlet lip and recessed grille."""
    n=(48,16,8)[h.lod]
    angle=np.arange(n)*math.tau/n
    for side in (1,-1):
        def ring(z,x,y,w,d):
            return np.column_stack((side*x+w*np.cos(angle),y+d*np.sin(angle),np.full(n,z)))
        profiles=[(-2.10,.39,2.49,.16,.13),(-1.78,.47,2.65,.34,.23),
                  (-1.25,.47,2.76,.43,.31),(-.59,.46,2.79,.45,.31),
                  (-.03,.48,2.80,.39,.26),(.37,.49,2.79,.32,.19)]
        from scipy.interpolate import PchipInterpolator
        p=np.array(profiles)
        contour=PchipInterpolator(p[:,0],p[:,1:])
        sections=np.linspace(p[0,0],p[-1,0],(33,9,4)[h.lod])
        # Split the shell along its shoulder into a jade crown and ceramic-white cheek.
        body=np.array([ring(z,*contour(z)) for z in sections])
        for crown,mat in [(True,'jade'),(False,'paint')]:
            faces=[]
            for j in range(len(sections)-1):
                for k,ang in enumerate(angle):
                    if (math.sin(ang)>.30)!=crown:
                        continue
                    i=j*n+k
                    l=j*n+(k+1)%n
                    faces.extend([(i,l,l+n),(i,l+n,i+n)])
            h.surface(body.reshape(-1,3),faces,mat)
        lip=ring(.37,.49,2.79,.32,.19)
        mouth=ring(.40,.49,2.79,.28,.154)
        back=ring(.18,.49,2.79,.24,.125)
        loft(h,[lip,mouth],'alloy')
        loft(h,[mouth,back,ring(.17,.49,2.79,.001,.001)],'ink')
        if h.lod<2:
            for t in np.linspace(-.80,.80,7):
                dy=.134*math.sqrt(1-t*t)
                x=side*.49+.25*t
                h.rod((x,2.79-dy,.30),(x,2.79+dy,.30),.010,'alloy',sides=6)
        # Rear-facing exhaust shroud and deep dark throat.
        exhaust=[ring(z,.39,y,w,d) for z,y,w,d in
                 [(-1.84,2.58,.17,.14),(-2.12,2.64,.195,.153),(-2.16,2.65,.183,.14),
                  (-2.16,2.65,.157,.114)]]
        loft(h,exhaust,'alloy')
        loft(h,[exhaust[-1],ring(-1.92,.39,2.60,.125,.085),ring(-1.91,.39,2.60,.001,.001)],'ink')


def tail_surfaces(h,boom):
    # Airfoil sections thicken at the fin root and taper into a swept tip.
    points=(25,9,4)[h.lod]
    chord=(1-np.cos(np.linspace(0,math.pi,points)))/2
    outline=[(u,1) for u in chord]+[(u,-1) for u in chord[-2:0:-1]]
    def fin(x,stations,mat):
        rings=[]
        for y,front,length,width in stations:
            rings.append([(x+sign*width*math.sin(math.pi*u)**.6,y,front-u*length)
                          for u,sign in outline])
        loft(h,rings,mat,close=True)
    fin(0,[(1.47,-6.40,.25,.03),(2.13,-5.87,.91,.085),(2.58,-6.02,.84,.09),
           (3.39,-6.48,.64,.051),(3.67,-6.70,.44,.025)],'jade')
    for side in (-1,1):
        rings=[]
        for width,front,length in [(0,-4.51,.81),(.63,-4.56,.74),(1.30,-4.72,.52)]:
            rings.append([(side*width,2.19+.06*width+sign*.047*math.sin(math.pi*u)**.6,
                           front-u*length) for u,sign in outline])
        loft(h,rings,'paint',close=True)
        fin(side*1.30,[(2.16,-4.74,.49,.018),(2.28,-4.68,.59,.022),(2.62,-4.90,.37,.014)],'jade')
    rings=[]
    for z in np.linspace(-2.12,-6.35,(28,6,3)[h.lod]):
        w,y,d=boom(z)
        rings.append([(-w*.36,y+d*.88,z),(-w*.19,y+d+.059,z),
                      (w*.19,y+d+.059,z),(w*.36,y+d*.88,z)])
    loft(h,rings,'jade',close=True)


def cushion(h,center,half,material):
    # A rounded cuboid defined by projecting the six faces onto a filleted box.
    half=np.array(half)
    radius=min(half)*.72
    vertices=[]
    faces=[]
    grid=np.linspace(-1,1,13)
    for axis in range(3):
        for sign in (-1,1):
            start=len(vertices)
            for u in grid:
                for v in grid:
                    p=np.zeros(3)
                    p[axis]=sign
                    p[(axis+1)%3]=u
                    p[(axis+2)%3]=v
                    inner=np.clip(p*half,-half+radius,half-radius)
                    normal=p*half-inner
                    vertices.append(center+inner+radius*normal/np.linalg.norm(normal))
            for i in range(len(grid)-1):
                for j in range(len(grid)-1):
                    a=start+i*len(grid)+j
                    quad=[a,a+len(grid),a+len(grid)+1,a+1]
                    if sign<0:
                        quad.reverse()
                    faces.extend([(quad[0],quad[1],quad[2]),(quad[0],quad[2],quad[3])])
    h.add(trimesh.Trimesh(vertices,faces,process=True),material)


def seat_trim(h,x,y,z):
    cushion(h,np.array([x,y-.104,z+.052]),(.318,.098,.325),'leather')
    cushion(h,np.array([x,y+.29,z-.238]),(.314,.323,.090),'leather')
    for side in (-1,1):
        cushion(h,np.array([x+side*.265,y+.27,z-.17]),(.052,.286,.063),'piping')
        h.rod((x+side*.089,y+.56,z-.234),(x+side*.089,y+.70,z-.234),.014,'alloy')
    cushion(h,np.array([x,y+.686,z-.232]),(.187,.102,.073),'leather')
    # Back and pan inserts carry paired stitch lines, with webbing laid on the surface.
    for offset in (-.145,0,.145):
        for t in np.linspace(-.22,.22,15):
            h.rod((x+offset,y+.29+t,z-.146),(x+offset,y+.29+t+.019,z-.146),.003,'piping',sides=5)
            h.rod((x+offset,y-.004,z+.05+t),(x+offset,y-.004,z+.069+t),.003,'piping',sides=5)
    for side in (-1,1):
        path=np.array([(x+side*.17,y+.57,z-.150),(x+side*.155,y+.42,z-.145),
                       (x+side*.12,y+.14,z-.145),(x+side*.072,y+.009,z-.131),
                       (x+side*.047,y+.004,z+.086)])
        for p,q in zip(path,path[1:]):
            w=np.array([.022,0,0])
            h.surface([p-w,p+w,q+w,q-w],[(0,1,2),(0,2,3)],'webbing')
        h.box(path[-1]+[0,.012,0],(.068,.023,.066),'alloy')
        h.box(path[-1]+[0,.027,.004],(.042,.010,.033),'ink')
