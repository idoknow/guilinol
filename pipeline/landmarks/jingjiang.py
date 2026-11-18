"""OSM 258909996 enclosure (~325 x 548 m); gate footprints 1008248059,
1008248065, hall 679734442. Estimated heights against ~1.7 m visitors in
2018 Commons references: curtain 6.5 m, gateway 9 m, hall plinth 2 m.
Atlas hues approximate the limestone, ochre render and cinnabar in those views.
"""
from pathlib import Path
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
import trimesh


SWATCHES = dict(stone='#99998c', brick='#687073', tile='#555c5f', wood='#674a3c',
                red='#9d4636', yellow='#d9ae60', granite='#b4ada1', pave='#9b9d95',
                white='#e3decc', glass='#46595a', green='#71835a', gold='#bb9859',
                leaf='#4d6a46', earth='#ae795f', clock='#f1e5c9', sign='#5a3931')


def atlas():
    rng = np.random.default_rng(18)
    sheet = Image.new('RGB', (512, 512))
    for index, (key, color) in enumerate(SWATCHES.items()):
        panel = Image.new('RGB', (128,128), color)
        draw = ImageDraw.Draw(panel)
        if key in ('stone','brick','pave'):
            height = 16 if key == 'brick' else 32
            width = height*2
            for row in range(128//height):
                draw.line((0,row*height,127,row*height), fill='#b6b4a5')
                for col in range(-1,5):
                    left = col*width+(row%2)*width//2
                    draw.line((left,row*height,left,(row+1)*height), fill='#b6b4a5')
                    shade = rng.integers(-9,10)
                    rgb = tuple(int(v+shade) for v in Image.new('RGB',(1,1),color).getpixel((0,0)))
                    draw.rectangle((left+1,row*height+1,left+width-1,(row+1)*height-1),fill=rgb)
        if key in ('wood','tile','red'):
            for col in range(0,128,8 if key=='tile' else 16):
                draw.line((col,0,col,127),fill=tuple(int(v*.85) for v in panel.getpixel((1,1))))
        if key=='clock':
            draw.ellipse((3,3,124,124),outline='#715d48',width=5)
            for tick in range(12):
                angle=tick*math.pi/6
                draw.line(tuple(coord for r in (45,51) for coord in (64+r*math.sin(angle),64-r*math.cos(angle))), fill='#4b453e',width=3)
            draw.line((42,48,64,64,88,36),fill='#453e36',width=5)
        pixels=np.asarray(panel).astype(float)+rng.normal(0,2,(128,128,1))
        sheet.paste(Image.fromarray(np.uint8(np.clip(pixels,0,255))),((index%4)*128,(index//4)*128))
    return sheet


class Model:
    def __init__(self, detail):
        self.detail=detail
        self.visible=[]
        self.uv=[]
        self.solid=[]
        self.pose=(0,0,0,0)

    def mesh(self, vertices, faces, color, collide=False):
        triangles=np.asarray(vertices,dtype=float)[faces]
        local=triangles.copy()
        dx,dy,dz,angle=self.pose
        cosine,sine=math.cos(angle),math.sin(angle)
        triangles[:,:,0]=local[:,:,0]*cosine-local[:,:,2]*sine+dx
        triangles[:,:,2]=local[:,:,0]*sine+local[:,:,2]*cosine+dz
        triangles[:,:,1]+=dy
        self.visible.append(triangles)
        if collide: self.solid.append(triangles)
        normal=np.abs(np.cross(local[:,1]-local[:,0],local[:,2]-local[:,0])).argmax(axis=1)
        axes=np.array([[2,1],[0,2],[0,1]])[normal]
        coords=np.take_along_axis(local,axes[:,None,:],axis=2)
        coords=(coords-coords.min(axis=1,keepdims=True))/np.maximum(coords.max(axis=1,keepdims=True)-coords.min(axis=1,keepdims=True),1e-6)
        cell=list(SWATCHES).index(color)
        self.uv.append((coords*.94+.03+[cell%4,3-cell//4])/4)

    def box(self,x,y,z,w,h,d,color,collide=False):
        cube=trimesh.creation.box([w,h,d]); self.mesh(cube.vertices+[x,y+h/2,z],cube.faces,color,collide)

    def beam(self,start,end,r,color,sections=6,collide=False):
        shape=trimesh.creation.cylinder(radius=r,sections=sections,segment=[start,end]);self.mesh(shape.vertices,shape.faces,color,collide)

    def roof(self,x,y,z,w,d,h):
        for layer in range(2 if self.detail else 1):
            shift=layer*.25
            points=np.array([[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[-w*.27,h,0],[w*.27,h,0]])+[x,y+shift,z]
            self.mesh(points,[[0,4,5],[0,5,1],[1,5,2],[2,5,4],[2,4,3],[3,4,0]],'tile')
            w*=.96;d*=.96
        if self.detail:self.beam([x-w*.29,y+h+.2,z],[x+w*.29,y+h+.2,z],.21,'granite')

    def arcade(self,x,z,width,depth,height,openings,radius,color):
        cursor=x-width/2
        for center in openings:
            left=center-radius
            self.box((cursor+left)/2,0,z,left-cursor,height,depth,color,True)
            spring=height*.32
            for angle1,angle2 in zip(np.linspace(0,math.pi,13)[:-1],np.linspace(0,math.pi,13)[1:]):
                a,b=center+radius*math.cos(angle1),center+radius*math.cos(angle2)
                low,high=spring+radius*math.sin(angle1),spring+radius*math.sin(angle2)
                verts=[(px,py,z+side*depth/2) for side in (-1,1) for px,py in ((a,low),(b,high),(b,height),(a,height))]
                self.mesh(verts,[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[3,2,6],[3,6,7]],color,True)
            cursor=center+radius
        self.box((cursor+x+width/2)/2,0,z,x+width/2-cursor,height,depth,color,True)


def generate(name,build):
    scene=trimesh.Scene(); image=atlas(); path=Path(__file__).resolve().parents[2]/'public/textures/landmarks/A'
    path.mkdir(exist_ok=True,parents=True); image.save(path/'surfaces.png',optimize=True)
    mat=trimesh.visual.material.PBRMaterial(name='A_surfaces',baseColorTexture=image,roughnessFactor=1,metallicFactor=0,doubleSided=True)
    for lod in (0,1):
        model=Model(lod==0);build(model)
        def packed(parts):
            vertices=np.concatenate(parts).reshape(-1,3);return trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
        mesh=packed(model.visible);mesh.visual=trimesh.visual.TextureVisuals(uv=np.concatenate(model.uv).reshape(-1,2),material=mat)
        scene.add_geometry(mesh,node_name=f'lod{lod}')
        if lod==0 and model.solid:scene.add_geometry(packed(model.solid),node_name='collision_surface')
    scene.export(Path(sys.argv[1])/f'{name}.glb')


def palace(m):
    # Positive local z is south, along the enclosure axis, bearing ~188.4°.
    for side in (-1,1):
        m.box(side*162,-1,-274,4,7.5,548,'stone',True)
        m.box(side*91,-1,0,142,7.5,4,'stone',True)
    m.box(0,-1,-548,324,7.5,4,'stone',True)
    if m.detail:
        for side in (-1,1):
            for zz in range(0,548,5):m.box(side*163,6.5,-zz,1,1.1,2.7,'stone')
            for xx in range(-160,161,5):
                if side<0 or abs(xx)>20:m.box(xx,6.5,0 if side>0 else -548,2.7,1.1,1,'stone')
    m.arcade(0,-9,40,19,9,[-11,0,11],3.1,'stone')
    m.arcade(0,-147,27,11,8,[0],3.4,'yellow')
    m.box(0,8,-147,24,2.6,10,'red');m.roof(0,9,-147,31,16,3.2)
    m.box(0,11,-147,18,2.5,7,'yellow');m.roof(0,13,-147,24,12,3.6)
    for zz in (-65,-108):
        for side in (-1,1):m.box(side*20,0,zz,25,.12,39,'green')
    m.box(0,0,-79,12,.12,135,'pave',True)
    m.box(0,0,-252,52,2,29,'granite',True)
    for step in range(10):m.box(0,0,-232-step*.52,12,(step+1)*.20,.55,'granite',True)
    for xx,zz,width in ((0,-252,42),(-49,-202,23),(49,-202,23)):
        base=2 if not xx else 0
        m.box(xx,base,zz,width-4,6,13,'yellow',True);m.roof(xx,base+6,zz,width+5,21,4)
        for col in np.linspace(xx-width/2,xx+width/2,9 if m.detail else 3):
            m.beam([col,base,zz+8],[col,base+6,zz+8],.35,'red')
            if m.detail:m.box(col,base+5.3,zz+8,1.3,.5,1.3,'wood')
    if m.detail:
        for side in (-1,1):
            for xx in np.arange(8,26,1.8):m.box(side*xx,2,-238,.32,1.25,.32,'white')
            m.box(side*17,3,-238,18,.22,.36,'white')
        for step in range(33):m.box(-24-step*.5,0,-3, .52,(33-step)*.197,3,'stone',True)


if __name__=='__main__': generate('jingjiang', palace)
