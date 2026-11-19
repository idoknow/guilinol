"""Xinhua (新华社), 2016-04-01,《逍遥楼重现桂林漓江边》: two floors,
three eaves, ~22 m square and ~24 m high. OSM way/702352884 gives the
footprint and the NNE axis (~17 degrees east of north). The floor and sill
heights are estimates, not survey data. Roof slate, dark red timber and
pale grey paving follow the daylight 2025 views in landmark-refs.json.
"""
from pathlib import Path
import sys

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

from xiaoyao_roof import tiled_roof
from jingjiang import Model, SWATCHES, atlas


class LandmarkModel(Model):
    def __init__(self, detail, flood_roof=False):
        super().__init__(detail)
        self.lamps=[]
        self.lit_tiles=[]
        self.flood_roof=flood_roof

    def mesh(self, vertices, faces, color, collide=False):
        if isinstance(color,str) and color=='lamp':
            super().mesh(vertices,faces,'wood' if self.flood_roof else 'gold',collide)
            self.lamps.append((self.visible.pop(),self.uv.pop()))
        elif self.flood_roof and isinstance(color,str) and color=='tile':
            super().mesh(vertices,faces,color,collide)
            self.lit_tiles.append((self.visible.pop(),self.uv.pop()))
        else:
            super().mesh(vertices,faces,color,collide)


def inscription(image, text, foreground, background, vertical=False):
    # Reuse the unused clock cell so lettering stays in the joinery draw call.
    index=list(SWATCHES).index('clock')
    x,y=index%4*128,index//4*128
    face=ImageDraw.Draw(image)
    face.rectangle((x,y,x+127,y+127),fill=background)
    face.rectangle((x+6,y+6,x+121,y+121),outline=foreground,width=2)
    try:
        font=ImageFont.truetype('NotoSansCJK-Regular.ttc',32)
    except OSError:
        font=ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc',32)
    if vertical:
        for row,letter in enumerate(text):
            face.text((x+64,y+26+row*37),letter,font=font,anchor='mm',fill=foreground)
    else:
        # Paint at the plaque aspect ratio before packing into the square atlas cell.
        panel=Image.new('RGB',(480,112),background)
        brush=ImageDraw.Draw(panel)
        brush.rectangle((6,5,473,106),outline=foreground,width=3)
        brush.text((240,55),text,font=font.font_variant(size=87),anchor='mm',fill=foreground)
        image.paste(panel.resize((128,128),Image.Resampling.LANCZOS),(x,y))


def carve_medallion(image):
    index=list(SWATCHES).index('leaf')
    panel=Image.new('RGB',(128,128),'#eef0fa')
    brush=ImageDraw.Draw(panel)
    for inset in (7,12):
        brush.ellipse((inset,inset,127-inset,127-inset),outline='#c6cbd5',width=2)
    for angle in np.linspace(0,2*np.pi,8,endpoint=False):
        outline=[]
        for t in np.linspace(0,2*np.pi,30):
            r=20+12*np.cos(t)
            outline.append((64+r*np.cos(angle)-7*np.sin(t)*np.sin(angle),
                            64+r*np.sin(angle)+7*np.sin(t)*np.cos(angle)))
        brush.line(outline,fill='#c9ced8',width=2)
    brush.ellipse((57,57,71,71),outline='#bcc3cd',width=2)
    image.paste(panel,((index%4)*128,(index//4)*128))


def facade(model, base, half, height, upstairs):
    for side in range(4):
        model.pose = (0, 0, 0, side * np.pi / 2)
        for bay in range(-2, 3):
            east = bay * half / 2.5
            width = half / 2.5
            post = east - width / 2
            model.beam([post, base, half], [post, base+height, half], .24, 'red', 10 if model.detail else 4, True)
            if bay or upstairs:
                if model.detail:
                    model.box(east, base, half-1.4, width-.14, 1.05, .18, 'wood', True)
                    model.box(east, base+1.05, half-1.55, width-.14, height-1.35, .12, 'sign', True)
                else:
                    model.box(east, base, half-1.4, width-.14, height-.3, .18, 'wood')
                if model.detail:
                    for offset in np.linspace(-width*.43, width*.43, 7):
                        model.box(east+offset, base+1.05, half-1.3, .07, height-1.35, .075, 'wood')
                    for lift in np.arange(1.35, height-.3, .65):
                        model.box(east, base+lift, half-1.3, width-.14, .07, .075, 'wood')
            if model.detail:
                for tier in range(3):
                    model.box(post, base+height-.6+tier*.19, half, .45+tier*.33, .19, .55+tier*.41, 'wood')
            if upstairs:
                model.box(east, base+.94, half+.82, width+.04, .14, .14, 'wood', True)
                for offset in ([-.4,-.2,0,.2,.4] if model.detail else [0]):
                    model.box(east+offset*width, base, half+.82, .11, .94, .11, 'wood')
        model.box(0, base+height-.3, half, half*2+.5, .48, .52, 'wood')
    model.pose = (0,0,0,0)


def steps(m, start, end, x, z, dx, dz, count, width):
    for index in range(count):
        distance = index + .5
        top = start + (end-start)*(index+1)/count
        m.box(x+distance*dx, start-.12, z+distance*dz,
              abs(dx) or width, top-start+.12, abs(dz) or width, 'pave', True)


def white_rail(m, x, z, dx, dz, bays, base):
    for k in range(bays+1):
        px,pz = x+k*dx,z+k*dz
        m.box(px,base,pz,.24,1.12,.24,'white',True)
        m.box(px,base+1.12,pz,.3,.13,.3,'white')
        if k < bays:
            for y,h in ((.28,.12),(.84,.16)):
                m.box(px+dx/2,base+y,pz+dz/2,abs(dx) or .16,h,abs(dz) or .16,'white',True)
            if m.detail:
                m.box(px+dx/2,base+.4,pz+dz/2,abs(dx)*.46 or .11,.44,abs(dz)*.46 or .11,'white')


def tower(model):
    court, platform = 8.4, 9.84
    model.box(0,-.36,-8,34,court+.36,48,'stone',True)
    model.box(0,court-.16,-8,34,.16,48,'pave',True)
    # From the gallery pavilion, ascend east to the open northern court.
    # Two flights turn south at a level landing outside the west curtain.
    steps(model,0,2.8,-27.08,-21,.38,0,16,4.2)
    model.box(-19,0,-21,4,2.8,4.2,'stone',True)
    steps(model,2.8,court,-19,-18.9,0,.38,32,4)
    model.box(-19,0,-5.24,4,court,3,'stone',True)
    model.box(0,court-.55,-8,34.16,.24,48.16,'granite')
    # Riverside stair follows the eastern face, ending on an upper landing.
    steps(model,0,court,18.68,15.08,0,-.42,48,3.36)
    model.box(18.68,-.25,-7.06,3.36,court+.25,4,'stone',True)
    for z in np.arange(-30,15,2.15):
        if -10 < z < -5:
            continue
        model.box(16.7,court,z,.6,.88,2.15,'brick',True)
        model.box(16.7,court+.88,z,.62,.38,1.04,'brick')
    # Shallow recessed panels and stone door surround on the riverside wall (30–34).
    for z in (-18,6):
        model.box(17.01,.68,z,.12,2.32,6.6,'granite')
        model.box(17.09,.82,z,.08,2.02,6.25,'earth')
        if model.detail:
            for i in range(18):
                model.box(17.14,1.36+(i%3)*.09,z-2.8+i*.33,.05,.54,.055,'granite')
    model.box(17.08,0,12,.22,2.42,1.8,'wood')
    for z in (10.94,13.06):
        model.box(17.25,0,z,.5,2.58,.34,'granite')
    model.box(17.21,2.55,12,.56,.30,2.65,'granite')
    for z in (-29,-17,-3,11):
        model.beam([16.55,court,z],[16.55,court+3.5,z],.055,'wood')
        model.mesh([[16.55,court+3.45,z],[16.55,court+2.45,z],[16.48,court+2.85,z+1.48]],[[0,1,2]],'yellow')
    model.box(0,court,0,23.8,platform-court,22.6,'white',True)
    for sign in (-1,1):
        steps(model,court,platform,0,sign*14.5,0,-sign*.4,8,5)
        white_rail(model,-11.75,sign*11.1,2.28,0,4,platform)
        white_rail(model,2.63,sign*11.1,2.28,0,4,platform)
        white_rail(model,sign*11.75,-11.1,0,2.22,10,platform)
    # Pale dressed slabs with circular reliefs, facing the promenade (20/21/25).
    for face in range(4):
        model.pose=(0,0,0,face*np.pi/2)
        half,edge=(11.9,11.3) if face%2==0 else (11.3,11.9)
        for center in np.linspace(-half+1.1,half-1.1,10):
            if face%2==0 and abs(center)<2.9:
                continue
            model.box(center,court+.13,edge,2.07,1.12,.11,'white')
            if model.detail:
                model.mesh([[center+dx,court+.70+dy,edge+.058] for dx,dy in
                            ((-.43,-.43),(.43,-.43),(.43,.43),(-.43,.43))],
                           [[0,1,2],[0,2,3]],'leaf')
        model.box(0,platform-.18,edge,half*2,.18,.28,'white')
    model.pose=(0,0,0,0)
    facade(model,platform,8.85,5.05,False)
    tiled_roof(model,0,platform+5.05,0,24.3,23.1,2.1,1.65,porch_recess=1.9,lit_edge=True)
    # Projecting central porch and its gable break the first eave (19–22).
    for side in (-1,1):
        for x in (-2.6,2.6):
            model.beam([x,platform,side*10.7],[x,platform+5.25,side*10.7],.26,'wood',10,True)
        # The porch ridge points out towards the steps. Its gable rises above
        # the main eave and its fascia projects beyond the outer column line.
        model.pose=(0,0,side*9.36,np.pi/2)
        tiled_roof(model,0,platform+5.17,0,5.45,8.3,2.45,.85,.84,gable_material='earth',frame_gable=True)
        model.pose=(0,0,0,0 if side>0 else np.pi)
        model.box(0,platform+4.0,11.72,4.6,1.05,.22,'wood')
        model.mesh([[-2.17,platform+4.06,11.84],[2.17,platform+4.06,11.84],
                    [2.17,platform+4.99,11.84],[-2.17,platform+4.99,11.84]],
                   [[0,1,2],[0,2,3]],'clock')
        model.pose=(0,0,0,0)
    model.box(0,platform,0,8.2,4.8,.26,'wood',True)
    upper = platform+7.4
    model.box(0,upper-.45,0,17.9,.45,17.9,'wood',True)
    facade(model,upper,7.9,4.85,True)
    tiled_roof(model,0,upper+4.85,0,21.5,20.2,2.65,1.60,lit_edge=True)
    model.box(0,upper+7.12,0,12,1.05,11,'wood')
    tiled_roof(model,0,upper+8.17,0,18.4,17.5,3.7,1.50,.76,lit_edge=True,gable_material='earth',frame_gable=True)
    if model.detail:
        for side in (-1,1):
            for x in (-6,-3,3,6):
                model.beam([x,platform+3.65,side*8.9],[x,platform+4.25,side*8.9],.28,'red',10)



def generate(name='xiaoyao_tower', build=tower, folder='E', lift=None, colors=None, smooth=(), flood_roof=False, lettering=None):
    image = atlas(colors,smooth)
    if flood_roof:
        carve_medallion(image)
    if lettering:
        inscription(image, **lettering)
    target = Path(__file__).resolve().parents[2]/'public/textures/landmarks'/folder
    target.mkdir(parents=True, exist_ok=True)
    if colors is None: image.save(target/'timber-and-tile.png', optimize=True)
    scene = trimesh.Scene()
    for level in (0,1):
        model = LandmarkModel(level==0, flood_roof)
        build(model)
        group = f'lod{level}'
        scene.graph.update(frame_to=group)
        def add(parts, uvs, texture, name):
            vertices = np.concatenate(parts).reshape(-1,3)
            if lift is not None:
                vertices[:,1]+=lift(vertices[:,0])
            mesh = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1,3), process=False)
            if texture is not None:
                material = trimesh.visual.material.PBRMaterial(name=name,baseColorTexture=texture,roughnessFactor=1,metallicFactor=0,doubleSided=True)
                if name.endswith('_lit'):
                    material.emissiveFactor=[.58,.24,.055] if name=='roof_lit' else [.85,.57,.24]
                mesh.visual = trimesh.visual.TextureVisuals(uv=np.concatenate(uvs).reshape(-1,2),material=material)
            scene.add_geometry(mesh,node_name=group+'_'+name if texture else 'collision_surface',parent_node_name=group if texture else scene.graph.base_frame)
        if model.visible:
            add(model.visible,model.uv,image,'joinery')
        if model.pigmented:
            triangles,colors=zip(*model.pigmented)
            vertices=np.concatenate(triangles).reshape(-1,3)
            rock=trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
            rock.visual.vertex_colors=np.concatenate(colors).reshape(-1,4)
            scene.add_geometry(rock,node_name=group+'_limestone',parent_node_name=group)
        if model.lit_tiles:
            faces,uvs=zip(*model.lit_tiles);add(faces,uvs,image,'roof_lit')
        if model.lamps:
            faces,uvs=zip(*model.lamps);add(faces,uvs,image,'lamp_lit')
        for key, parts in model.tile_parts.items():
            if parts:
                cell = list(SWATCHES).index(key); left,top=128*(cell%4),128*(cell//4)
                add([tri for tri,uv in parts],[uv for tri,uv in parts],image.crop((left,top,left+128,top+128)),key)
        if not level:
            add(model.solid,None,None,'collision_surface')
    scene.export(Path(sys.argv[1])/(name+'.glb'))


if __name__ == '__main__':
    generate(colors={"wood":"#302d30","red":"#70312f","stone":"#cccddb","brick":"#646777",
                     "white":"#eef0fa","granite":"#c9cbd6","earth":"#383b43","sign":"#363337","tile":"#404650"}, flood_roof=True,
             lettering=dict(text="逍遙樓",foreground="#ceb17c",background="#392e29"))
