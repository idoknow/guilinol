"""Rebuild the project's original CC0 jointed placeholder; no third-party assets."""
import json
import math
import struct
from pathlib import Path

import numpy as np

binary = bytearray()
views, accessors, nodes, animations = [], [], [], []


def attribute(values, kind):
    array = np.asarray(values, '<f4')
    views.append(dict(buffer=0, byteOffset=len(binary), byteLength=array.nbytes))
    binary.extend(array.tobytes())
    accessors.append(dict(bufferView=len(views)-1, componentType=5126, count=len(array),
                          type=kind, min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist()))
    return len(accessors)-1


vertices, normals = [], []
for axis in range(3):
    for sign in [-1, 1]:
        normal = np.eye(3)[axis]*sign
        right = np.eye(3)[(axis+1)%3]
        up = np.cross(normal,right)
        for horizontal, vertical in [(-1,-1),(1,-1),(1,1),(-1,-1),(1,1),(-1,1)]:
            vertices.append((normal+horizontal*right+vertical*up)/2)
            normals.append(normal)
mesh = dict(primitives=[dict(attributes=dict(POSITION=attribute(vertices,'VEC3'),NORMAL=attribute(normals,'VEC3')))])
nodes.append(dict(name='Figure',children=[]))
limbs = []
for name, pivot, size, offset in [
    ('Chest',[0,.78,0],[.42,.58,.23],.29),('Head',[0,1.36,0],[.29,.32,.27],.16),
    ('LegL',[-.115,.8,0],[.19,.8,.22],-.4),('LegR',[.115,.8,0],[.19,.8,.22],-.4),
    ('ArmL',[-.28,1.31,0],[.14,.59,.16],-.29),('ArmR',[.28,1.31,0],[.14,.59,.16],-.29)]:
    idx = len(nodes)
    nodes[0]['children'].append(idx)
    nodes.extend([dict(name=name,translation=pivot,children=[idx+1]),dict(mesh=0,translation=[0,offset,0],scale=size)])
    if idx>=5:
        limbs.append(idx)
for name,duration,amplitude in [('idle',2,.035),('walk',.9,.44),('run',.56,.86),('jump',.7,.72)]:
    times = attribute([[duration*at/4] for at in range(5)],'SCALAR')
    samplers, channels = [], []
    for at,joint in enumerate(limbs):
        angles = [amplitude*(1 if at in [0,3] else -1)*math.sin(key*math.pi/2) for key in range(5)]
        if name=='jump':
            angles = [amplitude*(1 if at<2 else -1)*math.sin(key*math.pi/4) for key in range(5)]
        rot = attribute([[math.sin(angle/2),0,0,math.cos(angle/2)] for angle in angles],'VEC4')
        channels.append(dict(sampler=at,target=dict(node=joint,path='rotation')))
        samplers.append(dict(input=times,output=rot))
    animations.append(dict(name=name,samplers=samplers,channels=channels))
doc = dict(asset=dict(version='2.0',copyright='CC0-1.0'),scene=0,scenes=[dict(nodes=[0])],nodes=nodes,meshes=[mesh],
           animations=animations,accessors=accessors,bufferViews=views,buffers=[dict(byteLength=len(binary))])
text = json.dumps(doc,separators=(',',':')).encode()
text += b' '*(-len(text)%4)
target = Path(__file__).resolve().parents[1]/'public/avatar/figure.glb'
target.parent.mkdir(exist_ok=True,parents=True)
target.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(text)+len(binary))+struct.pack('<I4s',len(text),b'JSON')+text+
                   struct.pack('<I4s',len(binary),b'BIN\0')+binary)
