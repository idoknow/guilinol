"""古南门. Dimensions and evidence in docs/layout/gunanmen.md."""
import math
import random
import sys
from PIL import Image, ImageDraw
from c_kit import RECTS, ATLAS, _font, landmark_surface
from rong_paving import slab_texture
from rong_street import shops, signs, approach
from rong_solids import loft, oval, banyan as solid_tree, align_front
from pathlib import Path

from c_kit import (
    Builder, arch_wall, box, cylinder, ensure_textures, export_landmark, solid,
    grille, garden_gate_roof, hip_roof, railing, ramp, tri_count, segment_wall,
)


def board(mesh, x, y, z, w, h, region):
    # local v=0 is the top of the atlas cell, so the top edge of the board gets v=0.
    mesh.face(
        [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)],
        (0, 0, 1), region, uvs=[(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)],
    )


def stone_cells(image):
    rng = random.Random(1315)
    for index, name in enumerate(('coursed', 'ivywall')):
        left, top = index * 320, 896
        RECTS[name] = (left, top, 320, 128)
        tile = Image.new('RGB', (320, 128), '#424440')
        brush = ImageDraw.Draw(tile)
        row = 0
        while row < 128:
            height = rng.randint(3, 6) if index else rng.randint(5, 9)
            edge = -rng.randint(0, 38)
            while edge < 320:
                width = rng.randint(4, 10) if index else rng.randint(10, 25)
                tone = rng.randint(120, 168) - index * 34
                brush.polygon([(edge+1,row+1),(edge+width-2,row),(edge+width-1,row+height-2),(edge+width-4,row+height-1),(edge,row+height-2)], fill=(tone,tone+1,tone-2))
                edge += width
            row += height
        if index:
            for column in range(320):
                reach = int(39+24*math.sin(column*.033)+14*math.cos(column*.091)+rng.randrange(8))
                for leaf in range(0,reach,2):
                    green=rng.randrange(44,84)
                    brush.ellipse((column-2,leaf,column+2,leaf+3), fill=(green//2,green,green//2-2))
        image.paste(tile,(left,top))


def ancient_banyan(builder, east, south):
    wood = builder.parts['atlas']
    iron = builder.parts['steel']
    solid_tree(wood,(east,0,south),14.8,16.7,4,builder.detail)
    count = 32 if builder.detail else 16
    for index in range(count):
        ends = [(east+11.6*math.cos(math.tau*t/count),south+10.6*math.sin(math.tau*t/count)) for t in (index,index+1)]
        segment_wall(wood,*ends,-.04,.43,.8,'rubble')
        segment_wall(wood,*ends,-.04,.72,.64,'foliage')
        railing(iron,*ends,.42,.74,'steel',1.25)


def courtyard(builder, deck):
    wall = builder.parts['atlas']
    for center in (-6.5, 6.5):
        count = 28 if builder.detail else 16
        for index in range(count):
            angles=[step*math.tau/count for step in (index,index+1)]
            foot=[(center+3.75*math.cos(angle),7.9+3.45*math.sin(angle)) for angle in angles]
            head=[(center+2.35*math.cos(angle),7.9+2.1*math.sin(angle)) for angle in angles]
            points=[(east,level,south) for (east,south),level in zip([*foot,*reversed(head)],(0,0,deck,deck))]
            if builder.collide:
                builder.hit.face(points,(math.cos(sum(angles)/2),0,math.sin(sum(angles)/2)),'ashlar')
            start=.005+.99*index/count; end=.005+.99*(index+1)/count
            wall.face(points,(math.cos(sum(angles)/2),0,math.sin(sum(angles)/2)),'coursed',uvs=[(start,.99),(end,.99),(end,.01),(start,.01)])
        cap = [(center+2.35*math.cos(step*math.tau/count),deck-.015,
                7.9+2.1*math.sin(step*math.tau/count)) for step in range(count)]
        wall.face(cap,(0,1,0),'granite')
        if builder.collide:
            builder.hit.face(cap,(0,1,0),'ashlar')
    solid_tree(wall, (7.2, deck, 6.7), 5.6, 3.2, 82, builder.detail,lobed=False)
    for offset in (-4.5, -1.5, 1.5, 4.5):
        cylinder(wall, (offset, deck + 2.66, 7.6), .24, .45, 'vermilion', 8)
        cylinder(wall, (offset, deck + 2.52, 7.6), .045, .14, 'yellow', 5)
    # North-facing gate and the west return of the garden enclosure (IMG_1306).
    segment_wall(wall,(-31,-2.5),(-31,14),0,2.8,.60,'gate_plaster')
    segment_wall(wall,(-31,-2.5),(-31,14),2.8,3.07,.82,'graytile')
    if builder.collide:
        segment_wall(builder.hit,(-31,-2.5),(-31,14),0,3.07,.60,'ashlar')
    # Masonry jambs bond into the two returns; the woodwork lines the opening.
    for left,right in ((-33.2,-29.58),(-27.42,-22.3)):
        segment_wall(wall,(left,-2.5),(right,-2.5),0,2.92,.60,'gate_plaster')
        segment_wall(wall,(left,-2.5),(right,-2.5),2.92,3.13,.80,'graytile')
        if builder.collide:
            segment_wall(builder.hit,(left,-2.5),(right,-2.5),0,3.13,.60,'ashlar')
    for jamb in (-30.04,-26.96):
        box(wall,(jamb,1.78,-2.5),(.92,3.56,.76),'gate_plaster')
    for post in (-29.52,-27.48):
        box(wall,(post,1.76,-2.87),(.20,3.52,.32),'wood')
    box(wall,(-28.5,3.36,-2.53),(3.98,.40,.78),'gate_plaster')
    box(wall,(-28.5,3.13,-2.87),(2.30,.22,.32),'wood')
    box(wall,(-28.5,3.52,-2.5),(4.52,.24,1.68),'wood')
    garden_gate_roof(wall,(-28.5,-2.5),3.59,4.52,1.68,.48)
    for step in range(4):
        height = .13 + .55*(step+1)/4
        box(wall,(-28.5,height/2,-6.2+(step+.5)*.875),(3.35,height,.875),'ashlar')
    if builder.collide:
        ramp(builder.hit,(-28.5,.13,-6.2),(-28.5,.68,-2.7),3.35)
    box(wall,(-24.55,.20,-3.25),(3.8,.40,1.7),'coursed',None)
    for x in (-25.4,-23.7):
        oval(wall,(x,1.10,-3.25),(1.1,.72,.82),'hedge',9)



def build(b: Builder):
    shops(b)
    approach(b)
    meshes = [*b.parts.values(), b.hit]
    starts = [len(mesh.pos) for mesh in meshes]
    ground = landmark_surface('gunanmen').ground
    # The eastern hall sits on way/684946200, the western hall on way/521248472.
    # Keep the plaza banyan on the west side of pedestrian way/684511179.
    ancient_banyan(b, -28, 3)
    # Trail map at the south edge of the gate plaza, facing its pedestrian path.
    with align_front(b, (-6, 12), 164):
        mesh = b.parts['atlas']
        for x in (-7.62, -4.38):
            box(mesh, (x, 1.28, 12), (.16, 2.56, .22), 'wood')
        box(mesh, (-6, 1.55, 12), (3.42, 1.96, .19), 'wood')
        board(mesh, -6, 1.55, 12.11, 3.12, 1.68, 'park_map')
        if b.collide:
            solid(b.hit, (-6, 1.55, 12), (3.42, 1.96, .19), 'wood')
    with align_front(b, (0, 0), -26.8, shift=(15, -7.2)):
        west_hall(b)
        # Centre the passage on the eastern hall inside the continuous terrace.
        with align_front(b, (0,0), 0, shift=(-1.45,-1.35)):
            gate(b)
    # Sample feet after rotating into landmark space. Keep the terrace and
    # gatehouse level, tapering the change up the battered masonry walls.
    terrace_datum = ground(15,-7.2)
    for mesh, start in zip(meshes, starts):
        for i in range(start, len(mesh.pos)):
            x, y, z = mesh.pos[i]
            blend = max(0, 1 - max(0, y) / 6.7)
            datum = terrace_datum
            if blend:
                datum += blend * (ground(x, z) - terrace_datum)
            mesh.pos[i] = (x, y + datum, z)


def west_hall(b):
    wall, deck = b.parts['atlas'], 6.7
    # The west hall occupies way/521248472. IMG_1304 and IMG_1313 show both
    # yellow halls above the same stone terrace, with the western roof lower.
    height = 3.5
    box(wall, (-16.3,deck+height/2,2.8), (12.5,height,8.2), 'yellow')
    box(wall,(-16.3,deck+height,2.8),(13.8,.26,9.45),'wood')
    # IMG_1304 shows a long low tiled ridge above the western hall.
    y = deck+height+.13
    eaves = [(x,y,z) for x,z in [(-23.2,-1.94),(-9.4,-1.94),(-9.4,7.54),(-23.2,7.54)]]
    ridge = [(-21.8,y+1.5,2.8),(-10.8,y+1.5,2.8)]
    for points, normal in [(eaves[:2]+ridge[::-1], (0,1,-1)),
                           (eaves[1:3]+[ridge[1]], (1,1,0)),
                           (eaves[2:]+ridge, (0,1,1)),
                           ([eaves[3],eaves[0],ridge[0]], (-1,1,0))]:
        wall.face(points,normal,'graytile',None)
    if b.detail:
        for x in (-20.5,-17.7,-14.9,-12.1):
            for z in (-1.32,6.92):
                grille(wall,x,deck+1.55,z,1.4,2.15,'lattice',3,depth=.13)


def gate(b: Builder):
    wall = b.parts['atlas']
    detail = b.detail
    deck = 6.7
    courtyard(b, deck)
    # The northern portal narrows at the plaza. Both openings lead into
    # the same vaulted passage. Duplicate the profile in the collision mesh.
    north, south, west, east = -4.2, 8.7, -23.0, 8.4
    wall_start = len(wall.pos)
    for mesh in ([wall, b.hit] if b.collide else [wall]):
        for low, high, opening, crown in ((north, north+.8, 2.6, 3.4),
                                          (north+.8, south, 3.6, 4.6)):
            arch_wall(mesh, (0, 0, (low+high)/2), 16.8, deck, high-low,
                      opening, crown, 'coursed', 12 if detail else 6, tile=None)
        box(mesh, ((west-east)/2, deck/2, (north+south)/2),
            (-east-west, deck, south-north), 'coursed', None)
    # Project the north-facing stone courses through the arch spandrel.
    # Faces in the vault retain the clean masonry texture.
    left, top, width, height = RECTS['ivywall']
    for i in range(wall_start,len(wall.pos)):
        x,y,z = wall.pos[i]
        if abs(z-north)<.001 and wall.nrm[i][2]<-.99:
            u = (x-west)/(east-west)
            wall.uv[i] = ((left+1+(width-2)*u)/ATLAS,
                          1-(top+1+(height-2)*(1-y/deck))/ATLAS)
    # The low clipped hedge fronts the western half. The passage remains open.
    box(wall, (-13,.22,north-1.1), (17,.44,1.8), 'coursed', None)
    loft(wall,[(-13,.43,north-1.1,8.3,.85),(-13,1.20,north-1.1,8.6,1.02),
               (-13,1.47,north-1.1,8.1,.86)],'hedge',28 if detail else 14)
    if b.collide:
        box(b.hit,(-13,.6,north-1.1),(16,1.2,1.5),'ashlar')
    # Gatehouse: yellow hall, vermilion colonnade, gray xieshan, stone rail on the terrace.
    box(wall, (0, deck + 1.55, 1.65), (11.8, 3.1, 7.25), 'yellow', 1.6)
    box(wall, (-6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    box(wall, (6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    if detail:
        for x in (-3.6, -1.2, 1.2, 3.6):
            grille(wall, x, deck + 1.9, 5.285, 1.2, 1.7, 'lattice', 3)
    columns = 6 if detail else 4
    for i in range(columns):
        x = -4.4 + 8.8 * i / (columns - 1)
        cylinder(wall, (x, deck, 6.35), 0.28, 3.05, 'vermilion', 10 if detail else 6, 0.7)
        box(wall, (x, deck + 3.1, 6.35), (0.62, 0.16, 0.62), 'vermilion', 0.3)
    box(wall,(0,deck+3.09,2.6),(14.7,.32,11.9),'wood')
    hip_roof(wall, (0, 2.6), deck + 3.15, 13.4, 10.2, 2.55, 1.15, 0.65, 'graytile', 'vermilion',ceiling=True)
    # Open door leaves rest against the interior returns of the southern portal.
    for side in (-1, 1):
        box(wall, (side*1.72,1.72,south-.9), (.12,3.44,1.65), 'door', None)
    board(wall, 0, 5.55, south+.02, 4.8, 1.32, 'sign_gate')
    if detail:
        for x in (-4.5,-1.5,1.5,4.5):
            grille(wall,x,deck+1.45,-1.99,1.18,2.20,'lattice',3,depth=.11)
    spacing = 1.45 if detail else 2.9
    corners = [(west+.3,north+.25),(east-.3,north+.25),
               (east-.3,south-.25),(west+.3,south-.25)]
    for a,c in zip(corners,corners[1:]+corners[:1]):
        railing(wall,a,c,deck,.88,'white',spacing,stone=True)


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    signs(image)
    slab_texture(image,896,896)
    stone_cells(image)
    RECTS['gate_plaster'] = (768,640,62,126)
    patch = ImageDraw.Draw(image)
    patch.rectangle((768,640,829,765),fill='#b57563')
    noise = random.Random(1306)
    for _ in range(1900):
        shade = noise.randint(-10,9)
        patch.point((noise.randrange(768,830),noise.randrange(640,766)),
                    fill=tuple(value+shade for value in (181,117,99)))
    RECTS['hedge'] = (832,736,192,32)
    patch.rectangle((832,736,1023,767),fill='#46512b')
    for _ in range(2300):
        x,z = noise.randrange(833,1022),noise.randrange(737,766)
        tone = noise.randrange(-16,28)
        patch.point((x,z),fill=(72+tone,83+tone,37+tone))
    RECTS['park_map'] = (640, 896, 256, 128)
    panel = Image.new('RGB', (256,128), '#efe8d4')
    draw = ImageDraw.Draw(panel)
    draw.polygon([(9,74),(40,54),(77,66),(100,89),(147,81),(170,105),
                  (153,118),(94,111),(53,88)], fill='#89bbb8')
    draw.ellipse((82,81,112,97), fill='#96a66b')
    draw.line([(32,49),(56,57),(76,63),(93,88)], fill='#b49972', width=3)
    draw.text((60,4),'榕湖游览图',font=_font(16),fill='#584537')
    for index, label in enumerate(('古南门','九曲桥','湖心岛')):
        draw.text((187,36+index*22),label,font=_font(11),fill='#514c41')
    image.paste(panel,(640,896))
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'gunanmen.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'gunanmen triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()
