"""Generate the three tour helicopter assets in web/public/models (+Z nose, metres)."""
import math
import subprocess
import tempfile
from pathlib import Path
from scipy.interpolate import PchipInterpolator
from helicopter_detail import blade_mesh, blur_material, trim, upholstery, bezel, instruments

import numpy as np

from helicopter_gltf import Aircraft, MODELS, read_glb, write_glb
from helicopter_pilot import pilot

# z, half breadth, centre height, half height.
SECTIONS = [(-2.65,.09,1.83,.12),(-2.25,.62,1.77,.57),(-1.55,1.01,1.68,.99),
            (-1.27,1.09,1.66,1.03),(.44,1.12,1.66,1.03),(1.36,1.07,1.65,1.0),
            (1.88,.91,1.52,.83),(2.33,.66,1.40,.57),(2.62,.34,1.35,.32),(2.73,.04,1.35,.07)]
SEATS = {'pilot':(-.52,1.32,.84), 'pax_1':(.52,1.32,.84),
         'pax_2':(.52,1.32,-.72), 'pax_3':(-.52,1.32,-.72)}
ANGLES = [-90,-58,-22,-12,0,36,62,90]


PROFILE = PchipInterpolator(np.array(SECTIONS)[:,0], np.array(SECTIONS)[:,1:])


def skin(z, angle, side):
    w, h, d = PROFILE(z)
    a = math.radians(angle)
    def rounded(v):
        return np.sign(v)*abs(v)**.74
    return np.array([side*w*rounded(math.cos(a)), h+d*rounded(math.sin(a)), z])


def cabin(h):
    lod = h.lod
    angles = ANGLES if lod < 2 else [-90,-22,-12,0,62,90]
    sections = [s[0] for s in SECTIONS] if lod < 2 else [-2.65,-1.27,.44,1.36,2.33,2.73]
    for side,label in [(1,'L'),(-1,'R')]:
        door = 'door_'+label
        hinge = skin(.44,-12,side)
        h.node(door,hinge)
        front = 'door_front_'+label
        front_hinge = skin(1.36,-12,side)
        h.node(front,front_hinge)
        h.g['nodes'][h.frames[door]]['extras'] = dict(seats=['seat_pax_2' if side==1 else 'seat_pax_3'])
        h.g['nodes'][h.frames[front]]['extras'] = dict(seats=['seat_pax_1' if side==1 else 'seat_pilot'])
        for z0,z1 in zip(sections,sections[1:]):
            for a0,a1 in zip(angles,angles[1:]):
                movable = -1.27 <= z0 < .44 and -22 <= a0 < 62
                frame = door if movable else 'airframe'
                pivot = hinge if movable else 0
                if .44 <= z0 < 1.36 and -22 <= a0 < 62:
                    frame, pivot = front, front_hinge
                material = 'paint'
                if a0 == -22:
                    material = 'jade'
                windshield = z0 >= 1.36 and z0 < 2.62 and a0 >= 62
                if windshield or (0 <= a0 < 62 and -1.27 <= z0 < 2.62):
                    material = 'glass'
                nz, na = (5,4) if lod == 0 else (1,1)
                verts = [skin(z,a,side) - pivot
                         for z in np.linspace(z0,z1,nz+1) for a in np.linspace(a0,a1,na+1)]
                faces = []
                for j in range(nz):
                    for k in range(na):
                        i = j*(na+1)+k
                        faces += [(i,i+1,i+na+2),(i,i+na+2,i+na+1)]
                h.surface(verts, faces if side==1 else [f[::-1] for f in faces], material, frame)
        for z in (sections[0],sections[-1]):
            edge = [skin(z,a,side) for a in angles]
            h.surface([np.mean(edge,axis=0)]+edge,[(0,i+1,i+2) for i in range(len(edge)-1)]+[(0,len(edge),1)],'paint')
        if lod < 2:
            def bead(zs, aa, mat, radius, frame='airframe'):
                pts = [skin(z,a,side) - (hinge if frame==door else 0) for z,a in zip(zs,aa)]
                for p,q in zip(pts,pts[1:]):
                    h.rod(p,q,radius,mat,frame,6 if not lod else 3)
            if side==1:
                bead([1.36,1.88,2.33,2.62],[90]*4,'ink',.032)
            for z in ([] if not lod else [-1.27,.44,1.36]):
                bead([z]*5,[-22,0,30,49,62],'ink',.035,door if z<1 else 'airframe')
            for a in [0,62]:
                if lod:
                    bead([-1.27,.44],[a]*2,'ink',.033,door)
                bead([1.36,1.88,2.33,2.62],[a]*4,'ink',.035)
            if lod:
                h.rod(skin(-1.08,-6,side)-hinge, skin(-.85,-6,side)-hinge,.027,'ink',door)
            if not lod:
                for z in [-2.25,-1.55,1.88]:
                    bead([z]*6,[-88,-65,-45,-32,-20,-11],'alloy',.008)
        if lod == 0:
            for frame,pivot,zmin,zmax in [(door,hinge,-1.27,.44),(front,front_hinge,.44,1.36)]:
                trim(h,skin,side,frame,pivot,zmin,zmax)
        if not lod:
            # Shallow curved service hatch behind the passenger door.
            stations = np.linspace(-2.13,-1.53,10)
            elevations = np.linspace(-17,27,8)
            for z0,z1 in zip(stations,stations[1:]):
                for a0,a1 in zip(elevations,elevations[1:]):
                    corner = [skin(z,a,side)+[side*.012,0,0] for z,a in [(z0,a0),(z1,a0),(z1,a1),(z0,a1)]]
                    h.surface(corner,[(0,2,1),(0,3,2)],'paint')
            for a in [elevations[0],elevations[-1]]:
                seam = [skin(z,a,side)+[side*.016,0,0] for z in stations]
                for p,q in zip(seam,seam[1:]):
                    h.rod(p,q,.008,'ink')
                for p in seam[::2]:
                    h.rod(p,p+[side*.012,0,0],.016,'alloy',sides=10)
            for z in stations[::2]:
                bead([z,z],[3,19],'ink',.019)
        step = 'step_'+label
        h.node(step,(side*1.19,.56,-.40))
        if lod < 2:
            h.box((0,-.035,0),(.25,.07,.92),'alloy',step)
            if not lod:
                for z in np.linspace(-.38,.38,9):
                    h.box((0,.004,z),(.23,.009,.024),'rubber',step)
        if not lod:
            for z in (-.73,-.08):
                h.rod((side*.82,.79,z),(side*1.21,.53,z),.029,'alloy')
            h.box((side*1.18,.52,.89),(.23,.065,.60),'alloy')
            for z in np.linspace(.65,1.13,9):
                h.box((side*1.18,.559,z),(.216,.012,.021),'rubber')
            for z in (.68,1.10):
                h.rod((side*.81,.82,z),(side*1.18,.495,z),.027,'alloy')
        x = side*1.07
        path = [(x,.24,-1.96),(x,.07,-1.66),(x,.07,1.56),(x,.15,1.83),(x,.29,2.04)]
        if lod == 2:
            path = path[1:3]+path[-1:]
        for p,q in zip(path,path[1:]):
            h.rod(p,q,.07,'ink',sides=(12,5,3)[lod])
        for z in (-1.14,.98):
            h.rod((side*.69,.92,z),(x,.11,z+.12),.058,'alloy',sides=(12,5,3)[lod])
    if not lod:
        # Upholstered pressure bulkhead closes the aft taper behind the rear row.
        perimeter = [skin(-1.38,a,1) for a in np.linspace(-90,90,24)]
        perimeter += [skin(-1.38,a,-1) for a in np.linspace(90,-90,24)]
        h.surface([(0,1.66,-1.38)]+perimeter,[(0,i+1,1+(i+1)%len(perimeter)) for i in range(len(perimeter))],'leather')
        h.oval((0,2.57,-.05),(.89,.09,1.62),'piping')
        h.box((0,.87,.08),(1.84,.12,3.38),'rubber')


def boom(z):
    t = (-z-1.94)/4.65
    return .44-.345*t, 1.85+.42*t, .43-.31*t


def tail(h):
    n = (24,8,4)[h.lod]
    zs = np.linspace(-1.94,-6.59, (14,3,2)[h.lod])
    verts = []
    for z in zs:
        w,y,d = boom(z)
        for a in np.arange(n)*math.tau/n:
            verts.append([w*math.cos(a), y+d*math.sin(a),z])
    for j in range(len(zs)-1):
        for k in range(n):
            i,l = j*n+k,j*n+(k+1)%n
            h.surface([verts[p] for p in (i,l,l+n,i+n)],[(0,2,1),(0,3,2)],
                      'jade' if k in (n//2,n-1) else 'paint')
    # Swept vertical stabilizer and tapered horizontal stabilizers.
    def foil(poly, delta, mat):
        base = np.array(poly)
        size = len(poly)
        faces = [(0,i,i+1) for i in range(1,size-1)]
        faces += [(size,size+i+1,size+i) for i in range(1,size-1)]
        for i in range(size):
            j=(i+1)%size
            faces += [(i,i+size,j),(j,i+size,j+size)]
        h.surface(np.vstack([base,base+delta]),faces,mat)
    foil([(-.045,1.90,-6.32),(-.045,2.22,-5.91),(-.045,3.53,-6.64),(-.045,3.60,-7.05),
          (-.045,2.11,-6.66),(-.045,1.52,-6.71)], [.09,0,0],'jade')
    for side in (-1,1):
        foil([(0,2.14,-4.82),(side*1.12,2.18,-5.10),(side*1.16,2.18,-5.44),(0,2.14,-5.38)],
             [0,.055,0],'paint')
    if h.lod < 2:
        h.lettering()
        for side in [-1,1]:
            zs = [-2.50,-4.90] if side==1 else [-4.90,-2.50]
            quad = []
            for z,dy in [(zs[0],-.035),(zs[1],-.035),(zs[1],.20),(zs[0],.20)]:
                w,y,d = boom(z)
                quad.append((side*(w+.008),y+dy,z))
            h.surface(quad,[(0,1,2),(0,2,3)],'lettering')


def rotors(h):
    for tail_rotor in (False,True):
        suffix = 'tail' if tail_rotor else 'main'
        center = (.22,2.39,-6.46) if tail_rotor else (0,3.30,-.30)
        radius = .91 if tail_rotor else 5.15
        frame = 'rotor_'+suffix
        blur = 'rotor_blur_'+suffix
        for name in [frame,blur]:
            h.node(name,center)
        def point(x,y,z):
            return (y,x,z) if tail_rotor else (x,y,z)
        h.rod(point(0,-.12,0),point(0,.09,0),radius*.047,'alloy',frame,sides=(20,8,3)[h.lod])
        blades = 2 if tail_rotor else 4
        for k in range(blades):
            theta = k*math.tau/blades
            def blade(x,z,y=0):
                return point(radius*(x*math.cos(theta)-z*math.sin(theta)),y,
                             radius*(x*math.sin(theta)+z*math.cos(theta)))
            blade_mesh(h,frame,k,theta,radius,tail_rotor)
            if not h.lod:
                h.rod(blade(.045,.02,-.19),blade(.098,.024,-.025),.018 if tail_rotor else .025,'alloy',frame)
                h.rod(blade(.025,0),blade(.145,0),radius*.013,'alloy',frame,16)
                h.rod(blade(.11,0,-.06),blade(.11,0,.06),radius*.012,'gold',frame,6)
        if not h.lod and not tail_rotor:
            for k in range(blades):
                theta=k*math.tau/blades
                def mount(span,height,chord):
                    return np.array([span*math.cos(theta)-chord*math.sin(theta),height,
                                     span*math.sin(theta)+chord*math.cos(theta)])
                # Forged fork surrounds the pitch bearing. Clevis bolts face upwards.
                for chord in [-.054,.054]:
                    h.rod(mount(.32,.015,chord),mount(.61,.015,chord),.031,'alloy',frame)
                for span in [.33,.57]:
                    bolt=mount(span,.072,0)
                    bezel(h,bolt,.042,.008,'rubber',frame,'y')
                    h.rod(bolt,bolt+[0,.034,0],.038,'alloy',frame,6)
                for height,span in [(-.24,.17),(-.07,.44)]:
                    h.oval(mount(span,height,.115),(.036,.035,.037),'gold',frame)
                h.rod(mount(.17,-.24,.115),mount(.44,-.07,.115),.019,'alloy',frame)
            bezel(h,(0,-.19,0),.22,.024,'alloy',frame,'y')
            bezel(h,(0,.09,0),.147,.019,'alloy',frame,'y')
        if not h.lod:
            for y,r in [(-.16,.053),(-.11,.048),(.07,.029)]:
                h.rod(point(0,y-.018,0),point(0,y+.018,0),radius*r,'alloy',frame,36)
        sides = (48,20,8)[h.lod]
        disk = [point(0,0,0)]+[point(radius*math.cos(t),0,radius*math.sin(t)) for t in np.arange(sides)*math.tau/sides]
        h.surface(disk,[(0,i+1,(i+1)%sides+1) for i in range(sides)],blur_material(h,suffix,blades),blur)
    h.rod((0,2.65,-.30),(0,3.30,-.30),.10,'alloy',sides=(20,8,3)[h.lod])
    if h.lod == 2:
        h.rod((0,2.67,-1.68),(0,2.71,.25),.30,'paint',sides=5)
    if h.lod < 2:
        h.oval((0,2.75,-.68),(.68,.30,1.33),'paint')
        if not h.lod:
            for side in [-1,1]:
                for z in np.linspace(-1.32,-.76,8):
                    h.rod((side*.57,2.82,z),(side*.48,2.93,z-.06),.023,'ink')
                h.rod((side*.39,2.71,-1.67),(side*.42,2.79,-2.01),.13,'alloy')
                h.rod((side*.42,2.79,-2.015),(side*.423,2.795,-2.035),.105,'ink')


def interior(h):
    for name,(x,y,z) in SEATS.items():
        h.node('seat_'+name,(x,y,z))
        if not h.lod:
            h.box((x,1.03,z),(.39,.28,.40),'alloy')
            h.oval((x,y-.11,z+.06),(.35,.105,.38),'leather')
            h.oval((x,y+.24,z-.25),(.34,.44,.105),'leather')
            h.oval((x,y+.68,z-.24),(.20,.13,.082),'piping')
            for offset in [-.18,0,.18]:
                h.rod((x+offset,y+.05,z-.15),(x+offset,y+.49,z-.16),.009,'piping')
        for side,label in [(1,'L'),(-1,'R')]:
            rest = (x+side*.35,y+.20,z+.08)
            if name != 'pilot':
                h.node('hand_rest_'+name+'_'+label,rest)
            if not h.lod:
                h.rod((rest[0],y-.10,z-.07),(rest[0],rest[1],z-.07),.024,'alloy')
                h.oval((rest[0],rest[1]-.03,rest[2]),(.047,.044,.215),'rubber')
    h.node('cam_pax_1',(.52,2.04,.90))
    if h.lod:
        return
    upholstery(h,SEATS)
    controls = pilot(h,SEATS['pilot'])
    h.oval((0,1.49,1.92),(.87,.28,.27),'ink')
    h.box((0,1.51,1.73),(1.46,.37,.26),'ink')
    for row in range(2):
        for col in range(5):
            x,y = -.56+col*.17,1.42+row*.16
            h.rod((x,y,1.62),(x,y,1.57),.074,'alloy')
            h.rod((x,y,1.57),(x,y,1.562),.063,'rubber')
            for tick in range(10):
                angle = math.radians(35+tick*31)
                dx,dy = math.sin(angle),math.cos(angle)
                h.rod((x+.051*dx,y+.051*dy,1.559),(x+.059*dx,y+.059*dy,1.559),.0028,'piping',sides=4)
            h.rod((x,y,1.558),(x+.029*math.cos(col),y+.034,1.556),.006,'white')
    h.box((.42,1.57,1.585),(.42,.18,.031),'rubber')
    h.box((.42,1.57,1.565),(.38,.15,.008),'jade')
    for k in range(4):
        h.box((.37,1.51+k*.031,1.559),(.21-.03*k,.008,.006),'white')
    for k in range(5):
        h.box((.38+k*.052,1.45,1.585),(.033,.049,.035),'gold' if k==0 else 'piping')
    instruments(h)
    switch = controls['switch']
    h.box(switch+[0,-.04,.044],(.155,.081,.091),'rubber')
    h.rod(switch+[0,-.024,.028],switch,.011,'gold')
    h.rod(switch+[0,-.038,.07],(switch[0],1.41,1.77),.027,'alloy')
    for side in ['l','r']:
        grip = controls['hand_'+side]+[0,-.035,.065]
        mount = (grip[0],.93,grip[2]+.13) if side=='r' else (grip[0]+.06,1.15,grip[2]-.47)
        h.rod(mount,grip,.026,'alloy')
        h.rod(grip,grip+[0,.06,.054],.041,'rubber')
        for t in np.linspace(.12,.88,5):
            p = grip + t*np.array([0,.06,.054])
            h.rod(p,p+[0,.004,.0036],.043,'ink',sides=16)
        foot = controls['foot_'+side]
        h.box(foot+[0,-.022,.115],(.14,.039,.19),'alloy')


def generate(lod):
    h = Aircraft(lod)
    cabin(h)
    tail(h)
    rotors(h)
    interior(h)
    h.node('skid_contact')
    for name,position,color in [('left',(1.06,1.90,-1.43),'red'),('right',(-1.06,1.90,-1.43),'green'),
                                ('tail',(0,3.56,-6.88),'white'),('beacon',(0,2.97,-.91),'red')]:
        frame = 'nav_'+name
        h.node(frame,position)
        if lod < 2:
            if lod==0:
                h.rod((0,-.052,0),(0,-.022,0),.061,'alloy',frame,20)
                h.oval((0,0,0),(.054,.053,.079),color,frame)
            else:
                h.box((0,0,0),(.085,.08,.11),color,frame)
    h.finish()
    path = MODELS / ('helicopter_tour'+(f'_lod{lod}' if lod else '')+'.glb')
    path.parent.mkdir(parents=True, exist_ok=True)
    if lod == 0:
        with tempfile.TemporaryDirectory() as temp:
            raw = Path(temp) / 'source.glb'
            h.save(raw)
            subprocess.run(['gltfpack','-i',str(raw),'-o',str(raw.with_name('packed.glb')),'-cf','-kn','-km','-ke'],check=True)
            # Keep GLTFLoader's decoder-free path inside the GLB as well.
            doc,compressed=read_glb(raw.with_name('packed.glb'))
            fallback=doc['buffers'][1]
            offset=(len(compressed)+3)//4*4
            payload=compressed+bytes(offset-len(compressed))+(raw.parent/fallback['uri']).read_bytes()
            for view in doc['bufferViews']:
                if view['buffer']==1:
                    view.update(buffer=0,byteOffset=offset+view.get('byteOffset',0))
            doc['buffers']=[dict(byteLength=len(payload))]
            write_glb(path,doc,payload)
    else:
        h.save(path)
    packed,_ = read_glb(path)
    count = sum(packed['accessors'][p['indices']]['count']//3 for n in packed['nodes'] if 'mesh' in n
                for p in packed['meshes'][n['mesh']]['primitives'])
    print(f'{path.name}: {count:,} triangles')


if __name__ == '__main__':
    for level in range(3):
        generate(level)
