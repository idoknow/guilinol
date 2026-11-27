"""Xinhua (新华社), 2016-04-01,《逍遥楼重现桂林漓江边》: two floors,
three eaves, ~22 m square and ~24 m high. OSM way/702352884 gives the
footprint and the NNE axis (~17 degrees east of north). The floor and sill
heights are estimates, not survey data. Roof slate, dark red timber and
pale grey paving follow the daylight 2025 views in landmark-refs.json.
"""
from functools import cache
from pathlib import Path
import sys

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

from shop_lettering import letters
from xiaoyao_roof import tiled_roof
from jingjiang import Model, SWATCHES, atlas
from xiaoyao_access import CENTER, FOOT, WIDTH


GLOW = {  # 夜景自发光（sRGB，屏上显示≈此值），乘 uNight；按图集格分部位。按 Rock 实拍夜景取色：饱和橙金、蓝通道近 0
    'glass': '#ff8a24',   # 檐底、封檐板：最亮
    'green': '#ffcf6a',   # 檐下灯带
    'gold':  '#ffd98a',   # 匾额金字
    'sign':  '#7c300a',   # 窗心、匾底：压暗，让木棂条透出来
    'red':   '#c03e10',   # 柱
    'wood':  '#b8540e',   # 木构、斗拱、栏杆
    'earth': '#4a2008',   # 山花、墙龛：压暗
    'white': '#b07a50',   # 白石台基、栏杆：暖白地灯
    'leaf':  '#a2704c',   # 台基团花石板
    'tile':  '#6a2c0a',   # 瓦面：比立面暗
    'granite': '#6a4a30',
    'yellow':  '#a07818', # 旗
    'clock':   '#ff1c0c', # 红灯笼：比立面橙更红，夜里跳出来
}
GLOW_GAIN = 1.0  # joinery_lit 自发光总增益
WALL_WASH = [.07, .045, .025]  # stone_lit/brick_lit 城墙淡洗光


def glow_atlas():
    """256×256 emissive atlas: 4×4 cells of 64 px in SWATCHES order."""
    sheet = Image.new('RGB', (256, 256))
    for index, key in enumerate(SWATCHES):
        sheet.paste(GLOW.get(key, '#000000'), ((index%4)*64, (index//4)*64, (index%4)*64+64, (index//4)*64+64))
    return sheet


class LandmarkModel(Model):
    def __init__(self, detail, flood_roof=False, night_glow=False):
        super().__init__(detail)
        self.curbs=[]
        self.planters=[]
        self.lamps=[]
        self.lit_tiles=[]
        self.flood_roof=flood_roof
        self.night_glow=night_glow

    def fit_to_grade(self, name, datum=0.0):
        """Fit the buried skirt and lower storey to GL04, preserving roof elevations."""
        from c_kit import landmark_surface
        self.site_ground = cache(landmark_surface(name).ground)
        self.site_datum = datum

    def foundation_vertices(self, vertices):
        vertices = np.array(vertices, dtype=float, copy=True)
        dx,dy,dz,angle = self.pose
        x,y,z = vertices.T
        east = dx+x*np.cos(angle)-z*np.sin(angle)
        south = dz+x*np.sin(angle)+z*np.cos(angle)
        above = y+dy-self.site_datum
        for i in np.flatnonzero(above < 3.2):
            ground = self.site_ground(round(east[i],5),round(south[i],5))
            # Limit the embedded skirt while keeping the ordering of nested plinths.
            skirt = max(-.12, above[i])
            blend = 1 - np.clip(above[i]/3.2,0,1)
            y[i] += blend*(ground-self.site_datum) + skirt-above[i]
        return vertices

    def mesh(self, vertices, faces, color, collide=False):
        if hasattr(self, 'site_ground'):
            vertices = self.foundation_vertices(vertices)
        if isinstance(color,str) and color=='curb':
            super().mesh(vertices,faces,'granite',collide)
            self.curbs.append((self.visible.pop(),self.uv.pop()))
        elif isinstance(color, str) and color in ('planter_frame', 'planter_soil'):
            swatch = 'granite' if color=='planter_frame' else 'earth'
            super().mesh(vertices, faces, swatch, collide)
            cell = list(SWATCHES).index(swatch)
            uv = self.uv.pop()*4 - [cell%4, 3-cell//4]
            uv[..., 0] = (uv[..., 0] + (swatch=='earth'))/2
            self.planters.append((self.visible.pop(), uv))
        elif self.night_glow and isinstance(color,str) and color in ('lamp','roof_soffit','tile'):
            # Night glow keeps eave lamps, soffits and tiles in joinery_lit; the
            # emissive atlas cell (green/glass/tile) decides how bright each one is.
            super().mesh(vertices,faces,{'lamp':'green','roof_soffit':'glass','tile':'tile'}[color],collide)
        elif isinstance(color,str) and color=='lamp':
            super().mesh(vertices,faces,'wood' if self.flood_roof else 'gold',collide)
            self.lamps.append((self.visible.pop(),self.uv.pop()))
        elif isinstance(color,str) and color in ('tile','roof_soffit'):
            super().mesh(vertices,faces,'wood' if color=='roof_soffit' else 'tile',collide)
            if self.flood_roof:
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
        face.text((x+64,y+64),text,font=font,anchor='mm',fill=foreground)


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


def bracket(model, x, y, z):
    """One dougong set at (x, y, z) in the current pose, projecting towards +z."""
    model.box(x, y, z, .36, .2, .36, 'wood')            # 坐斗
    model.box(x, y+.2, z, 1.05, .13, .16, 'wood')       # 泥道栱
    model.box(x, y+.2, z+.28, .16, .13, .92, 'wood')    # 华栱
    model.box(x, y+.33, z+.55, 1.35, .13, .16, 'wood')  # 瓜子栱
    model.box(x, y+.33, z+.42, .15, .15, 1.30, 'wood')  # 昂


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
                    # Upstairs: white sill panel under the dark lattice (Rock photos).
                    model.box(east, base, half-1.4, width-.14, 1.05, .18, 'white' if upstairs else 'wood', True)
                    model.box(east, base+1.05, half-1.55, width-.14, height-1.35, .12, 'sign', True)
                else:
                    model.box(east, base, half-1.4, width-.14, height-.3, .18, 'wood')
                if model.detail:
                    for offset in np.linspace(-width*.43, width*.43, 7):
                        model.box(east+offset, base+1.05, half-1.3, .07, height-1.35, .075, 'wood')
                    for lift in np.arange(1.35, height-.3, .65):
                        model.box(east, base+lift, half-1.3, width-.14, .07, .075, 'wood')
                if upstairs:
                    # White frieze tight under the eave, in front of the mullions / LOD1 wall.
                    model.box(east, base+height-.95, half-1.22, width-.14, .55, .1, 'white')
            if not upstairs:
                # One red lantern per bay under the first eave, outside the column line.
                top, z = base+height, half+.45
                if model.detail:
                    model.beam([east, top-.40, z], [east, top-.72, z], .02, 'wood', 4)
                    model.beam([east, top-1.42, z], [east, top-.72, z], .30, 'clock', 10)
                    for y in (top-.72, top-1.48):
                        model.beam([east, y, z], [east, y+.06, z], .2, 'gold', 8)
                    model.beam([east, top-1.70, z], [east, top-1.48, z], .05, 'gold', 4)
                else:
                    model.beam([east, top-1.42, z], [east, top-.72, z], .30, 'clock', 4)
            if model.detail:
                # Column-head and intermediate sets: two per bay under the eave.
                for at in (post, east):
                    bracket(model, at, base+height-.66, half)
            if upstairs:
                model.box(east, base+.94, half+.82, width+.04, .14, .14, 'wood', True)
                for offset in ([-.4,-.2,0,.2,.4] if model.detail else [0]):
                    model.box(east+offset*width, base, half+.82, .11, .94, .11, 'wood')
        if model.detail:
            # Thin plate (普拍枋) so the intermediate sets have a seat between columns.
            model.box(0, base+height-.78, half, half*2+.3, .12, .3, 'wood')
        else:
            model.box(0, base+height-.66, half+.45, half*2, .46, .9, 'wood')
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
    from c_kit import landmark_surface
    surface = landmark_surface('xiaoyao_tower')
    court, platform = 8.4, 9.84
    stair_center, stair_width = CENTER, WIDTH
    near, far = stair_center-stair_width/2, stair_center+stair_width/2
    for left,right,back,front in [(-17,17,-32,near),(-17,17,far,16),(0,17,near,far)]:
        center_x,center_z = (left+right)/2,(back+front)/2
        width,depth = right-left,front-back
        model.foundation(surface,center_x,-.36,center_z,width,court+.36,depth,'stone',covered_top=True)
        model.box(center_x,court-.16,center_z,width,.16,depth,'pave',True)
        model.box(center_x,court-.55,center_z,width+.16,.24,depth+.16,'granite')
    count = 48
    tread = -FOOT/count
    for index in range(count):
        center_x = FOOT+(index+.5)*tread
        height = court*(index+1)/count
        model.foundation(surface,center_x,-.36,stair_center,tread,height+.36,stair_width,'pave')
    # Riverside stair follows the eastern face, ending on an upper landing.
    steps(model,0,court,18.68,15.08,0,-.42,48,3.36)
    model.foundation(surface,18.68,-.25,-7.06,3.36,court+.25,4,'stone')
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
    # Yellow pennants with red borders along the crenellations (Rock photos).
    for z in np.linspace(-29.5,13.5,9):
        if -10 < z < -5:
            continue
        model.beam([16.55,court,z],[16.55,court+3.5,z],.055,'wood')
        corners=[[16.55,court+3.45,z],[16.55,court+2.45,z],[16.48,court+2.85,z+1.48]]
        model.mesh(corners,[[0,1,2]],'yellow')
        if model.detail:
            # The hoist edge sits inside the pole, so only the two free edges get a border.
            for end in corners[:2]:
                model.beam(end,corners[2],.03,'clock',4)
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
    tiled_roof(model,0,platform+5.05,0,24.3,23.1,2.1,1.65,porch_recess=1.9,lit_edge=True,ornate=True)
    # Projecting central porch and its gable break the first eave (19–22).
    for side in (-1,1):
        for x in (-2.6,2.6):
            model.beam([x,platform,side*10.7],[x,platform+5.25,side*10.7],.26,'wood',10,True)
        # The porch ridge points out towards the steps. Its gable rises above
        # the main eave and its fascia projects beyond the outer column line.
        model.pose=(0,0,side*9.36,np.pi/2)
        tiled_roof(model,0,platform+5.17,0,5.45,8.3,2.45,.85,.84,gable_material='earth',frame_gable=True,ornate=True)
        model.pose=(0,0,0,0 if side>0 else np.pi)
        for post in (-1.9,1.9):
            model.box(post,platform+4.92,11.45,.16,.65,.66,'wood')
        # Dark plaque, gold frame, pale-gold text read right to left: front
        # porch (-z) 楚越雄風, back porch (+z) 山水清音.
        model.box(0,platform+3.98,11.72,4.7,1.12,.2,'sign')
        for y in (platform+3.98,platform+5.02):
            model.box(0,y,11.85,4.7,.08,.06,'gold')
        for x in (-2.31,2.31):
            model.box(x,platform+3.98,11.85,.08,1.12,.06,'gold')
        letters(model,'風雄越楚' if side<0 else '音清水山',(0,platform+4.10,11.86),3.6,.86,'gold')
        if model.detail:
            # Couplet boards on the two front columns (r .26 at z 10.7); the
            # characters are placeholders only — the actual couplet is unverified.
            for x in (-2.6,2.6):
                model.box(x,platform+1.0,11.0,.46,3.1,.06,'sign')
                for edge in (-.21,.21):
                    model.box(x+edge,platform+1.0,11.045,.04,3.1,.03,'gold')
                for y in np.linspace(platform+1.25,platform+3.85,7):
                    model.box(x,y-.13,11.045,.26,.26,.02,'gold')  # y is the block centre
        model.pose=(0,0,0,0)
    model.box(0,platform,0,8.2,4.8,.26,'wood',True)
    upper = platform+7.4
    model.box(0,upper-.45,0,17.9,.45,17.9,'wood',True)
    facade(model,upper,7.9,4.85,True)
    tiled_roof(model,0,upper+4.85,0,21.5,20.2,2.65,1.60,lit_edge=True,ornate=True)
    model.box(0,upper+7.12,0,12,1.05,11,'wood')
    # Bracket sets round the drum carry the top eave; spaced so the 1.35 m
    # cross-arms of neighbours do not overlap (no coplanar z-fighting).
    for side in range(4):
        model.pose=(0,0,0,side*np.pi/2)
        face,length=(5.5,12) if side%2==0 else (6,11)
        if model.detail:
            count=int(length/1.36)
            for i in range(count):
                bracket(model,-length/2+(i+.5)*length/count,upper+7.56,face)
        else:
            model.box(0,upper+7.56,face+.45,length,.46,.9,'wood')
    model.pose=(0,0,0,0)
    model.box(0,upper+8.02,0,18.4,.36,17.5,'wood')
    tiled_roof(model,0,upper+8.17,0,18.4,17.5,3.7,1.50,.76,lit_edge=True,gable_material='earth',frame_gable=True,ornate=True,finial=True)
    # The first-floor lanterns now hang from facade() (one per bay, all four sides).



def generate(name='xiaoyao_tower', build=tower, folder='E', lift=None, colors=None, smooth=(), flood_roof=False, lettering=None, terrain_offset=None, lateral_offset=None, night_glow=False, cells=None):
    import json
    from c_kit import landmark_surface
    from native_paving import NativePaving
    config=Path(__file__).resolve().parents[1]/'seam-surfaces.json'
    street_roles=json.loads(config.read_text())['surfaces'].get(name,{})
    pavement=None
    if street_roles:
        frame=landmark_surface(name)
        pavement=NativePaving(frame.surface,frame.surface.entries[name])
    image = atlas(colors,smooth)
    if flood_roof:
        carve_medallion(image)
    if lettering:
        inscription(image, **lettering)
    glow = None
    if night_glow:
        # Soffits (glass) and eave lamps (green) wear the wood cell by day.
        index = list(SWATCHES).index('wood')
        grain = image.crop(((index%4)*128, (index//4)*128, (index%4)*128+128, (index//4)*128+128))
        for key in ('glass', 'green'):
            index = list(SWATCHES).index(key)
            image.paste(grain, ((index%4)*128, (index//4)*128))
        glow = glow_atlas()
    for key, color in (cells or {}).items():
        # Flat-fill whole cells (e.g. the unused clock face becomes lantern red).
        index = list(SWATCHES).index(key)
        image.paste(color, ((index%4)*128, (index//4)*128, (index%4)*128+128, (index//4)*128+128))
    target = Path(__file__).resolve().parents[2]/'public/textures/landmarks'/folder
    target.mkdir(parents=True, exist_ok=True)
    if colors is None: image.save(target/'timber-and-tile.png', optimize=True)
    scene = trimesh.Scene()
    for level in (0,1):
        model = LandmarkModel(level==0, flood_roof, night_glow)
        build(model)
        group = f'lod{level}'
        scene.graph.update(frame_to=group)
        def add(parts, uvs, texture, name, emissive=None, emissive_texture=None, role=None):
            vertices = np.concatenate(parts).reshape(-1,3)
            if lateral_offset is not None:
                vertices[:,2] += lateral_offset(vertices[:,0])
            if lift is not None:
                vertices[:,1]+=lift(vertices[:,0])
            if terrain_offset is not None:
                points, inverse = np.unique(vertices[:,::2],axis=0,return_inverse=True)
                vertices[:,1] += np.array([terrain_offset(x,z) for x,z in points])[inverse]
            coords=np.concatenate(uvs).reshape(-1,2) if texture is not None else None
            if coords is not None and street_roles.get(role or name) in ('sidewalk','curb'):
                vertices,coords=pavement.clip(vertices,coords)
                if not len(vertices):return
            mesh = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1,3), process=False)
            if texture is not None:
                material = trimesh.visual.material.PBRMaterial(name=name,baseColorTexture=texture,roughnessFactor=1,metallicFactor=0,doubleSided=True)
                if emissive is not None:
                    material.emissiveFactor=emissive
                    if emissive_texture is not None:
                        material.emissiveTexture=emissive_texture
                elif name.endswith('_lit'):
                    material.emissiveFactor=[.58,.24,.055] if name=='roof_lit' else [.85,.57,.24]
                mesh.visual = trimesh.visual.TextureVisuals(uv=coords,material=material)
            scene.add_geometry(mesh,node_name=group+'_'+name if texture else 'collision_surface',parent_node_name=group if texture else scene.graph.base_frame)
        if model.visible:
            if night_glow:
                add(model.visible,model.uv,image,'joinery_lit',[GLOW_GAIN]*3,glow)
            else:
                add(model.visible,model.uv,image,'joinery')
        if model.pigmented:
            triangles,colors=zip(*model.pigmented)
            vertices=np.concatenate(triangles).reshape(-1,3)
            rock=trimesh.Trimesh(vertices,np.arange(len(vertices)).reshape(-1,3),process=False)
            rock.visual.vertex_colors=np.concatenate(colors).reshape(-1,4)
            scene.add_geometry(rock,node_name=group+'_limestone',parent_node_name=group)
        if model.lit_tiles:
            faces,uvs=zip(*model.lit_tiles);add(faces,uvs,image,'roof_lit')
        if model.curbs:
            faces,uvs=zip(*model.curbs)
            add(faces,uvs,Image.new('RGB',(1,1),'#aaa9a6'),'curb')
        if model.planters:
            faces, uvs = zip(*model.planters)
            finish = Image.new('RGB', (256, 128))
            for col, key in enumerate(('granite', 'earth')):
                cell = list(SWATCHES).index(key)
                x, y = 128*(cell%4), 128*(cell//4)
                finish.paste(image.crop((x, y, x+128, y+128)), (col*128, 0))
            add(faces, uvs, finish, 'planter')
        if model.lamps:
            faces,uvs=zip(*model.lamps);add(faces,uvs,image,'lamp_lit')
        for key, parts in model.tile_parts.items():
            if parts:
                cell = list(SWATCHES).index(key); left,top=128*(cell%4),128*(cell//4)
                crop = image.crop((left,top,left+128,top+128))
                if night_glow and key in ('stone','brick'):
                    add([tri for tri,uv in parts],[uv for tri,uv in parts],crop,key+'_lit',WALL_WASH,crop,key)
                else:
                    add([tri for tri,uv in parts],[uv for tri,uv in parts],crop,key)
        if not level:
            add(model.solid,None,None,'collision_surface')
    scene.export(Path(sys.argv[1])/(name+'.glb'))


if __name__ == '__main__':
    generate(colors={"wood":"#4e3a32","red":"#4a2a26","stone":"#cccddb","brick":"#646777",
                     "white":"#eef0fa","granite":"#c9cbd6","earth":"#383b43","gold":"#e2c996","sign":"#3a2c28","tile":"#45484e"},
             flood_roof=True, night_glow=True, cells={'clock': '#a8261c'})
