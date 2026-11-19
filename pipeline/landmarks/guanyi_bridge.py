"""Stone promenades flanking the original paired Jiefang West Road decks."""
import math
import numpy as np
import trimesh
from xiaoyao_tower import generate
from c_kit import landmark_surface


def monument(model, station, lateral):
    for bottom,width,height in [(0,2.1,.3),(.3,1.85,.25),(.55,1.55,1.35),(1.9,1.7,.22),(2.12,1.25,4.8),(6.92,1.55,.25),(7.17,1.8,.3),(7.47,2.0,.2)]:
        model.box(station,bottom,lateral,width,height,width,'stone',True)
    for east in (-.62,.62):
        for south in (-.62,.62):
            axis=station+east; depth=lateral+south
            segments=64 if model.detail else 16
            angles=np.linspace(0,math.tau,segments,endpoint=False)
            ring=[((.22+.018*math.cos(16*a))*math.cos(a),(.22+.018*math.cos(16*a))*math.sin(a)) for a in angles]
            verts=[(axis+x,h,depth+z) for h in (2.12,6.59) for x,z in ring]
            faces=[]
            for idx in range(segments):
                nxt=(idx+1)%segments;faces.extend([[idx,nxt,nxt+segments],[idx,nxt+segments,idx+segments]])
            model.mesh(verts,faces,'stone')
            model.box(axis,6.6,depth,.59,.32,.58,'stone')
            for hand in (-1,1):
                spiral=[(axis+hand*(.18+.13*a/6*math.cos(a)),6.7+.13*a/6*math.sin(a),depth+np.sign(south)*.3) for a in np.linspace(0,6.8,12)]
                for start,end in zip(spiral,spiral[1:]):model.beam(start,end,.035,'granite',5)
    for side in (-1,1):
        for facing in (0,math.pi/2):
            model.pose=(station,0,lateral,facing)
            outline=[(-.44,5.8),(0,5.95),(.44,5.8),(.36,5.18),(0,4.84),(-.36,5.18)]
            model.mesh([(0,5.45,side*.84)]+[(x,h,side*.68) for x,h in outline],[[0,k+1,1+(k+1)%6] for k in range(6)],'granite')
            model.box(0,.89,side*.79,.91,.54,.09,'sign')
            for x in np.arange(-.8,.81,.2):model.box(x,7.12,side*.87,.11,.16,.12,'granite')
            model.pose=(0,0,0,0)


def promenade(model,side):
    for station in range(-54,53,2):
        for row in range(4):
            model.box(station,-.06,side*(13+row*2+(0.2 if row==3 else 0)),2,.22,2.4 if row==3 else 2,'pave' if (station//2+row)%2 else 'granite',True)
        model.box(station,.16,side*20,2,1.0,.30,'white',True)
        model.box(station,1.16,side*20,2,.18,.42,'stone')
        if station%4==0:
            model.box(station,.14,side*20,.65,1.42,.65,'stone',True)
        elif model.detail:
            for shift in (-1,0,1):
                for reach in (-.48,-.26,0,.26,.48):
                    base=station+shift; z=side*19.85; tip=.99-.37*abs(reach)
                    model.mesh([(base,.42,z),(base+reach*.55-.075,.68,z),(base+reach,tip,z),(base+reach*.55+.075,.68,z),(base+reach*.55,.70,z+side*.1)],[[0,1,4],[1,2,4],[2,3,4],[3,0,4]],'granite')
    for station in (-35,0,35):
        points=[[station,0,side*17.4],[station,4.2,side*17.4],[station,5.0,side*17.1],[station,5.45,side*16.3],[station,5.50,side*15.6]]
        for start,end in zip(points,points[1:]):model.beam(start,end,.09,'tile')
        model.box(station,5.4,side*15.55,.33,.14,.62,'lamp')


def bridge(model):
    for side in (-1,1):
        promenade(model,side)
        monument(model,side*50,side*17.3)
    shrub=trimesh.creation.icosphere(subdivisions=1)
    model.mesh(shrub.vertices*[4,.95,1.8]+[59,.95,0],shrub.faces,'leaf')
    model.box(58,0,2.8,.14,4.1,.14,'granite')
    model.box(58,2.85,2.8,.11,1.0,2.4,'clock')
    model.box(60,0,4.7,.16,4.5,.16,'tile')
    model.box(60,3.9,4.7,.35,.97,.35,'tile')


if __name__=='__main__':
    surface=landmark_surface('guanyi_bridge')
    def approach_height(x,z):
        if x > 54:
            return surface.ground(x,z)
        near = surface.ground(-55,z)-.16
        far = surface.ground(53,z)-.16
        return np.interp(x,[-55,-30,0,30,53],[near,6,7.35,8.5,far])
    generate('guanyi_bridge',bridge,terrain_offset=approach_height)
