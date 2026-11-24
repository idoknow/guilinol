"""Rebuild the skin at the wrists of the shipped CC0 rig in its bind frame."""
import numpy as np
from avatar_walk import Glb, GLB


def rebuild():
    g = Glb(GLB)
    mesh = g.j['meshes'][0]['primitives'][0]
    attrs = mesh['attributes']
    source = {key: g.acc(index) for key, index in attrs.items()}
    skin = source['COLOR_0'][np.argmax(g.P[:, 0])]
    triangles = g.acc(mesh['indices']).reshape(-1, 3)
    hand = (abs(g.P[:, 0]) > .70) & np.all(source['COLOR_0'] == skin, axis=1)
    keep, indices = np.unique(triangles[~hand[triangles].any(axis=1)], return_inverse=True)
    data = {key: list(values[keep]) for key, values in source.items()}
    indices = list(indices.flatten())
    world = g.world(g.R, g.T)

    def tube(centres, bones, widths, depths, sign):
        rings = []
        profile = ([(-.78,-.82),(.58,-1),(1,.05),(.42,1),(-.86,.78)] if len(bones)==3
                   else [(-.76,-.85),(.76,-.9),(.8,.88),(-.74,.88)])
        sides = len(profile)
        for centre, bone, width, depth in zip(centres, bones, widths, depths):
            rings.append([centre + [0, y*depth, z*width] for y,z in profile])
        def triangle(corners):
            if sign < 0:
                corners = corners[::-1]
            points = [rings[i][k] for i,k in corners]
            normal = np.cross(points[1]-points[0], points[2]-points[0])
            normal /= np.linalg.norm(normal)
            for point,(i,_) in zip(points,corners):
                indices.append(len(data['POSITION']))
                data['POSITION'].append(point)
                data['NORMAL'].append(normal)
                data['COLOR_0'].append(skin)
                data['JOINTS_0'].append([g.joints.index(g.idx[bones[i]]),0,0,0])
                data['WEIGHTS_0'].append([1,0,0,0])
        for i in range(len(rings)-1):
            for k in range(sides):
                j=(k+1)%sides
                triangle([(i,k),(i,j),(i+1,k)])
                triangle([(i,j),(i+1,j),(i+1,k)])
        for k in range(1,sides-1):
            triangle([(-1,0),(-1,k),(-1,k+1)])

    for side, sign in [('l',1),('r',-1)]:
        hand = 'hand_'+side
        tube([np.array([sign*x,1.438,z]) for x,z in [(.732,-.064),(.796,-.059),(.846,-.057)]],
             [hand]*3,[.025,.042,.041],[.017,.015,.011],sign)
        for finger, radius in [('index',.0088),('middle',.0090),('ring',.0084),('pinky',.0070),('thumb',.0102)]:
            bones = [f'{finger}_0{i}_{side}' for i in range(1,4)]
            centres = [world[g.idx[n]][:3,3].copy() for n in bones+[f'{finger}_04_leaf_{side}']]
            tip_scale = 0.90 if finger == 'thumb' else 0.78
            centres[-1] = centres[-2] + (centres[-1] - centres[-2]) * tip_scale
            tube(centres,bones+[bones[-1]],np.array([1,.92,.80,.46])*radius,
                 np.array([1,.88,.74,.42])*radius,sign)
    for key, values in list(data.items())+[('indices',indices)]:
        ref = mesh['indices'] if key=='indices' else attrs[key]
        acc = dict(g.j['accessors'][ref],count=len(values))
        arr = np.asarray(values,dtype={5126:'<f4',5121:'u1',5123:'<u2',5125:'<u4'}[acc['componentType']])
        if key=='POSITION':
            acc.update(min=arr.min(0).tolist(),max=arr.max(0).tolist())
        if key=='indices':
            acc.update(min=[int(arr.min())],max=[int(arr.max())])
        g.new_acc[ref],g.new_raw[ref] = acc,arr.tobytes()
    g.save(GLB,g.j['animations'])


if __name__ == '__main__':
    rebuild()
