"""The Overture roof polygon gives the gallery axis and the tiled span.
Rock 09–15 supplies the open bays, lanterns, raised pavilion and stele.
"""
import numpy as np

from xiaoyao_roof import tiled_roof
from xiaoyao_tower import generate


from c_kit import landmark_surface

def apartments(m, x, z, length, floors):
    """Residential wings bounding the two sides of the roof in photos 08/10/14."""
    depth, storey = 9.2, 3.05
    facade = -np.sign(z)
    m.foundation(landmark_surface('zhuangyuan_gallery'),x,-.65,z,length,4,depth,'granite')
    top = 3.35+(floors-1)*storey
    m.box(x,3.35,z,length-.8,top-3.35,depth-.55,'white',True)
    m.box(x,top,z,length+.3,.28,depth+.22,'granite')
    m.box(x+length*.22,top+.28,z,5.6,1.75,3.8,'white')
    m.box(x+length*.22,top+2.03,z,6.0,.21,4.2,'tile')
    for level in range(1,floors):
        base = 3.35+(level-1)*storey
        for bay,px in enumerate(np.linspace(x-length*.42,x+length*.42,9)):
            face=z+facade*depth*.47
            if bay%3==0:
                m.box(px,base,face+facade*.5,3.5,.22,1.65,'granite')
                m.box(px,base+.22,face+facade*1.25,3.25,.73,.14,'white')

            m.box(px,base+.98,face+facade*.09,2.72,1.52,.18,'glass')
            if m.detail:
                m.box(px,base+.98,face+facade*.20,.09,1.52,.08,'white')
    for end in (-1,1):
        for level in range(floors):
            m.box(x+end*(length/2-.31),level*storey+1.1,z, .29,1.48,3.3,'glass')


def gallery(m):
    apartments(m,-1.4,15.1,49,7)
    apartments(m,-3.6,-15.0,40,6)
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
        vertices = [[x,h,z*side] for x in (-18.95,18.95)
                    for z,h in ((0,4.48),(1.4,3.52),(2.06,3.36))]
        faces=[[0,1,4],[0,4,3],[1,2,5],[1,5,4]]
        m.mesh(vertices,faces,'tile')
        # Pale underside boards follow the two roof pitches behind the rafters.
        m.mesh(np.array(vertices)-[0,.085,0],faces,'white')
    m.beam([-18.95,4.48,0],[18.95,4.48,0],.1,'granite')
    if m.detail:
        m.box(0,3.10,0,38.2,.18,.22,'wood')
        for side in (-1,1):
            m.box(0,2.85,side*1.48,38.2,.23,.22,'wood')
        for x in np.linspace(-18.8,18.8,6):
            m.box(x,2.68,0,.08,.48,.08,'wood')
            m.beam([x,2.35,0],[x,2.68,0],.22,'red',10)
            m.box(x,2.29,0,.16,.07,.16,'gold')
        for x in np.linspace(-19.5,19.5,42):
            for side in (-1,1):
                m.beam([x,4.34,0],[x,3.40,side*1.4],.064,'wood',6)
                m.beam([x,3.40,side*1.4],[x,3.23,side*2.0],.064,'wood',6)
        for x in np.linspace(-18.8,18.8,10):
            for side in (-1,1):
                z=side*1.48
                m.beam([x,2.43,z],[x,2.86,z],.12,'red',10)
                m.box(x,2.34,z,.06,.1,.06,'gold')
                for offset in (-.75,-.25,.25,.75):
                    m.box(x+offset,.7,z,.055,.50,.065,'wood')
                m.box(x,.73+.48,z,3.9,.08,.10,'wood')
    for end in (-1,1):
        tiled_roof(m,end*18.95,3.39,0,4.4,4.35,1.18,.38,.75,gable_material='tile')
        m.box(end*20.70,3.06,0,.24,.23,3.85,'red')
    # The photograph back toward the gallery looks across a low planted bed.
    m.box(25,-.16,-.9,9,.29,7.1,'pave',True)
    m.pose=(1.8,0,-2.8,0)
    x = 25
    for sign in (-1,1):
        z=sign*4.05
        m.box(x,.01,z,6.2,.44,1.2,'granite',True)
        m.box(x,.45,z,6.1,.53,1.16,'leaf',True)
        if m.detail:
            for k in range(9):
                m.box(x-2.72+k*.68,.92,z,.7,.07+.07*(k%3),1.0,'leaf')
    m.box(x,-.2,0,7.7,.33,6.8,'pave',True)
    for dx in (-2.8,2.8):
        for z in (-2.45,2.45):
            m.beam([x+dx,.13,z],[x+dx,3.65,z],.21,'wood',10,True)
    tiled_roof(m,x,3.63,0,8.45,7.5,3.25,2.15,.55)
    # Rounded crown and two-tier base leave a passage on either side.
    m.box(x,.13,1.05,1.9,.23,1.2,'stone',True)
    m.box(x,.36,1.05,1.6,.36,.92,'granite',True)
    # Rock 15 shows the turtle stele bearer projecting beyond the slab.
    if m.detail:
        import trimesh
        for center, scale in [((x,.64,1.0),(.86,.45,.92)),((x,.73,.10),(.30,.25,.44))]:
            shell = trimesh.creation.icosphere(subdivisions=2)
            m.mesh(shell.vertices*np.array(scale)+center,shell.faces,'granite')
        for dx in (-1.1,1.1):
            for z in (-.72,2.15):
                m.beam([x+dx,.13,z],[x+dx,1.05,z],.034,'granite')
            m.beam([x+dx,1.05,-.72],[x+dx,1.05,2.15],.033,'granite')
        m.beam([x-1.1,1.05,-.72],[x+1.1,1.05,-.72],.033,'granite')
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
    m.mesh([[x+.48,.85,.854],[x-.48,.85,.854],[x-.48,2.65,.854],[x+.48,2.65,.854]],
           [[0,1,2],[0,2,3]],'clock')


if __name__ == '__main__':
    generate('zhuangyuan_gallery', gallery, colors={'wood':'#312c30','tile':'#333943','white':'#dedfe1','pave':'#373a3b'},
             lettering=dict(text='逍遙樓',foreground='#93928b',background='#b7b6ae',vertical=True))
