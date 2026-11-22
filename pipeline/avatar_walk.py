"""Re-author the `walk` and `idle` clips of public/avatar/figure.glb as a natural city walk (IDOK-133).

The clip shipped with figure_a had a hunched torso, bent-knee "sneaking" stance and arms that only swung in
front of the body, and it was played at 4 m/s so the feet skated. This script rebuilds the clip procedurally:

* sagittal hip / knee / ankle angles follow normal adult gait curves (heel strike → loading response →
  mid stance → heel-off → toe-off → swing), legs half a cycle apart;
* pelvis yaw / list / lateral sway, thorax counter-rotation, relaxed arms hanging beside the thighs that swing
  with the opposite leg, slight elbow bend, head stabilised and looking ahead;
* the pelvis height is solved from the skinned mesh every frame so the lowest sole vertex sits on y = 0, and
  the walking speed is measured from the planted foot so the game can play the clip without foot sliding.

`idle` is rebuilt with the same rig as a relaxed standing pose (feet under the hips, arms hanging, slow
breathing and a small weight shift). Every other clip and the mesh are copied untouched. Run: `python3 pipeline/avatar_walk.py` (rewrites the glb in
place and prints the measured walk speed that `web/src/walk/config.ts` must use).
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

GLB = Path(__file__).resolve().parents[1] / 'public/avatar/figure.glb'
WALK_KEYS, WALK_CYCLE = 33, .94    # s per stride (two steps): ~128 steps/min, a brisk city pace
IDLE_KEYS, IDLE_CYCLE = 25, 4.0    # one breath-and-sway loop
MARK = 'pipeline/avatar_walk.py IDOK-133'
DEG = np.pi / 180


# ---------------------------------------------------------------- quaternion / matrix helpers (x, y, z, w)
def qmul(a, b):
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return np.array([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
                     w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2])


def qinv(q):
    return q * np.array([-1, -1, -1, 1.])


def qaxis(axis, angle):
    axis = np.asarray(axis, float)
    return np.array([*(axis / np.linalg.norm(axis) * np.sin(angle / 2)), np.cos(angle / 2)])


def rx(a): return qaxis((1, 0, 0), a)
def ry(a): return qaxis((0, 1, 0), a)
def rz(a): return qaxis((0, 0, 1), a)


def chain(*qs):
    out = np.array([0, 0, 0, 1.])
    for q in qs:
        out = qmul(out, q)
    return out


def qslerp_id(q, t):
    """Fraction t of rotation q (from identity)."""
    q = q / np.linalg.norm(q)
    if q[3] < 0:
        q = -q
    ang = 2 * np.arccos(np.clip(q[3], -1, 1))
    if ang < 1e-9:
        return np.array([0, 0, 0, 1.])
    return qaxis(q[:3], ang * t)


def qmat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def trs(t, q, s):
    m = np.eye(4)
    m[:3, :3] = qmat(q) * np.asarray(s)
    m[:3, 3] = t
    return m


# ---------------------------------------------------------------- glb io
class Glb:
    def __init__(self, path):
        data = path.read_bytes()
        jlen = struct.unpack('<I', data[12:16])[0]
        self.j = json.loads(data[20:20 + jlen])
        blen = struct.unpack('<I', data[20 + jlen:24 + jlen])[0]
        self.bin = bytes(data[28 + jlen:28 + jlen + blen])
        nodes = self.j['nodes']
        self.names = [n.get('name') for n in nodes]
        self.idx = {n: i for i, n in enumerate(self.names)}
        self.parent = [-1] * len(nodes)
        for i, n in enumerate(nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.T = [np.array(n.get('translation', [0, 0, 0]), float) for n in nodes]
        self.R = [np.array(n.get('rotation', [0, 0, 0, 1]), float) for n in nodes]
        self.S = [np.array(n.get('scale', [1, 1, 1]), float) for n in nodes]
        self.order, seen = [], set()

        def visit(i):
            if i in seen:
                return
            if self.parent[i] >= 0:
                visit(self.parent[i])
            seen.add(i)
            self.order.append(i)
        for i in range(len(nodes)):
            visit(i)
        skin = self.j['skins'][0]
        self.joints = skin['joints']
        self.ibm = self.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        mesh_node = next(n for n in nodes if 'mesh' in n)
        attrs = self.j['meshes'][mesh_node['mesh']]['primitives'][0]['attributes']
        self.P = np.c_[self.acc(attrs['POSITION']), np.ones(self.acc(attrs['POSITION']).shape[0])]
        self.J = self.acc(attrs['JOINTS_0']).astype(int)
        self.W = self.acc(attrs['WEIGHTS_0']).astype(float)
        if self.W.max() > 1.5:
            self.W = self.W / (255. if self.W.max() <= 255 else 65535.)

    def acc(self, i):
        a = self.j['accessors'][i]
        v = self.j['bufferViews'][a['bufferView']]
        assert 'byteStride' not in v
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        dt = np.dtype({5126: '<f4', 5125: '<u4', 5123: '<u2', 5122: '<i2', 5121: 'u1', 5120: 'i1'}[a['componentType']])
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(self.bin, dtype=dt, count=a['count'] * nc, offset=off).reshape(a['count'], nc)
        if a.get('normalized'):
            arr = np.maximum(arr / {5122: 32767., 5120: 127., 5123: 65535., 5121: 255.}[a['componentType']], -1)
        return arr

    def world(self, R, T):
        W = [None] * len(self.names)
        for i in self.order:
            m = trs(T[i], R[i], self.S[i])
            W[i] = m if self.parent[i] < 0 else W[self.parent[i]] @ m
        return W

    def worldq(self, R):
        Q = [None] * len(self.names)
        for i in self.order:
            Q[i] = R[i] if self.parent[i] < 0 else qmul(Q[self.parent[i]], R[i])
        return Q

    def skin(self, W):
        mats = np.stack([W[j] @ self.ibm[k] for k, j in enumerate(self.joints)])
        out = np.zeros((len(self.P), 3))
        for c in range(4):
            out += self.W[:, c:c + 1] * np.einsum('nij,nj->ni', mats[self.J[:, c]], self.P)[:, :3]
        return out

    def save(self, path, animations):
        """Rewrite with only referenced accessors, one bufferView each (drops the old walk data)."""
        j = self.j
        j['animations'] = animations
        refs = []

        def ref(i):
            if i not in remap:
                remap[i] = None
                refs.append(i)
            return i
        remap = {}
        for m in j['meshes']:
            for p in m['primitives']:
                for k in p['attributes']:
                    ref(p['attributes'][k])
                if 'indices' in p:
                    ref(p['indices'])
        for s in j['skins']:
            ref(s['inverseBindMatrices'])
        for a in animations:
            for s in a['samplers']:
                ref(s['input'])
                ref(s['output'])
        out, views, accs = bytearray(), [], []
        for i in refs:
            a = dict(self.new_acc[i] if i in self.new_acc else j['accessors'][i])
            raw = self.new_raw[i] if i in self.new_raw else self._raw(i)
            v_old = j['bufferViews'][j['accessors'][i]['bufferView']] if i < len(j['accessors']) else {}
            while len(out) % 4:
                out.append(0)
            view = dict(buffer=0, byteOffset=len(out), byteLength=len(raw))
            if 'target' in v_old:
                view['target'] = v_old['target']
            out += raw
            a['bufferView'] = len(views)
            a.pop('byteOffset', None)
            views.append(view)
            remap[i] = len(accs)
            accs.append(a)
        for m in j['meshes']:
            for p in m['primitives']:
                p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
                if 'indices' in p:
                    p['indices'] = remap[p['indices']]
        for s in j['skins']:
            s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
        for a in animations:
            for s in a['samplers']:
                s['input'], s['output'] = remap[s['input']], remap[s['output']]
        j['accessors'], j['bufferViews'] = accs, views
        while len(out) % 4:
            out.append(0)
        j['buffers'] = [dict(byteLength=len(out))]
        js = json.dumps(j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
        glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
        path.write_bytes(glb)

    def _raw(self, i):
        a = self.j['accessors'][i]
        v = self.j['bufferViews'][a['bufferView']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        size = {5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1}[a['componentType']] * nc * a['count']
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        return self.bin[off:off + size]

    new_acc, new_raw = {}, {}

    def add_float(self, values, kind, quantize=False):
        arr = np.ascontiguousarray(values, '<f4')
        i = 100000 + len(self.new_acc)
        a = dict(componentType=5126, count=int(arr.shape[0]), type=kind)
        if quantize:                     # unit quaternions as normalized int16, like the source clips
            arr = np.ascontiguousarray(np.round(np.clip(arr, -1, 1) * 32767), '<i2')
            a.update(componentType=5122, normalized=True)
        if kind == 'SCALAR':
            a['min'], a['max'] = [float(arr.min())], [float(arr.max())]
        self.new_acc[i], self.new_raw[i] = a, arr.tobytes()
        return i


# ---------------------------------------------------------------- gait curves (degrees vs % of cycle, 0 = heel strike)
def periodic(points, harmonics=6):
    """Least-squares Fourier fit of (phase%, value) keypoints → smooth periodic function of phase in [0, 1)."""
    ph = np.array([p for p, _ in points]) / 100.
    val = np.array([v for _, v in points], float)
    cols = [np.ones_like(ph)]
    for k in range(1, harmonics + 1):
        cols += [np.cos(2*np.pi*k*ph), np.sin(2*np.pi*k*ph)]
    coef, *_ = np.linalg.lstsq(np.stack(cols, 1), val, rcond=None)

    def f(p):
        p = np.asarray(p, float)
        out = coef[0] * np.ones_like(p)
        for k in range(1, harmonics + 1):
            out = out + coef[2*k-1] * np.cos(2*np.pi*k*p) + coef[2*k] * np.sin(2*np.pi*k*p)
        return out
    return f


# hip flexion (+) / extension (−)
HIP = periodic([(0, 29), (8, 27), (20, 15), (35, 0), (50, -13), (56, -12), (62, -4), (72, 14), (82, 28),
                (90, 32), (96, 30), (100, 29)], 5)
# knee flexion (+)
KNEE = periodic([(0, 4), (6, 10), (14, 15), (24, 10), (36, 4), (44, 5), (52, 14), (60, 34), (68, 52), (73, 56),
                 (80, 46), (88, 22), (95, 6), (100, 4)], 7)
# ankle dorsiflexion (+) / plantarflexion (−), relative to the bind foot
ANKLE = periodic([(0, 0), (5, -6), (12, -2), (25, 6), (40, 10), (48, 8), (55, 0), (62, -15), (68, -10),
                  (76, -1), (85, 3), (93, 1), (100, 0)], 7)


def leg_angles(phase):
    return HIP(phase % 1) * DEG, KNEE(phase % 1) * DEG, ANKLE(phase % 1) * DEG


AUTHORED = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r',
            'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r',
            'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r']
FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')


def upper_body(D, pelvis, torso, arm_l, arm_r, head_pitch=1 * DEG):
    """Spine / head / arms. arm_* = (shoulder flexion, elbow flexion) in radians; arms hang beside the thighs."""
    D['pelvis'] = pelvis
    D['spine_01'] = qmul(pelvis, qslerp_id(torso, .3))
    D['spine_02'] = qmul(pelvis, qslerp_id(torso, .65))
    D['spine_03'] = chest = qmul(pelvis, torso)
    level = qinv(chest)                    # cancel trunk motion so the gaze stays level and forward
    D['neck_01'] = qmul(chest, qslerp_id(chain(level, rx(-16 * DEG)), .5))
    D['head'] = qmul(chest, chain(qslerp_id(level, .85), rx(head_pitch)))
    for side, sgn, (fwd, elbow) in (('l', 1, arm_l), ('r', -1, arm_r)):
        D[f'clavicle_{side}'] = chest
        drop = rz(-sgn * 82 * DEG)          # T-pose bind → arm hanging, a few degrees off the body
        inward = ry(sgn * 10 * DEG)         # palms toward the thighs, hands slightly in front
        D[f'upperarm_{side}'] = chain(chest, rx(-fwd), inward, drop)
        D[f'lowerarm_{side}'] = D[f'hand_{side}'] = chain(chest, rx(-fwd - elbow), inward, drop)


def legs(D, pelvis, side, hip, knee, ankle, abduct=1.5 * DEG):
    sgn = 1 if side == 'l' else -1
    D[f'thigh_{side}'] = thigh = chain(pelvis, rz(sgn * abduct), rx(-hip))
    D[f'calf_{side}'] = calf = qmul(thigh, rx(knee))
    D[f'foot_{side}'] = D[f'ball_{side}'] = qmul(calf, rx(-ankle))


def walk_pose(phase):
    """Right heel strike at phase 0, left at 0.5."""
    D = {}
    swing_r = (HIP(phase % 1) - 9) / 22          # ≈ −1 (right leg back) … +1 (right leg forward)
    swing_l = (HIP((phase + .5) % 1) - 9) / 22
    yaw = 3.5 * DEG * swing_r                     # pelvis turns with the forward leg
    lst = -3.0 * DEG * np.sin(2*np.pi*phase - .35)  # swing-side hip drops in single support
    pelvis = chain(ry(yaw), rz(lst), rx(4 * DEG))
    torso = chain(ry(-yaw * 2.2), rz(-lst * .6), rx(-2 * DEG))   # thorax counter-rotates, stays upright
    arm = lambda sw: ((4 + 16 * sw) * DEG, (12 + 9 * max(sw, 0)) * DEG)   # arm swings with the opposite leg
    upper_body(D, pelvis, torso, arm(swing_r), arm(swing_l))
    legs(D, pelvis, 'r', *leg_angles(phase))
    legs(D, pelvis, 'l', *leg_angles(phase + .5))
    sway = -0.022 * np.sin(2*np.pi*phase - .5)    # pelvis drifts over the stance foot
    return D, sway


def idle_pose(phase):
    """Relaxed standing: weight mostly on the right leg, slow breathing, a gentle shift and arm drift."""
    D = {}
    a = 2*np.pi*phase
    breathe = np.sin(2*a)                          # two breaths per loop
    shift = .5 + .5 * np.sin(a)                     # 0 … 1 weight toward the left foot
    lst = (1.6 - 2.2 * shift) * DEG
    pelvis = chain(ry(1.5 * DEG * np.sin(a + 1)), rz(lst), rx(2 * DEG))
    torso = chain(rz(-lst * .7), rx((-1.5 - .8 * breathe) * DEG))
    upper_body(D, pelvis, torso, ((3 + .8 * np.sin(a + .6)) * DEG, (11 + 1.0 * breathe) * DEG),
               ((3 + .8 * np.sin(a + 2.4)) * DEG, (11 + 1.0 * breathe) * DEG), head_pitch=2 * DEG)
    legs(D, pelvis, 'r', (2 + 1.5 * shift) * DEG, (2 + 6 * shift) * DEG, (0 + 1.5 * shift) * DEG, 2 * DEG)
    legs(D, pelvis, 'l', (3.5 - 1.5 * shift) * DEG, (8 - 6 * shift) * DEG, (1.5 - 1.5 * shift) * DEG, 2 * DEG)
    sway = 0.018 * (shift - .5)
    return D, sway


def bake(g, name, pose_fn, cycle, keys, toes):
    """Pose every key, solve the pelvis height from the skinned mesh, return (animation, report)."""
    rest_q = g.worldq(g.R)               # bind world rotations (glb frame: +Y up, +Z forward, +X = character's left)
    old = next(a for a in g.j['animations'] if a['name'] == name)
    old_walk = next(a for a in g.j['animations'] if a['name'] == 'walk_src')
    blend = 1. if g.j['asset'].get('extras', {}).get('walkRig') == MARK else .55   # re-runs keep the relaxed hand
    finger_q = {}
    for c in old_walk['channels']:      # fingers: halfway between the flat bind hand and the source clip's fist
        n = g.names[c['target']['node']]
        if c['target']['path'] == 'rotation' and n.startswith(FINGERS):
            q = g.acc(old_walk['samplers'][c['sampler']]['output'])[0]
            q = q / np.linalg.norm(q)
            i = g.idx[n]
            finger_q[i] = qmul(g.R[i], qslerp_id(qmul(qinv(g.R[i]), q), blend))

    def solve(phase):
        D, sway = pose_fn(phase)
        R = [r.copy() for r in g.R]
        for i, q in finger_q.items():
            R[i] = q
        Wq = [None] * len(g.names)
        for i in g.order:
            par = g.parent[i]
            pq = Wq[par] if par >= 0 else np.array([0, 0, 0, 1.])
            if g.names[i] in D:
                R[i] = qmul(qinv(pq), qmul(D[g.names[i]], rest_q[i]))
            Wq[i] = qmul(pq, R[i])
        if toes:                         # late stance: toes stay flat while the heel rises
            for side in 'lr':
                bi = g.idx[f'ball_{side}']
                fwd = qmat(Wq[bi]) @ (qmat(qinv(rest_q[bi])) @ np.array([0, 0, 1.]))
                pitch = np.arctan2(-fwd[1], np.hypot(fwd[0], fwd[2]))      # + = toes pointing down
                ph = (phase + (0 if side == 'r' else .5)) % 1
                if .3 < ph < .66 and pitch > 0:
                    axis = np.cross(fwd, [0, -1, 0])
                    target = qmul(qaxis(axis, -pitch), Wq[bi])
                    R[bi] = qmul(qinv(Wq[g.parent[bi]]), target)
        return R, sway

    phases = np.linspace(0, 1, keys)[:-1]
    frames = []
    for ph in phases:
        R, sway = solve(ph)
        verts = g.skin(g.world(R, g.T))
        frames.append((R, sway, verts, -verts[:, 1].min()))
    lifts = np.array([f[3] for f in frames])
    A = np.stack([np.ones_like(phases)] + sum([[np.cos(2*np.pi*k*phases), np.sin(2*np.pi*k*phases)]
                                               for k in (1, 2, 3, 4)], []), 1)
    smooth = A @ np.linalg.lstsq(A, lifts, rcond=None)[0]      # smooth periodic pelvis height
    dt = cycle / (keys - 1)
    speeds = []
    for k, a in enumerate(frames):       # planted foot travel: the 40 lowest vertices, frame to frame
        b = frames[(k + 1) % len(frames)]
        low = np.argsort(a[2][:, 1])[:40]
        speeds.append(-np.median(b[2][low, 2] - a[2][low, 2]) / dt)

    pi = g.idx['pelvis']
    parent_w = g.world(g.R, g.T)[g.parent[pi]]
    rest_w = parent_w @ np.r_[g.T[pi], 1.]
    times = g.add_float(np.linspace(0, cycle, keys)[:, None], 'SCALAR')
    ends = g.add_float(np.array([[0.], [cycle]]), 'SCALAR')
    channels, samplers = [], []
    for node in sorted(set(c['target']['node'] for c in old['channels'])):
        for path in ('translation', 'rotation', 'scale'):
            if path == 'rotation':
                vals = np.array([f[0][node] for f in frames] + [frames[0][0][node]])
                for k in range(1, len(vals)):      # keep the quaternion hemisphere continuous
                    if np.dot(vals[k], vals[k-1]) < 0:
                        vals[k] = -vals[k]
                kind = 'VEC4'
            elif path == 'translation' and node == pi:
                vals = []
                for k, f in enumerate(frames):
                    w = rest_w.copy()
                    w[0] += f[1]
                    w[1] += smooth[k]
                    vals.append((np.linalg.inv(parent_w) @ w)[:3])
                vals = np.array(vals + [vals[0]])
                kind = 'VEC3'
            else:                        # constant bind translation / scale: two keys
                vals = np.repeat((g.T if path == 'translation' else g.S)[node][None], 2, 0)
                samplers.append(dict(input=ends, output=g.add_float(vals, 'VEC3'), interpolation='LINEAR'))
                channels.append(dict(sampler=len(samplers) - 1, target=dict(node=node, path=path)))
                continue
            samplers.append(dict(input=times, output=g.add_float(vals, kind, kind == 'VEC4'), interpolation='LINEAR'))
            channels.append(dict(sampler=len(samplers) - 1, target=dict(node=node, path=path)))
    report = dict(cycle=cycle, keys=keys, ground_err_cm=round(float(np.abs(smooth - lifts).max()) * 100, 2))
    if toes:
        speed = float(np.median(speeds))
        report.update(speed=round(speed, 3), stride=round(speed * cycle, 3))
    return dict(name=name, channels=channels, samplers=samplers), report


def build():
    g = Glb(GLB)
    if not any(a['name'] == 'walk_src' for a in g.j['animations']):
        src = json.loads(json.dumps(next(a for a in g.j['animations'] if a['name'] == 'walk')))
        src['name'] = 'walk_src'       # in-memory only: finger curl reference
        g.j['animations'].append(src)
    walk, walk_report = bake(g, 'walk', walk_pose, WALK_CYCLE, WALK_KEYS, True)
    idle, idle_report = bake(g, 'idle', idle_pose, IDLE_CYCLE, IDLE_KEYS, False)
    anims = [walk if a['name'] == 'walk' else idle if a['name'] == 'idle' else a
             for a in g.j['animations'] if a['name'] != 'walk_src']
    g.j['asset'].setdefault('extras', {})['walkRig'] = MARK
    g.save(GLB, anims)
    print(json.dumps(dict(walk=walk_report, idle=idle_report)))


if __name__ == '__main__':
    sys.exit(build())
