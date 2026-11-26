"""Close-range cabin hardware, hinged airfoils and rotor exposure textures."""
import io
import math

import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation

from helicopter_gltf import MODELS


def blade_mesh(h, parent, index, theta, radius, tail):
    # The origin is the flap hinge. Local X follows the span, including on the tail.
    def orient(x,y,z):
        u = x*math.cos(theta)-z*math.sin(theta)
        v = x*math.sin(theta)+z*math.cos(theta)
        return (y,u,v) if tail else (u,y,v)
    root = radius*.11
    name = f'{parent}_blade_{index+1}'
    h.node(name,orient(root,0,0),parent)
    nodes = h.g['nodes']
    basis = np.array([orient(1,0,0),orient(0,-1 if tail else 1,0),orient(0,0,1)]).T
    nodes[h.frames[name]]['rotation'] = Rotation.from_matrix(basis).as_quat().tolist()
    stations = [.11,.15,.21,.65,.84,.92,.96,.985,1]
    samples = (13,6,3)[h.lod]
    chordwise = (1-np.cos(np.linspace(0,math.pi,samples)))/2
    section = [(u,1) for u in chordwise]+[(u,-1) for u in chordwise[-2:0:-1]]
    rings = []
    for span in stations:
        chord = radius*np.interp(span,[.11,.21,.84,.985,1],[.031,.061,.057,.042,.024])*(1.8 if tail else 1)
        twist = math.radians(13-10*span)
        ring = []
        for u,sign in section:
            # Closed trailing edge, symmetric four-digit airfoil thickness distribution.
            thickness = sign*.65*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
            z = (.25-u)*chord
            y = thickness*chord
            ring.append((radius*span-root,y*math.cos(twist)+z*math.sin(twist),
                         z*math.cos(twist)-y*math.sin(twist)-radius*.20*max(0,span-.84)))
        rings.append(ring)
    n=len(section)
    faces=[(j,(j+1)%n,n+j) for j in range(n)]+[((j+1)%n,n+(j+1)%n,n+j) for j in range(n)]
    for i,(a,b) in enumerate(zip(rings,rings[1:])):
        h.surface(a+b,faces,'gold' if i==6 else 'rubber',name)
    for ring in (rings[0],rings[-1]):
        h.surface(ring,[(0,i,i+1) for i in range(1,n-1)],'rubber',name)


def blur_material(h,suffix,blades):
    name='disk_'+suffix
    axis=np.linspace(-1,1,256)
    x,y=np.meshgrid(axis,axis)
    r=np.hypot(x,y)
    theta=np.arctan2(y,x)
    MODELS.mkdir(parents=True,exist_ok=True)
    for speed in ('medium','high'):
        phase=(np.cos(blades*(theta-.18*r))*.5+.5)**(4 if speed=='medium' else 1.5)
        alpha=(.055+(.52 if speed=='medium' else .19)*phase)*np.clip((r-.10)*8,0,1)
        tip=np.exp(-((r-.973)/.012)**2)
        rgba=np.empty((*r.shape,4),dtype='uint8')
        for i,(base,highlight) in enumerate(zip((56,69,71),(222,185,97))):
            rgba[:,:,i]=base+(highlight-base)*tip
        rgba[:,:,3]=255*np.clip(alpha+.21*tip,0,1)*np.clip((1-r)*90,0,1)
        out=io.BytesIO()
        Image.fromarray(rgba).save(out,'PNG')
        data=out.getvalue()
        if not h.lod:
            (MODELS/f'helicopter_blur_{suffix}_{speed}.png').write_bytes(data)
        if speed=='high':
            images=h.g.setdefault('images',[])
            textures=h.g.setdefault('textures',[])
            textures.append(dict(source=len(images)))
            images.append(dict(bufferView=h.view(data),mimeType='image/png'))
            h.materials[name]=len(h.g['materials'])
            h.g['materials'].append(dict(name=name,doubleSided=True,alphaMode='BLEND',
                pbrMetallicRoughness=dict(baseColorTexture=dict(index=len(textures)-1),metallicFactor=0,roughnessFactor=.85)))
    return name


def trim(h,skin,side,frame,pivot,z0,z1):
    def point(z,a,offset=0):
        return skin(z,a,side)-pivot+[side*offset,0,0]
    # Wrap the moving door edges around the curved cabin cross-section.
    for z in (z0+.014,z1-.014):
        profile=[point(z,a,.012) for a in np.linspace(-22,62,17)]
        for p,q in zip(profile,profile[1:]):
            h.rod(p,q,.017,'rubber',frame,10)
    for a in (0,61):
        rail=[point(z,a,.010) for z in np.linspace(z0,z1,12)]
        for p,q in zip(rail,rail[1:]):
            h.rod(p,q,.021,'paint',frame,10)
    sill=[point(z,-22,.009) for z in np.linspace(z0,z1,10)]
    for p,q in zip(sill,sill[1:]):
        h.rod(p,q,.011,'ink',frame,8)
    # Extruded reveal between outer acrylic and the inboard seal.
    for a,b in [((z0,0),(z1,0)),((z1,0),(z1,62)),((z1,62),(z0,62)),((z0,62),(z0,0))]:
        path=np.linspace(a,b,10)
        for start,end in zip(path,path[1:]):
            p,q=point(*start),point(*end)
            inner=np.array([-side*.024,0,0])
            h.surface([p,q,q+inner,p+inner],[(0,1,2),(0,2,3)],'glass',frame)
            h.rod(p,q,.023,'ink',frame,10)
            h.rod(p+inner,q+inner,.014,'rubber',frame,8)
    # Follow the curved pane on the cabin side to give the acrylic a physical inner face.
    sections=np.linspace(z0,z1,7)
    angles=np.linspace(0,62,9)
    for za,zb in zip(sections,sections[1:]):
        for low,high in zip(angles,angles[1:]):
            corners=[point(t,a,-.024) for t,a in [(za,low),(za,high),(zb,high),(zb,low)]]
            h.surface(corners,[(2,1,0),(3,2,0)],'glass',frame)
    handle=point(z0+.18,-6,.025)
    for length in (0,.18):
        end=handle+[0,0,length]
        h.rod(end,end+[side*.041,0,0],.018,'alloy',frame)
    h.rod(handle+[side*.041,0,0],handle+[side*.041,0,.18],.022,'ink',frame,16)
    for z in np.arange(z0+.05,z1-.02,.078):
        for a in (-18,65):
            p=point(z,a,.003)
            # Low domed flush fasteners along the painted skin, outside glass.
            if a==65:
                p=skin(z,60,side)-pivot
            h.rod(p,p+[side*.012,.004,0],.011,'alloy',frame,10)
    z=(z0+z1)/2
    p=point(z,-9,-.028)
    for start,end in zip(np.linspace(z0+.04,z1-.04,9),np.linspace(z0+.04,z1-.04,9)[1:]):
        corners=[point(t,a,-.042) for t,a in [(start,-20),(end,-20),(end,-2),(start,-2)]]
        h.surface(corners,[(0,1,2),(0,2,3)],'leather',frame)
    for offset in [-.09,.09]:
        q=p+[0,.045,offset]
        h.rod(q,q+[-side*.07,0,0],.019,'alloy',frame)
    h.rod(p+[-side*.07,.045,-.09],p+[-side*.07,.045,.09],.023,'ink',frame)


def upholstery(h,seats):
    for x,y,z in seats.values():
        # Piped upholstery flutes follow the actual front contour of the backrest.
        for offset in (-.20,-.10,0,.10,.20):
            seam=[]
            for height in np.linspace(-.25,.28,11):
                depth=.105*math.sqrt(max(0,1-(offset/.34)**2-(height/.44)**2))
                seam.append((x+offset,y+.24+height,z-.25+depth+.002))
            for p,q in zip(seam,seam[1:]):
                h.rod(p,q,.004,'piping',sides=6)
        for side in (-1,1):
            path=np.array([(x+side*.24,y+.56,z-.167),(x+side*.22,y+.29,z-.13),
                           (x+side*.14,y+.06,z-.13),(x+side*.07,y+.005,z+.09)])
            for p,q in zip(path,path[1:]):
                w=np.array([.026,0,0])
                h.surface([p-w,p+w,q+w,q-w],[(0,1,2),(0,2,3)],'rubber')
            h.box(path[-1],(.081,.022,.07),'alloy')
    for z in np.arange(-1.46,1.63,.10):
        for x in [-.77,0,.77]:
            h.rod((x-.06,.936,z-.019),(x+.06,.936,z+.019),.006,'ink',sides=6)
    h.box((0,2.455,.69),(.33,.064,.56),'ink')
    for z in np.arange(.50,.92,.068):
        for x in [-.091,0,.091]:
            h.rod((x,2.428,z),(x,2.405,z+.012),.012,'alloy',sides=10)
            h.box((x,2.398,z+.013),(.027,.025,.03),'gold' if z<.52 else 'piping')
    for side in (-1,1):
        h.rod((side*.37,.84,1.35),(side*1.06,.13,1.26),.062,'alloy')
        for z in [-1.19,1.25]:
            h.box((side*1.07,.026,z),(.16,.05,.32),'rubber')
        h.rod((side*.72,1.62,2.08),(side*.77,1.64,2.53),.016,'alloy')
        h.rod((side*.30,2.11,-3.22),(side*.69,1.31,-1.81),.025,'paint')
    h.rod((0,2.55,1.23),(0,2.95,1.12),.012,'ink')


def bezel(h,center,radius,tube,mat,frame='airframe',axis='z'):
    import trimesh
    ring=trimesh.creation.torus(major_radius=radius,minor_radius=tube,major_sections=32,minor_sections=8)
    if axis=='y':
        ring.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[1,0,0]))
    h.add(ring.apply_translation(center),mat,frame)


def instruments(h):
    """Print dial scales and the moving map onto one transparent cockpit atlas."""
    from PIL import ImageDraw, ImageFont
    image=Image.new('RGBA',(1280,360))
    draw=ImageDraw.Draw(image)
    font=ImageFont.load_default(size=14)
    small=ImageFont.load_default(size=10)
    def px(x,y):
        return ((.74-x)*1280/1.48,(1.72-y)*360/.41)
    for row,names in enumerate([['FUEL','OIL','TEMP','TORQ','VOLTS'],['ALT','RPM','VSI','IAS','GYRO']]):
        for col,label in enumerate(names):
            x,y=-.56+col*.17,1.42+row*.16
            cx,cy=px(x,y)
            for tick in range(6):
                a=math.radians(-135+tick*54)
                draw.text((cx+34*math.sin(a),cy-34*math.cos(a)),str(tick*2),anchor='mm',font=small,fill='#e7e3cd')
            draw.text((cx,cy+19),label,anchor='mm',font=small,fill='#f2c875')
            bezel(h,(x,y,1.563),.065,.004,'alloy')
            for dx in [-.062,.062]:
                for dy in [-.063,.063]:
                    h.rod((x+dx,y+dy,1.588),(x+dx,y+dy,1.581),.006,'alloy',sides=8)
    left,top=px(.605,1.641)
    right,bottom=px(.234,1.499)
    draw.rectangle((left,top,right,bottom),fill='#1c353c')
    draw.line([(left,top+65),(left+65,top+48),(left+143,top+88),(right,bottom-16)],fill='#4788a1',width=12)
    draw.line([(left+15,bottom-18),(left+78,top+20),(right-55,top+45),(right-20,bottom-22),
               (left+15,bottom-18)],fill='#d5bc78',width=3)
    draw.text((left+7,top+4),'GLOL   NAV 1',font=font,fill='#e3efcb')
    draw.text((right-8,bottom-4),'2 NM',anchor='rs',font=small,fill='white')
    for i in range(5):
        x,y=px(.38+.052*i,1.416)
        draw.text((x,y),str(i+1),anchor='mm',font=small,fill='white')
    out=io.BytesIO()
    image.save(out,'PNG')
    images=h.g['images']
    textures=h.g['textures']
    textures.append(dict(source=len(images)))
    images.append(dict(bufferView=h.view(out.getvalue()),mimeType='image/png'))
    h.materials['dial_print']=len(h.g['materials'])
    h.g['materials'].append(dict(name='instrument scales',alphaMode='MASK',doubleSided=True,
        pbrMetallicRoughness=dict(baseColorTexture=dict(index=len(textures)-1),metallicFactor=0,roughnessFactor=.74)))
    h.surface([(.74,1.31,1.552),(-.74,1.31,1.552),(-.74,1.72,1.552),(.74,1.72,1.552)],
              [(0,1,2),(0,2,3)],'dial_print')
