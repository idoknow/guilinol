"""Build the walking avatar: an original CC0 low-poly traveller (斗笠 hat, 朱 jacket).

Rigid flat-shaded parts on a small joint tree (hips → torso → head/arms, hips → thighs → shins),
facing -Z with feet at the origin, 1.7 m tall without the hat. Clips: idle, walk, run, jump.
Colours follow docs/style.md: a warm vermilion jacket reads against the 石绿/石青 landscape.
"""
import json
import math
import struct
from pathlib import Path

import numpy as np

COLORS = dict(  # sRGB hex → linear factors in material()
    jacket=0xa9503c, sash=0xe6dfcc, trousers=0x4d5a57, skin=0xdcb48e, hat=0xc8a565,
    hatBand=0x7a5a32, shoe=0x3a322b, bundle=0x46708a, hair=0x2a2624)

binary = bytearray()
views, accessors, nodes, meshes, materials, animations = [], [], [], [], [], []
material_index = {}


def accessor(values, kind, component=5126, dtype='<f4', target=None):
    array = np.asarray(values, dtype)
    while len(binary) % 4:
        binary.append(0)
    view = dict(buffer=0, byteOffset=len(binary), byteLength=array.nbytes)
    if target:
        view['target'] = target
    views.append(view)
    binary.extend(array.tobytes())
    item = dict(bufferView=len(views)-1, componentType=component, count=len(array), type=kind)
    if kind == 'VEC3' and target:
        item.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
    if kind == 'SCALAR' and not target:
        item.update(min=[float(array.min())], max=[float(array.max())])
    accessors.append(item)
    return len(accessors)-1


def material(name):
    if name not in material_index:
        value = COLORS[name]
        srgb = [((value >> shift) & 255)/255 for shift in (16, 8, 0)]
        linear = [c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4 for c in srgb]
        materials.append(dict(name=name, pbrMetallicRoughness=dict(baseColorFactor=linear+[1], metallicFactor=0,
                                                                   roughnessFactor=.95)))
        material_index[name] = len(materials)-1
    return material_index[name]


def ring(radius, y, sides, scale=(1, 1), phase=0.):
    return [(radius*scale[0]*math.cos(phase+2*math.pi*k/sides), y, radius*scale[1]*math.sin(phase+2*math.pi*k/sides))
            for k in range(sides)]


def loft(rings, cap_bottom=True, cap_top=True):
    """Triangles of a stack of equal-length rings (bottom → top)."""
    tris = []
    for a, b in zip(rings, rings[1:]):
        n = len(a)
        for k in range(n):
            j = (k+1) % n
            tris += [(a[k], b[j], a[j]), (a[k], b[k], b[j])]
    for cap, flip in [(rings[0], True), (rings[-1], False)]:
        if (flip and not cap_bottom) or (not flip and not cap_top):
            continue
        centre = tuple(np.mean(cap, axis=0))
        n = len(cap)
        for k in range(n):
            j = (k+1) % n
            tris.append((centre, cap[k], cap[j]) if flip else (centre, cap[j], cap[k]))
    return tris


def box(w, h, d, y0=0., z0=0.):
    x, z = w/2, d/2
    return loft([[(-x, y0, z0-z), (-x, y0, z0+z), (x, y0, z0+z), (x, y0, z0-z)],
                 [(-x, y0+h, z0-z), (-x, y0+h, z0+z), (x, y0+h, z0+z), (x, y0+h, z0-z)]])


def part(parts):
    """parts: list of (material name, triangles) → mesh index with flat normals."""
    primitives = []
    for name, tris in parts:
        tri = np.asarray(tris, '<f4').reshape(-1, 3, 3)
        normal = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
        normal /= np.linalg.norm(normal, axis=1, keepdims=True)+1e-9
        position = tri.reshape(-1, 3)
        normals = np.repeat(normal, 3, axis=0)
        primitives.append(dict(attributes=dict(POSITION=accessor(position, 'VEC3', target=34962),
                                               NORMAL=accessor(normals, 'VEC3', target=34962)),
                               material=material(name)))
    meshes.append(dict(primitives=primitives))
    return len(meshes)-1


def node(name, translation, mesh=None, children=()):
    item = dict(name=name, translation=list(translation), children=list(children))
    if mesh is not None:
        item['mesh'] = mesh
    if not item['children']:
        del item['children']
    nodes.append(item)
    return len(nodes)-1


# --- geometry (joint-local, hanging down from the pivot unless noted) ----------------------------
HIP_Y, KNEE, SHOULDER_Y = .9, .45, 1.43
shin = part([('trousers', loft([ring(.07, -.38, 6), ring(.082, 0, 6)])),
             ('shoe', box(.11, .08, .22, -.45, -.04))])
thigh = part([('trousers', loft([ring(.085, -KNEE, 6), ring(.105, 0, 6)]))])
forearm = part([('jacket', loft([ring(.05, -.2, 6), ring(.06, 0, 6)])),
                ('skin', loft([ring(.038, -.3, 5), ring(.045, -.2, 5)]))])
upperarm = part([('jacket', loft([ring(.06, -.29, 6), ring(.07, 0, 6)]))])
# Torso from the waist (pivot) up: jacket flaring into a short skirt below the sash; bundle on the back (+Z).
bundle = [(x, y, z+.16) for x, y, z in np.asarray(loft([ring(.11, .1, 6, (1, .55)), ring(.12, .3, 6, (1, .6)),
                                                         ring(.07, .4, 6, (1, .5))])).reshape(-1, 3)]
torso = part([
    ('jacket', loft([ring(.2, -.2, 8, (1, .78), math.pi/8), ring(.165, -.04, 8, (1, .72), math.pi/8)], cap_top=False)),
    ('sash', loft([ring(.165, -.04, 8, (1, .72), math.pi/8), ring(.16, .05, 8, (1, .72), math.pi/8)], False, False)),
    ('jacket', loft([ring(.16, .05, 8, (1, .72), math.pi/8), ring(.2, .4, 8, (1, .68), math.pi/8),
                     ring(.13, .5, 8, (1, .7), math.pi/8)])),
    ('bundle', [tuple(map(tuple, bundle[k:k+3])) for k in range(0, len(bundle), 3)]),
])
# Head pivot at the neck; 斗笠: wide shallow cone with a band.
head = part([
    ('skin', loft([ring(.045, 0, 6), ring(.05, .06, 6)], False, False)),
    ('skin', loft([ring(.07, .05, 7), ring(.1, .12, 7), ring(.095, .2, 7), ring(.06, .26, 7)])),
    ('hair', loft([ring(.1, .17, 7, phase=.2), ring(.08, .25, 7, phase=.2)], False, False)),
    ('hatBand', loft([ring(.105, .22, 10), ring(.1, .26, 10)], False, False)),
    ('hat', loft([ring(.36, .2, 12), ring(.3, .24, 12), ring(.012, .4, 12)])),
])

legs, arms = [], []
for side, sign in [('L', -1), ('R', 1)]:
    shin_node = node(f'Shin{side}', (0, -KNEE, 0), shin)
    legs.append(node(f'Thigh{side}', (sign*.1, -.02, 0), thigh, [shin_node]))
    fore_node = node(f'Forearm{side}', (0, -.29, 0), forearm)
    arms.append(node(f'Arm{side}', (sign*.21, SHOULDER_Y-HIP_Y-.04, 0), upperarm, [fore_node]))
head_node = node('Head', (0, .52, 0), head)
torso_node = node('Torso', (0, .04, 0), torso, [head_node]+arms)
hips = node('Hips', (0, HIP_Y, 0), None, [torso_node]+legs)
root = node('Traveller', (0, 0, 0), None, [hips])
thighL, thighR = legs
armL, armR = arms
shinL, shinR = (nodes[i]['children'][0] for i in legs)
foreL, foreR = (nodes[i]['children'][0] for i in arms)


# --- animation --------------------------------------------------------------------------------
def quat_x(angle):
    return [math.sin(angle/2), 0, 0, math.cos(angle/2)]


def quat_xz(ax, az):
    cx, sx, cz, sz = math.cos(ax/2), math.sin(ax/2), math.cos(az/2), math.sin(az/2)
    return [sx*cz, -sx*sz, cx*sz, cx*cz]


def clip(name, duration, pose, keys=16):
    """pose(phase 0..2π) → {node: ('r', quat) | ('t', xyz)}; first key repeated at the end for a seamless loop."""
    times = [duration*k/keys for k in range(keys+1)]
    tracks = {}
    for t in times:
        for target, (path, value) in pose(2*math.pi*t/duration).items():
            tracks.setdefault((target, path), []).append(value)
    time_acc = accessor([[t] for t in times], 'SCALAR')
    samplers, channels = [], []
    for (target, path), values in tracks.items():
        out = accessor(values, 'VEC4' if path == 'r' else 'VEC3')
        samplers.append(dict(input=time_acc, output=out))
        channels.append(dict(sampler=len(samplers)-1,
                             target=dict(node=target, path='rotation' if path == 'r' else 'translation')))
    animations.append(dict(name=name, samplers=samplers, channels=channels))


def gait(swing, knee, arm, elbow, bob, lean, twist):
    def pose(p):
        s = math.sin(p)
        return {
            thighL: ('r', quat_x(swing*s)), thighR: ('r', quat_x(-swing*s)),
            shinL: ('r', quat_x(-knee*max(0, math.sin(p-1.3)))), shinR: ('r', quat_x(-knee*max(0, math.sin(p+math.pi-1.3)))),
            armL: ('r', quat_xz(-arm*s, -.08)), armR: ('r', quat_xz(arm*s, .08)),
            foreL: ('r', quat_x(elbow*(1+.4*-s))), foreR: ('r', quat_x(elbow*(1+.4*s))),
            hips: ('t', (0, HIP_Y-bob*.5+bob*abs(math.cos(p)), 0)),
            torso_node: ('r', [math.sin(-lean/2)*math.cos(twist*s/2), math.sin(twist*s/2), 0,
                               math.cos(-lean/2)*math.cos(twist*s/2)]),
        }
    return pose


clip('idle', 3.2, lambda p: {
    torso_node: ('r', quat_x(-.02-.015*math.sin(p))), head_node: ('r', quat_xz(.03*math.sin(p+1), 0)),
    armL: ('r', quat_xz(0, -.06-.015*math.sin(p))), armR: ('r', quat_xz(0, .06+.015*math.sin(p))),
    foreL: ('r', quat_x(.12)), foreR: ('r', quat_x(.12)),
    thighL: ('r', quat_x(0)), thighR: ('r', quat_x(0)), shinL: ('r', quat_x(0)), shinR: ('r', quat_x(0)),
    hips: ('t', (0, HIP_Y-.006*(1+math.sin(p)), 0))})
clip('walk', 1.0, gait(swing=.42, knee=.7, arm=.32, elbow=.22, bob=.035, lean=.05, twist=.1))
clip('run', .62, gait(swing=.8, knee=1.5, arm=.75, elbow=1.1, bob=.07, lean=.2, twist=.16))
clip('jump', .8, lambda p: {
    thighL: ('r', quat_x(.75)), thighR: ('r', quat_x(.25)), shinL: ('r', quat_x(-1.1)), shinR: ('r', quat_x(-.55)),
    armL: ('r', quat_xz(.5+.05*math.sin(p), -.5)), armR: ('r', quat_xz(-.3+.05*math.sin(p), .5)),
    foreL: ('r', quat_x(.6)), foreR: ('r', quat_x(.4)), torso_node: ('r', quat_x(-.12)),
    hips: ('t', (0, HIP_Y+.02*math.sin(p), 0))})

doc = dict(asset=dict(version='2.0', generator='guilinol pipeline/avatar.py', copyright='CC0-1.0'), scene=0,
           scenes=[dict(nodes=[root])], nodes=nodes, meshes=meshes, materials=materials, animations=animations,
           accessors=accessors, bufferViews=views, buffers=[dict(byteLength=len(binary))])
while len(binary) % 4:
    binary.append(0)
doc['buffers'][0]['byteLength'] = len(binary)
text = json.dumps(doc, separators=(',', ':')).encode()
text += b' '*(-len(text) % 4)
target = Path(__file__).resolve().parents[1]/'public/avatar/figure.glb'
target.parent.mkdir(exist_ok=True, parents=True)
target.write_bytes(struct.pack('<4sII', b'glTF', 2, 28+len(text)+len(binary))+struct.pack('<I4s', len(text), b'JSON')+text +
                   struct.pack('<I4s', len(binary), b'BIN\0')+binary)
print(target, target.stat().st_size, 'bytes')
