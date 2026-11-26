"""Check all three shipped GLBs, including independent vehicle and rig budgets."""
import numpy as np

from helicopter_gltf import MODELS, read_glb


def check(lod):
    suffix = f'_lod{lod}' if lod else ''
    g, binary = read_glb(MODELS / f'helicopter_tour{suffix}.glb')
    nodes = {node['name']:node for node in g['nodes']}
    required = {'airframe','rotor_main','rotor_tail','rotor_blur_main','rotor_blur_tail',
                'door_L','door_R','step_L','step_R','seat_pilot','cam_pax_1','skid_contact',
                'nav_left','nav_right','nav_tail','nav_beacon'}
    for i in (1,2,3):
        required.update([f'seat_pax_{i}',f'hand_rest_pax_{i}_L',f'hand_rest_pax_{i}_R'])
    assert required <= nodes.keys(), required-nodes.keys()
    direct = {g['nodes'][i]['name'] for i in nodes['airframe']['children']}
    assert required-{'airframe'} <= direct
    def pos(name):
        return np.array(nodes[name]['translation'])
    assert abs(pos('skid_contact')[1]) < .001
    for name in required:
        if name.startswith(('seat_', 'hand_rest_', 'cam_', 'door_')):
            x,y,z = pos(name)
            assert abs(x)<1.14 and .86<y<2.55 and -1.38<z<1.51, (name,x,y,z)
    for side,sign in [('L',1),('R',-1)]:
        hinge = pos('door_'+side)
        assert hinge[0]*sign>1 and hinge[2]>pos('step_'+side)[2]
        mesh = g['meshes'][nodes['door_'+side]['mesh']]
        for prim in mesh['primitives']:
            bounds = g['accessors'][prim['attributes']['POSITION']]
            assert bounds['min'][2]<.04 and bounds['max'][2]<.06, 'door extends beyond forward hinge'
    for rotor in ['main','tail']:
        assert np.allclose(pos('rotor_'+rotor),pos('rotor_blur_'+rotor))
    count = airframe = 0
    for n in g['nodes']:
        if 'mesh' not in n:
            continue
        for p in g['meshes'][n['mesh']]['primitives']:
            triangles = g['accessors'][p['indices']]['count']//3
            count += triangles
            if 'skin' not in n:
                airframe += triangles
    if lod:
        assert count <= (2500 if lod==1 else 400)
        assert 'skins' not in g and 'pilot_rig' not in nodes
    else:
        assert airframe >= 10000
        assert nodes['Walker']['skin']==0
        assert {'hand_l','hand_r','index_03_l','index_03_r'} <= nodes.keys()
        assert {a['name'] for a in g['animations']} == {'pilot_idle','pilot_startup','pilot_cruise','pilot_landing'}
        for a in g['animations']:
            assert a['channels'] and a['samplers']
    assert all(v.get('byteOffset',0)+v['byteLength'] <=len(binary) for v in g['bufferViews'])
    print(f'LOD{lod}: {count:,} triangles ({airframe:,} aircraft); attachment contract OK')


if __name__ == '__main__':
    for level in range(3):
        check(level)
