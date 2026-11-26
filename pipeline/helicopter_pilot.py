"""Reuse the shipped skinned walker, drive pose, and articulated fingers."""
from copy import deepcopy

import numpy as np
from scipy.spatial.transform import Rotation as R

from helicopter_gltf import ROOT, read_glb


def drive_pose():
    g, binary = read_glb(ROOT / 'public/avatar/figure.glb')
    nodes = g['nodes']
    drive = next(a for a in g['animations'] if a['name'] == 'drive')
    for channel in drive['channels']:
        target = channel['target']
        a = g['accessors'][drive['samplers'][channel['sampler']]['output']]
        offset = g['bufferViews'][a['bufferView']]['byteOffset'] + a.get('byteOffset', 0)
        size = 4 if target['path'] == 'rotation' else 3
        dtype = {5126:'<f4', 5122:'<i2'}[a['componentType']]
        value = np.frombuffer(binary, dtype, size, offset).astype(float)
        if a.get('normalized'):
            value /= 32767
        nodes[target['node']][target['path']] = value.tolist()
    return g, binary


def world_frames(nodes, root):
    frames = {}
    def walk(i, parent):
        node = nodes[i]
        m = np.eye(4)
        m[:3,:3] = R.from_quat(node.get('rotation', [0,0,0,1])).as_matrix() * node.get('scale', [1]*3)
        m[:3,3] = node.get('translation', [0]*3)
        frames[node['name']] = parent @ m
        for child in node.get('children', []):
            walk(child, frames[node['name']])
    walk(root, np.eye(4))
    return frames


def pilot(aircraft, seat):
    g, binary = drive_pose()
    nodes = g['nodes']
    root = g['scenes'][0]['nodes'][0]
    frames = world_frames(nodes, root)
    # Derive forward from seated knees so the asset's authored root yaw is respected.
    forward = (frames['calf_r'][:3,3]+frames['calf_l'][:3,3])/2 - frames['pelvis'][:3,3]
    yaw = R.from_euler('y', -np.arctan2(forward[0], forward[2]))
    pivot = aircraft.node('pilot_rig', np.array(seat)-yaw.apply(frames['pelvis'][:3,3]))
    aircraft.g['nodes'][pivot]['rotation'] = yaw.as_quat().tolist()
    base = len(aircraft.g['nodes'])
    aircraft.g['nodes'][pivot]['children'] = [root+base]
    acc_map = {}
    def copy_acc(idx):
        if idx not in acc_map:
            record = deepcopy(g['accessors'][idx])
            view = g['bufferViews'][record['bufferView']]
            offset = view.get('byteOffset', 0)
            record['bufferView'] = aircraft.view(binary[offset:offset+view['byteLength']])
            if 'byteStride' in view:
                aircraft.g['bufferViews'][-1]['byteStride'] = view['byteStride']
            acc_map[idx] = len(aircraft.g['accessors'])
            aircraft.g['accessors'].append(record)
        return acc_map[idx]
    mesh_offset = len(aircraft.g['meshes'])
    mat_offset = len(aircraft.g['materials'])
    aircraft.g['materials'].extend(g['materials'])
    for mesh in g['meshes']:
        for p in mesh['primitives']:
            p['attributes'] = {k:copy_acc(v) for k,v in p['attributes'].items()}
            p['indices'] = copy_acc(p['indices'])
            p['material'] += mat_offset
        aircraft.g['meshes'].append(mesh)
    for skin in g['skins']:
        skin['joints'] = [i+base for i in skin['joints']]
        if 'skeleton' in skin:
            skin['skeleton'] += base
        skin['inverseBindMatrices'] = copy_acc(skin['inverseBindMatrices'])
    aircraft.g['skins'] = g['skins']
    # Solve the two arm joints in the drive pose for the startup switch. Store
    # the reached fingertip in aircraft space to place the matching console.
    reach_nodes = deepcopy(nodes)
    ids = {n['name']:i for i,n in enumerate(nodes)}
    finger = 'index_04_leaf_r'
    goal = frames[finger][:3,3] + yaw.inv().apply([-.045,.10,.17])
    for _ in range(12):
        for joint in ('lowerarm_r','upperarm_r'):
            fk = world_frames(reach_nodes,root)
            local = R.from_quat(reach_nodes[ids[joint]]['rotation'])
            world = R.from_matrix(fk[joint][:3,:3])
            parent = world * local.inv()
            pivot_pos = fk[joint][:3,3]
            move, _ = R.align_vectors([goal-pivot_pos], [fk[finger][:3,3]-pivot_pos])
            reach_nodes[ids[joint]]['rotation'] = (parent.inv()*move*world).as_quat().tolist()
    switch = world_frames(reach_nodes,root)[finger][:3,3]
    for n in nodes:
        if 'children' in n:
            n['children'] = [i+base for i in n['children']]
        if 'mesh' in n:
            n['mesh'] += mesh_offset
    aircraft.g['nodes'].extend(nodes)
    aircraft.g['animations'] = []
    poses = dict(idle=(4, dict(head=(0,4,0), spine_02=(1,0,0))),
                 startup=(3, dict(upperarm_r=(0,0,0), lowerarm_r=(0,0,0), head=(6,0,0))),
                 cruise=(3.6, dict(lowerarm_r=(2,0,0), lowerarm_l=(-2,0,0), head=(0,3,0))),
                 landing=(3, dict(upperarm_l=(0,0,8), lowerarm_l=(6,0,0), head=(5,0,0))))
    for name, (duration, joints) in poses.items():
        time = aircraft.array([0, duration*.45, duration*.65, duration], 'SCALAR')
        channels, samplers = [], []
        for joint, angles in joints.items():
            i = next(i for i,n in enumerate(nodes) if n['name'] == joint)
            rest = R.from_quat(nodes[i]['rotation'])
            reach = rest * R.from_euler('xyz', angles, degrees=True)
            if name == 'startup' and joint in ('upperarm_r','lowerarm_r'):
                reach = R.from_quat(reach_nodes[i]['rotation'])
            values = [rest.as_quat(), reach.as_quat(), reach.as_quat(), rest.as_quat()]
            channels.append(dict(sampler=len(samplers), target=dict(node=base+i, path='rotation')))
            samplers.append(dict(input=time, output=aircraft.array(values,'VEC4'), interpolation='LINEAR'))
        aircraft.g['animations'].append(dict(name='pilot_'+name, channels=channels, samplers=samplers))
    targets = {k:np.array(seat)+yaw.apply(frames[k][:3,3]-frames['pelvis'][:3,3])
            for k in ('hand_l','hand_r','foot_l','foot_r','head')}
    targets['switch'] = np.array(seat)+yaw.apply(switch-frames['pelvis'][:3,3])
    return targets
