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


SWATCHES = dict(stone='#c1c1bc', brick='#727c86', tile='#525b65', wood='#613c32',
                red='#bd392d', yellow='#f3bd38', granite='#b7b6b3', pave='#9ca1a6',
                white='#f2ece2', glass='#7797a4', green='#71835a', gold='#d5ab54',
                leaf='#4d6a46', earth='#ba7662', clock='#3585bf', sign='#50332d')


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
        self.pigmented=[]
        self.tile_parts={key:[] for key in ('stone','brick','pave')}
        self.pose=(0,0,0,0)

    def mesh(self, vertices, faces, color, collide=False):
        triangles=np.asarray(vertices,dtype=float)[faces]
        local=triangles.copy()
        dx,dy,dz,angle=self.pose
        cosine,sine=math.cos(angle),math.sin(angle)
        triangles[:,:,0]=local[:,:,0]*cosine-local[:,:,2]*sine+dx
        triangles[:,:,2]=local[:,:,0]*sine+local[:,:,2]*cosine+dz
        triangles[:,:,1]+=dy
        if collide: self.solid.append(triangles)
        if isinstance(color,np.ndarray):
            self.pigmented.append((triangles,color[faces]));return
        normal=np.abs(np.cross(local[:,1]-local[:,0],local[:,2]-local[:,0])).argmax(axis=1)
        axes=np.array([[2,1],[0,2],[0,1]])[normal]
        coords=np.take_along_axis(local,axes[:,None,:],axis=2)
        if color in self.tile_parts:
            scale={'stone':(3.2,1.2),'brick':(1.04,.448),'pave':(3.2,1.6)}[color]
            self.tile_parts[color].append((triangles,coords/scale));return
        self.visible.append(triangles)
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

    def swept_roof(self,x,y,z,width,depth,rise):
        if not self.detail:
            self.roof(x,y,z,width,depth,rise)
            return
        perimeter=np.array([[-1,-1],[-.68,-1],[0,-1],[.68,-1],[1,-1],[1,0],[1,1],[.68,1],[0,1],[-.68,1],[-1,1],[-1,0]])
        rings=[]
        for scale,lift,upturn in ((1,-.38,.94),(1,0,.94),(.77,.27,.27),(.42,rise*.67,.06),(.07,rise,0)):
            ring=[]
            for east,south in perimeter:
                ring.append([x+east*(width*.30+(width*.20)*scale),y+lift+upturn*(abs(east*south)**4),z+south*depth*.5*scale])
            rings.append(ring)
        for level in range(4):
            for index in range(len(perimeter)):
                nxt=(index+1)%len(perimeter)
                self.mesh([rings[level][index],rings[level+1][index],rings[level+1][nxt],rings[level][nxt]],[[0,1,2],[0,2,3]],'red' if not level else 'tile')
        self.beam([x-width*.32,y+rise,z],[x+width*.32,y+rise,z],.27,'granite')
        for side in (-1,1):self.beam([x+side*width*.31,y+rise,z],[x+side*width*.34,y+rise+.67,z],.19,'tile')

    def arcade(self,x,z,width,depth,height,openings,radius,color):
        cursor=x-width/2
        for center,rad in zip(openings,np.broadcast_to(radius,(len(openings),))):
            radius=rad
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
        layer=f'lod{lod}';scene.graph.update(frame_to=layer)
        scene.add_geometry(mesh,node_name=layer+'_joinery',parent_node_name=layer)
        if model.pigmented:
            rock=packed([triangles for triangles,colors in model.pigmented]);rock.visual.vertex_colors=np.concatenate([colors for triangles,colors in model.pigmented]).reshape(-1,4)
            scene.add_geometry(rock,node_name=layer+'_rock',parent_node_name=layer)
        for key,parts in model.tile_parts.items():
            if not parts:continue
            cell=list(SWATCHES).index(key);left=128*(cell%4);top=128*(cell//4)
            texture=image.crop((left,top,left+128,top+128));surface=packed([tri for tri,uv in parts]);surface.visual=trimesh.visual.TextureVisuals(uv=np.concatenate([uv for tri,uv in parts]).reshape(-1,2),material=trimesh.visual.material.PBRMaterial(name=key,baseColorTexture=texture,metallicFactor=0,roughnessFactor=1,doubleSided=True));scene.add_geometry(surface,node_name=layer+'_'+key,parent_node_name=layer)
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
    m.box(0,-.65,16,47,.82,33,'pave',True)
    m.arcade(0,-9,40,19,6.8,[-11,0,11],[2.0,3.75,2.0],'stone')
    m.box(0,6.8,-9,40,2.25,19,'brick',True)
    for east in np.arange(-18.8,20,2.5):m.box(east,9.05,.12,1.45,1.1,.8,'brick')
    for center,radius in ((-11,2),(0,3.75),(11,2)):
        for angle in (np.arange(18)*math.pi/18 if m.detail else []):
            following=angle+math.pi/18
            verts=[[center+rad*math.cos(theta),2.176+rad*math.sin(theta),.66] for theta,rad in ((angle,radius),(angle,radius+.46),(following,radius+.46),(following,radius))];m.mesh(verts,[[0,1,2],[0,2,3]],'granite' if round(angle*18/math.pi)%2 else 'white')
        if center:
            if not m.detail:
                m.box(center,0,-.32,3.6,3,.24,'red');continue
            for column in range(8):
                offset=(column-3.5)*.49; height=2.17+math.sqrt(radius**2-offset**2)
                m.box(center+offset,0,-.32,.49,height,.24,'red',True)
                if m.detail:
                    for row in range(4):m.box(center+offset,.6+row*.65,-.17,.09,.09,.10,'gold')
    if m.detail:
        for index in range(38):
            east=math.sin(index*54.1)*19; height=5.9+(index%5)*.37
            m.mesh([[east,height,.7],[east+.35,height+.18,.74],[east+.16,height-.63,.72]],[[0,1,2]],'leaf')
    m.arcade(0,-147,27,11,8,[0],3.4,'yellow')
    m.box(0,8,-147,22,4.8,9,'red');m.swept_roof(0,8.5,-147,32,17,2.5)
    m.swept_roof(0,13,-147,26,14,3.8)
    for east in (-12,-4,4,12):
        m.beam([east,.85,-140],[east,8.5,-140],.4,'red',10,True)
        m.box(east,7.7,-140,1.4,.55,1.4,'red')
    for east in (-7,0,7):
        m.box(east,10.25,-142.3,5,2.42,.45,'wood')
        if m.detail:
            for bar in np.linspace(-2,2,7):m.box(east+bar,10.25,-141.99,.15,2.42,.18,'red')
    m.box(0,7.22,-139.8,4.3,1.15,.24,'sign')
    for east in (-1,0,1):m.box(east,7.48,-139.62,.34,.58,.12,'gold')
    for side in (-1,1):
        m.box(side*9,0,-138.4,10,.9,7,'granite',True)
        for step in range(5):m.box(side*9,0,-132.9-step*.48,7,.18*(step+1),.5,'granite',True)
        for east in (side*5.25,side*12.75):
            m.beam([east,.86,-132.7],[east,1.77,-135.15],.13,'white');m.box(east,0,-133,.33,.94,.33,'white')
        m.box(side*22,0,-147,14,4.35,10,'yellow',True);m.swept_roof(side*22,4.35,-147,16,12,2.5)
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
