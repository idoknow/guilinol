"""The Overture roof polygon gives the gallery axis and the tiled span.
Rock 09–15 supplies the open bays, lanterns, raised pavilion and stele.
"""
import numpy as np

from xiaoyao_tower import generate


def gallery(m):
    length = 42.3
    m.box(0, -.2, 0, length, .33, 3.85, 'pave', True)
    for x in np.linspace(-20.7, 20.7, 12):
        for side in (-1, 1):
            z = side * 1.73
            m.box(x, .13, z, .36, .24, .36, 'stone')
            m.beam([x, .35, z], [x, 3.04, z], .14, 'wood', 8, True)
            if m.detail:
                m.box(x, 2.78, z, .64, .18, .36, 'red')
        m.box(x, 2.98, 0, .19, .23, 3.8, 'wood')
    for side in (-1, 1):
        m.box(0, 2.94, side*1.72, length, .28, .25, 'wood')
        m.box(0, .13, side*1.77, length-.3, .47, .26, 'wood', True)
        m.box(0, .6, side*1.72, length-.3, .13, .46, 'wood')
    # A continuous gable ridge runs parallel to the passage.
    for side in (-1, 1):
        vertices = [[x,h,z*side] for x in (-length/2,length/2)
                    for z,h in ((0,4.48),(1.4,3.52),(2.06,3.36))]
        m.mesh(vertices, [[0,1,4],[0,4,3],[1,2,5],[1,5,4]], 'tile')
    m.beam([-21.2,4.48,0],[21.2,4.48,0],.1,'granite')
    if m.detail:
        for x in np.linspace(-18.8,18.8,6):
            m.box(x,2.68,0,.08,.48,.08,'wood')
            m.beam([x,2.35,0],[x,2.68,0],.22,'red',10)
            m.box(x,2.29,0,.16,.07,.16,'gold')
    x = 25
    m.box(x,-.2,0,7.7,.33,6.8,'pave',True)
    for dx in (-2.8,2.8):
        for z in (-2.45,2.45):
            m.beam([x+dx,.13,z],[x+dx,3.65,z],.21,'wood',10,True)
    m.swept_roof(x,3.63,0,8.45,7.5,2.45)
    # Rounded crown and two-tier base leave a passage on either side.
    m.box(x,.13,1.05,1.9,.23,1.2,'stone',True)
    m.box(x,.36,1.05,1.6,.36,.92,'granite',True)
    outline = [(-.65,0),(.65,0)] + [
        (.65*np.cos(a),1.78+.65*np.sin(a)) for a in np.linspace(0,np.pi,13)]
    vertices = [[x+dx,.72+h,1.05+dz] for dz in (-.19,.19) for dx,h in outline]
    count = len(outline)
    faces = []
    for i in range(1,count-1):
        faces.extend([[0,i,i+1],[count,count+i+1,count+i]])
    for i in range(count):
        j = (i+1)%count
        faces.extend([[i,j,j+count],[i,j+count,i+count]])
    m.mesh(vertices,faces,'stone',True)


if __name__ == '__main__':
    generate('zhuangyuan_gallery', gallery, colors={'wood':'#46302b','tile':'#484a4c'})
