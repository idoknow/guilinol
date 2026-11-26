"""Check all three shipped GLBs, including independent vehicle and rig budgets."""
import numpy as np

from helicopter_gltf import MODELS, read_glb
from helicopter_pilot import world_frames


def check(lod):
    suffix = f'_lod{lod}' if lod else ''
    g, binary = read_glb(MODELS / f'helicopter_tour{suffix}.glb')
    nodes = {node['name']:node for node in g['nodes'] if 'name' in node}
    required = {'airframe','rotor_main','rotor_tail','rotor_blur_main','rotor_blur_tail',
                'door_L','door_R','step_L','step_R','seat_pilot','cam_pax_1','skid_contact',
                'nav_left','nav_right','nav_tail','nav_beacon'}
    for i in (1,2,3):
        required.update([f'seat_pax_{i}',f'hand_rest_pax_{i}_L',f'hand_rest_pax_{i}_R'])
    assert required <= nodes.keys(), required-nodes.keys()
    direct = {g['nodes'][i].get('name') for i in nodes['airframe']['children']}
    assert required-{'airframe'} <= direct
    def pos(name):
        return np.array(nodes[name].get('translation',[0,0,0]))
    assert abs(pos('skid_contact')[1]) < .001
    for name in required:
        if name.startswith(('seat_', 'hand_rest_', 'cam_', 'door_')):
            x,y,z = pos(name)
            assert abs(x)<1.14 and .86<y<2.55 and -1.38<z<1.51, (name,x,y,z)
    for side,sign in [('L',1),('R',-1)]:
        hinge = pos('door_'+side)
        assert hinge[0]*sign>1 and hinge[2]>pos('step_'+side)[2]
    expected = {'door_L':'seat_pax_2','door_R':'seat_pax_3',
                'door_front_L':'seat_pax_1','door_front_R':'seat_pilot'}
    assert {k:v['extras']['seats'] for k,v in nodes.items() if k.startswith('door_')} == {
        k:[v] for k,v in expected.items()}
    frames = world_frames([dict(n,name=n.get('name',f'unnamed_{i}')) for i,n in enumerate(g['nodes'])],g['scenes'][0]['nodes'][0])
    for door,seat in expected.items():
        forward=frames[seat][:3,2]
        assert np.allclose(forward/np.linalg.norm(forward),[0,0,1]),seat
        assert pos(door)[0]*pos(seat)[0]>0 and 0<pos(door)[2]-pos(seat)[2]<1.4
        # Meshopt quantization can place the geometry in a scaled child of the hinge.
        door_node = nodes[door]
        parts = [door_node]+[g['nodes'][i] for i in door_node.get('children',[])]
        meshes = [n for n in parts if 'mesh' in n]
        assert meshes,door
        for n in meshes:
            scale = n.get('scale',[1,1,1])[2]
            offset = 0 if n is door_node else n.get('translation',[0,0,0])[2]
            for primitive in g['meshes'][n['mesh']]['primitives']:
                acc=g['accessors'][primitive['attributes']['POSITION']]
                assert acc['max'][2]*scale+offset < .065,door
    for rotor,blades in [('main',4),('tail',2)]:
        frame='rotor_'+rotor
        children={g['nodes'][i].get('name') for i in nodes[frame]['children']}
        assert {f'{frame}_blade_{i+1}' for i in range(blades)} <= children
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
        assert count <= (15000 if lod==1 else 2000)
        assert 'skins' not in g and 'pilot_rig' not in nodes
    else:
        assert count >= 100000
        assert (MODELS/'helicopter_tour.glb').stat().st_size <= 6_000_000
        assert any('meshopt_compression' in ext for ext in g['extensionsUsed'])
        walker = nodes['Walker']
        assert any(n.get('skin')==0 for n in [walker]+[g['nodes'][i] for i in walker.get('children',[])])
        assert {'hand_l','hand_r','index_03_l','index_03_r'} <= nodes.keys()
        assert {a['name'] for a in g['animations']} == {'pilot_idle','pilot_startup','pilot_cruise','pilot_landing'}
        for a in g['animations']:
            assert a['channels'] and a['samplers']
    assert all(v.get('byteOffset',0)+v['byteLength'] <=len(binary) for v in g['bufferViews'])
    print(f'LOD{lod}: {count:,} triangles ({airframe:,} aircraft); attachment contract OK')


if __name__ == '__main__':
    for level in range(3):
        check(level)
