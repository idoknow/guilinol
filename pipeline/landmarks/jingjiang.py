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
from shop_lettering import letters


SWATCHES = dict(stone='#c1c1bc', brick='#727c86', tile='#525b65', wood='#613c32',
                red='#bd392d', yellow='#f3bd38', granite='#b7b6b3', pave='#9ca1a6',
                white='#f2ece2', glass='#7797a4', green='#71835a', gold='#d5ab54',
                leaf='#4d6a46', earth='#ba7662', clock='#3585bf', sign='#50332d')


def atlas(colors=None,smooth=(),canopy=False):
    rng = np.random.default_rng(18)
    sheet = Image.new('RGB', (512, 512))
    for index, (key, color) in enumerate((SWATCHES | (colors or {})).items()):
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
        if key in ('wood','tile','red') and key not in smooth:
            for col in range(0,128,8 if key=='tile' else 16):
                draw.line((col,0,col,127),fill=tuple(int(v*.85) for v in panel.getpixel((1,1))))
        if canopy and key in ('leaf','green'):
            base=np.asarray(panel.getpixel((0,0)))
            for _ in range(1500):
                u,v=rng.integers(0,128,2)
                rgb=tuple(np.clip(base+rng.integers(-26,35),0,255).tolist())
                draw.ellipse((u,v,u+int(rng.integers(1,5)),v+2),fill=rgb)
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
        self.templates={}
        self.placements=[]

    def mesh(self, vertices, faces, color, collide=False):
        triangles=np.asarray(vertices,dtype=float)[faces]
        local=triangles.copy()
        dx,dy,dz,angle=self.pose
        cosine,sine=math.cos(angle),math.sin(angle)
        triangles[:,:,0]=local[:,:,0]*cosine-local[:,:,2]*sine+dx
        triangles[:,:,2]=local[:,:,0]*sine+local[:,:,2]*cosine+dz
        triangles[:,:,1]+=dy
        if getattr(self,'grade',None) is not None:
            reference=self.grade_reference
            flat=triangles.reshape(-1,3)
            weights=np.clip(1-(flat[:,1]-reference)/3.2,0,1)
            active=weights>0
            if active.any():
                offsets=np.fromiter((self.grade(x,z)-reference-.035 for x,z in flat[active][:,::2].round(4)),float)
                flat[active,1]+=weights[active]*offsets
        if collide: self.solid.append(triangles)
        if isinstance(color,np.ndarray):
            self.pigmented.append((triangles,color[faces]));return
        normal=np.abs(np.cross(local[:,1]-local[:,0],local[:,2]-local[:,0])).argmax(axis=1)
        axes=np.array([[2,1],[0,2],[0,1]])[normal]
        coords=np.take_along_axis(local,axes[:,None,:],axis=2)
        if color in self.tile_parts:
            scale={'stone':(3.2,1.2),'brick':(1.04,.448),'pave':(3.2,1.6),'ruinGlass':(1.5,1.5)}[color]
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

    def tiled_roof(self,x,y,z,width,depth,rise,material='tile',gable=True):
        """Curved tiled slopes with raised hips and a recessed gable at each end."""
        half, run = width/2, depth/2
        ridge = max(half*.32, half-run*.78)
        upper = .68 if gable else 1
        def surface(u,t,side):
            extent = half-(half-ridge)*min(t/upper,1)
            lift = (.09*rise+.12)*abs(u)**6*(1-t)**3
            return [x+u*extent,y+rise*(.55*t+.45*t*t)+lift,z+side*run*(1-t)]
        bands = [0,.22,.45,upper,1] if gable else [0,.25,.60,1]
        across = np.linspace(-1,1,13)
        for side in (-1,1):
            for a,b in zip(bands,bands[1:]):
                for u,v in zip(across,across[1:]):
                    self.mesh([surface(u,a,side),surface(v,a,side),surface(v,b,side),surface(u,b,side)],
                              [[0,1,2],[0,2,3]],material)
            if self.detail:
                # Raised half-round barrel tiles read as parallel highlights at street level.
                for u in np.linspace(-.99,.99,max(8,round(width/.42))):
                    for a,b in zip(bands,bands[1:]):
                        start,end=np.array(surface(u,a,side)),np.array(surface(u,b,side))
                        r=.075
                        verts=[p+[dx,dy,0] for p in (start,end) for dx,dy in [(-r,0),(0,r),(r,0)]]
                        self.mesh(verts,[[0,3,4],[0,4,1],[1,4,5],[1,5,2]],material)
        for end in (-1,1):
            for a,b in zip(bands,bands[1:]):
                points=[surface(end,a,-1),surface(end,a,1),surface(end,b,1),surface(end,b,-1)]
                self.mesh(points,[[0,1,2],[0,2,3]],'wood' if gable and a>=upper else material)
                for side in (-1,1):
                    self.beam(surface(end,a,side),surface(end,b,side),.13,'white' if gable else material)
        self.beam([x-ridge-.22,y+rise,z],[x+ridge+.22,y+rise,z],.20,'white' if gable else material,8)

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


def generate(name,build,colors=None):
    scene=trimesh.Scene(); image=atlas(colors or ({'tile':'#747b80'} if name=='jingjiang' else None),canopy=name=='jingjiang'); path=Path(__file__).resolve().parents[2]/'public/textures/landmarks/A'
    if not colors:
        path.mkdir(exist_ok=True,parents=True); image.save(path/'surfaces.png',optimize=True)
    mat=trimesh.visual.material.PBRMaterial(name='A_surfaces',baseColorTexture=image,roughnessFactor=1,metallicFactor=0,doubleSided=True)
    def packed(parts):
        vertices=np.concatenate(parts).reshape(-1,3);return trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
    def emit(model,layer,parent):
        mesh=packed(model.visible);mesh.visual=trimesh.visual.TextureVisuals(uv=np.concatenate(model.uv).reshape(-1,2),material=mat)
        scene.add_geometry(mesh,geom_name=layer+'_joinery',node_name=layer+'_joinery',parent_node_name=parent)
        if model.pigmented:
            rock=packed([triangles for triangles,colors in model.pigmented]);rock.visual.vertex_colors=np.concatenate([colors for triangles,colors in model.pigmented]).reshape(-1,4)
            scene.add_geometry(rock,node_name=layer+'_rock',parent_node_name=parent)
        for key,parts in model.tile_parts.items():
            if not parts:continue
            reflective=key=='ruinGlass'
            if reflective:
                texture=Image.new('RGB',(128,128),'#2c393a')
                ImageDraw.Draw(texture).rectangle((0,0,127,127),outline='#657072',width=2)
            else:
                cell=list(SWATCHES).index(key);left=128*(cell%4);top=128*(cell//4)
                texture=image.crop((left,top,left+128,top+128))
            surface=packed([tri for tri,uv in parts]);surface.visual=trimesh.visual.TextureVisuals(uv=np.concatenate([uv for tri,uv in parts]).reshape(-1,2),material=trimesh.visual.material.PBRMaterial(name=key,baseColorTexture=texture,metallicFactor=.35 if reflective else 0,roughnessFactor=.16 if reflective else 1,doubleSided=True));scene.add_geometry(surface,geom_name=layer+'_'+key,node_name=layer+'_'+key,parent_node_name=parent)
    for lod in (0,1):
        model=Model(lod==0)
        if name in ('wangcheng_market','dongxixiang'):
            from functools import lru_cache
            from world_surface import LandmarkSurface,Surface
            model.grade=lru_cache(maxsize=262144)(LandmarkSurface(Surface(),name).ground)
            model.grade_reference=0
        build(model)
        layer=f'lod{lod}';scene.graph.update(frame_to=layer)
        emit(model,layer,layer)
        groups={}
        for index,(key,matrix) in enumerate(model.placements):
            template=model.templates[key];node=f'{layer}_bay{index}'
            scene.graph.update(frame_from=layer,frame_to=node,matrix=matrix)
            if key not in groups:
                prefix=node+'_shared';emit(template,prefix,node)
                groups[key]=[part for part in scene.geometry if part.startswith(prefix+'_')]
            else:
                for part in groups[key]:scene.graph.update(frame_from=node,frame_to=node+'_'+part,geometry=part)
            if lod==0:
                for triangles in template.solid:model.solid.append(triangles@matrix[:3,:3].T+matrix[:3,3])
        if lod==0 and model.solid:scene.add_geometry(packed(model.solid),node_name='collision_surface')
    scene.export(Path(sys.argv[1])/f'{name}.glb')


def banyan(m,x,z,index):
    rng=np.random.default_rng(2400+index)
    crown=trimesh.creation.icosphere(subdivisions=1 if m.detail else 0)
    m.beam([x,0,z],[x+.45,5.5,z-.2],1.05,'wood',9,True)
    for n in range(7):
        angle=(n+rng.uniform(-.2,.2))*2*math.pi/7
        dx,dz=math.cos(angle),math.sin(angle)
        reach=rng.uniform(5.6,7.1)
        end=[x+reach*dx,rng.uniform(6.2,8.6),z+reach*dz]
        fork=[x+2.7*dx,5.6,z+2.7*dz]
        m.beam([x,3.4,z],fork,.55,'wood',7)
        m.beam(fork,end,.30,'wood',6)
        # Stagger the lobes so sky and branch silhouettes show through the crown.
        for k in range(3 if m.detail else 2):
            offset=rng.uniform([-2.3,-.7,-2.3],[2.3,1.9,2.3])
            radii=rng.uniform([2.9,1.8,2.9],[4.2,2.9,4.2])
            foliage='leaf' if (k+n)%4 else 'green'
            m.mesh(crown.vertices*radii+end+offset,crown.faces,foliage)
        if m.detail:
            for f in (.63,.82,.96):
                xx,zz=x+reach*f*dx,z+reach*f*dz
                m.beam([xx,rng.uniform(2.1,4.3),zz],[xx+.05,end[1],zz+.08],.055,'wood',4)
    m.mesh(crown.vertices*[6,3.8,6]+[x,9.2,z],crown.faces,'leaf')


def gate_furniture(m):
    for side in (-1,1):
        x=side*9.5
        m.box(x,.1,-137.2,2.45,.95,2.45,'red',True)
        for offset in (-1.08,1.08):
            for dz in (-1.08,1.08):
                m.box(x+offset,.95,-137.2+dz,.16,1.85,.16,'red',True)
        m.box(x,1.05,-137.2,2.5,.12,2.5,'wood')
        m.tiled_roof(x,2.8,-137.2,3.25,3.2,1.05)
        # The information boards are set back on either side of the kiosks.
        x=side*13.1
        m.box(x,.45,-137,5.4,2.45,.35,'wood',True)
        m.box(x,.65,-136.8,5.1,2.05,.12,'glass' if side<0 else 'white')
        for n in range(4):
            m.box(x,.88+n*.37,-136.70,3.8-n*.27,.10,.07,'red' if side<0 else 'wood')
    for x in (-2.3,-.95,1.7):
        m.box(x,0,-148.8,.24,.95,1.3,'granite')
        m.box(x,.95,-148.8,.26,.12,.42,'glass')
    m.beam([-2.8,0,-153.8],[-2.8,2.9,-153.8],.045,'wood',6)
    rim=[[-2.8+1.95*math.cos(i*math.pi/4),2.55,-153.8+1.95*math.sin(i*math.pi/4)] for i in range(8)]
    m.mesh([[-2.8,3.08,-153.8],*rim],[[0,i+1,(i+1)%8+1] for i in range(8)],'yellow')
    for n in range(8):
        m.box(-8,.15,-38-n*.94,.82,1.9,.9,'yellow',True)
        for y in (.28,1.15):
            m.box(-7.55,y,-38-n*.94,.05,.73,.79,'white')


def palace(m):
    from wangcheng_plan import PalacePlan, enclosure, inner_court
    plan = PalacePlan()
    enclosure(m, plan)
    m.box(0,-.65,16,47,.82,33,'pave',True)
    m.arcade(0,-11,40,23,6.8,[-11,0],[2.0,3.75],'stone')
    m.box(0,6.8,-11,40,2.25,23,'brick',True)
    if m.detail:
        for start in np.arange(-21.8,-.5,1.5):
            depth=1.43
            for side in (-1,1):
                m.box(side*3.72,0,start,.075,2.18,depth,'brick')
            for angle in range(0,180,15):
                end_points=[(3.70*math.cos(theta),2.176+3.70*math.sin(theta)) for theta in np.radians([angle,angle+15])]
                vertices=[[xx,yy,start+offset] for offset in (-depth/2,depth/2) for xx,yy in end_points]
                m.mesh(vertices,[[0,1,3],[0,3,2]],'brick')
    for east in np.arange(-18.8,20,2.5):m.box(east,9.05,.12,1.45,1.1,.8,'brick')
    for center,radius in ((-11,2),(0,3.75)):
        for angle in (np.arange(18)*math.pi/18 if m.detail else []):
            following=angle+math.pi/18
            verts=[[center+rad*math.cos(theta),2.176+rad*math.sin(theta),.66] for theta,rad in ((angle,radius),(angle,radius+.46),(following,radius+.46),(following,radius))];m.mesh(verts,[[0,1,2],[0,2,3]],'granite' if round(angle*18/math.pi)%2 else 'white')
    # Rock 22: paired guardian lions flank the large southern arch.
    lion = trimesh.creation.icosphere(subdivisions=int(m.detail))
    for east in (-5.0,5.0):
        m.box(east,0,1.6,1.1,.62,1.45,'granite',True)
        for dx,y,z,w,h,d in [(0,1.16,1.58,.47,.65,.52),(0,1.88,1.84,.49,.45,.44),
                               (0,1.78,2.18,.31,.22,.25),(-.28,.95,1.99,.14,.34,.17),
                               (.28,.95,1.99,.14,.34,.17),(-.31,2.14,1.68,.16,.16,.13),
                               (.31,2.14,1.68,.16,.16,.13)]:
            m.mesh(lion.vertices*[w,h,d]+[east+dx,y,z],lion.faces,'granite')
    for east in (-6.5,7.5):
        m.box(east,.48,.72,3.35,2.3,.23,'wood')
        m.box(east,.66,.86,3.05,1.96,.09,'white')
        letters(m,'靖江王城',(east,2.05,.92),2.4,.39,'wood')
        for line in range(4):m.box(east,.88+line*.24,.92,1.9+(line%2)*.47,.055,.05,'granite')
    if m.detail:
        shrub=trimesh.creation.icosphere(subdivisions=0)
        for index in range(48):
            east=-19+index*.8; height=9.0+.43*math.sin(index*.7)
            m.mesh(shrub.vertices*[.85,.53,.74]+[east,height,.21],shrub.faces,'leaf')
            if index%3!=1:m.mesh(shrub.vertices*[.42,1.05,.28]+[east,height-.91,.69],shrub.faces,'green')
    # Rock 27 and 31 show a narrow, stepped ochre tower over the through arch.
    gate_x,gate_z,gate_angle,_,_=plan.frame(1008248065)
    m.pose=(gate_x-147*math.sin(gate_angle),0,gate_z+147*math.cos(gate_angle),gate_angle)
    for south in (-155.3,-142.1):
        m.arcade(0,south,15,.8,6.3,[0],2.85,'yellow')
    for side in (-1,1):
        m.box(side*3.10,0,-148.7,.48,2.02,12.5,'yellow',True)
    for a,b in zip(np.linspace(0,math.pi,21),np.linspace(0,math.pi,21)[1:]):
        arch=[(2.85*math.cos(t),2.02+2.85*math.sin(t)) for t in (a,b)]
        soffit=[(x,y,z) for z in (-154.92,-142.48) for x,y in arch]
        m.mesh(soffit,[[0,1,3],[0,3,2]],'white',True)
    m.beam([0,4.78,-151.9],[0,4.47,-151.9],.035,'wood')
    m.beam([0,4.46,-151.9],[0,4.17,-151.9],.20,'wood',8)
    for side in (-1,1):
        m.box(side*6.8,0,-147,1.4,5.8,10,'yellow',True)
        m.box(side*5.3,4.9,-147,3.7,2.05,10,'yellow')
        m.box(side*5.5,.2,-142.0,2,6.6,1.6,'yellow')
        m.box(side*5.5,6.52,-142.0,2.4,.34,1.9,'wood')
        m.tiled_roof(side*5.3,6.95,-147,5.4,12,1.7)
        m.box(side*2.8,6.35,-141.84,1.55,2.05,.2,'wood')
        for u in (-.51,-.17,.17,.51):
            m.box(side*2.8+u,6.52,-141.70,.07,1.72,.09,'red')
        m.box(side*2.8,7.35,-141.68,1.45,.12,.09,'red')
        m.box(side*4.6,1.6,-141.25,.8,3.2,.14,'sign')
        if m.detail:
            if side>0:
                for n,char in enumerate('广西师范大学'):
                    letters(m,char,(side*4.6,4.17-n*.45,-141.14),.46,.40,'gold')
            else:
                for n in range(7):
                    m.box(side*4.6,1.9+n*.37,-141.14,.22,.07,.05,'gold')
        lantern=trimesh.creation.icosphere(subdivisions=int(m.detail))
        m.mesh(lantern.vertices*[.47,.38,.47]+[side*2.45,5.5,-140.95],lantern.faces,'red')
    m.box(0,5.35,-147,10.7,3.05,10,'yellow',True)
    m.tiled_roof(0,8.4,-147,13.0,12,3.7)
    m.box(0,5.55,-141.7,.82,1.85,.19,'sign')
    for index,char in enumerate('靖江王府'):
        letters(m,char,(0,7.03-index*.44,-141.58),.44,.44,'gold')
    for side in (-1,1):
        m.box(side*8.5,0,-138.4,11,.9,7,'granite',True)
        for step in range(5):m.box(side*8.1,0,-132.9-step*.48,9.4,.18*(step+1),.5,'granite',True)
        for east in (side*5.25,side*12.75):
            m.beam([east,.86,-132.7],[east,1.77,-135.15],.13,'white');m.box(east,0,-133,.33,.94,.33,'white')
        m.box(side*10.5,0,-147,6,3.15,10,'yellow',True);m.tiled_roof(side*10.5,3.15,-147,7.1,11.5,2.3)
    gate_furniture(m)
    m.pose=(0,0,0,0)
    for side in (-1,1):
        for i,z in enumerate((-30,-54,-78,-101,-123)):
            banyan(m,side*(13.8 if i==4 else 9.6+.6*(i%2)),z+side*1.5,i+10*(side+1))
        banyan(m,side*23,-136,37+side)
        for i,z in enumerate((-173,-214,-236)):
            banyan(m,side*25,z,i+43+side)
        banyan(m,142,-121+side*10,56+side)
    m.box(0,-.45,-123,71,.59,48,'pave',True)
    for side in (-1,1):
        lo,hi=side*18-16,side*18+16
        sand=np.array([[173,146,107,255]]*4,dtype=np.uint8)
        m.mesh([[lo,.16,-216.5],[lo,.16,-163.5],[hi,.16,-163.5],[hi,.16,-216.5]],
               [[0,1,2],[0,2,3]],sand,True)
    m.box(0,-.36,-192,4,.54,78,'pave',True)
    for i,x in enumerate((-18,-8,9,19)):
        # Front garden screening the lower part of the hall in Rock 34–35.
        crown=trimesh.creation.icosphere(subdivisions=int(m.detail))
        z=-230+(i%2)*1.1
        m.beam([x,0,z],[x,4,z],.3,'wood',7)
        for shift in (-1.5,1.5):
            m.mesh(crown.vertices*[3.5,2.9,3.3]+[x+shift,5.4,z],crown.faces,'leaf')
    m.pose=(-.54,0,-125.45,.12)
    m.box(0,0,0,2.12,.17,.78,'granite',True)
    m.box(0,.17,0,1.96,.39,.6,'yellow',True)
    letters(m,'桂林中轴线',(0,.22,.32),1.73,.27,'wood')
    for side in (-1,1):
        ring=[]
        for index in range(32):
            angle=index*2*math.pi/32;horizontal,vertical=math.cos(angle),math.sin(angle)
            ring.extend([(.87*horizontal,2.03+.87*vertical-min(0,vertical)**4*.60,side*.14),
                         (.39*horizontal,2.03+.39*vertical,side*.14)])
        faces=[]
        for index in range(32):
            first=index*2;last=(first+2)%64;faces.extend([(first,last,last+1),(first,last+1,first+1)])
        m.mesh(ring,faces,'yellow')
        if side<0:rear=ring
        else:
            for index in range(64):
                end=(index+2)%64;m.mesh([rear[index],rear[end],ring[end],ring[index]],[[0,1,2],[0,2,3]],'gold')
    m.pose=(0,0,0,0)
    m.box(0,0,-79,12,.12,135,'pave',True)
    inner_court(m, plan)
    m.box(0,6.2,-22.55,6.1,1.4,.25,'granite')
    letters(m,'三元及第',(0,6.42,-22.7),5.15,.86,'wood',facing=-1)
    if m.detail:
        for step in range(33):m.box(-24-step*.5,0,-3, .52,(33-step)*.197,3,'stone',True)


if __name__=='__main__': generate('jingjiang', palace)
