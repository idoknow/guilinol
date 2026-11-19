"""古南门. Anchor is OSM node/2596945561 (25.2789075, 110.2859788).

Local axes: +X east, +Z south, origin at the node on the ground. The facade faces
south toward the lakeside plaza (the path south of the node runs to 北斗桥).

Proportions from raw/refs/gunanmen/00-2021.jpg and 02-2019.jpg, using a 1.7 m
person against the doors: round arch about 3.5 m wide and 4.5 m to the crown,
stone bastion about 6.7 m to the terrace (the door is a little over half the
wall), gatehouse columns about 3.2 m, roof another 2.6 m. The stair on the
viewer's left is the west stair. The bastion is a solid battered platform:
flat south face, short chamfered corners, walls leaning in as they rise.
The gatehouse is a yellow hall, a vermilion colonnade and a gray xieshan roof.
The plaque reads 古南门, left to right, sized to be legible from about 10 m.

Colors: see c_kit.paint_atlas. Rubble #a8a498 with dark joints and moss,
vermilion door #8e3034, ochre wall #d2ae58, gray tile #58595b, plaza #989389.
"""
import math
import random
import sys
from PIL import Image, ImageDraw
from c_kit import RECTS, ATLAS, landmark_surface
from rong_street import shops, signs, approach
from rong_solids import loft, oval, banyan as solid_tree, align_front
from pathlib import Path

from c_kit import (
    Builder, arch_wall, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, stairs, tri_count, yaw_box, segment_wall, tube, _canopy,
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
            height = rng.randint(10, 15)
            edge = -rng.randint(0, 38)
            while edge < 320:
                width = rng.randint(20, 49)
                tone = rng.randint(120, 168) - index * 47
                brush.polygon([(edge+2,row+1),(edge+width-2,row),(edge+width,row+height-3),(edge+width-4,row+height-1),(edge,row+height-2)], fill=(tone,tone+1,tone-2))
                edge += width
            row += height
        if index:
            for column in range(320):
                reach = int(39+24*math.sin(column*.033)+14*math.cos(column*.091)+rng.randrange(8))
                for leaf in range(0,reach,2):
                    green=rng.randrange(44,84)
                    brush.ellipse((column-2,leaf,column+2,leaf+3), fill=(green//2,green,green//2-2))
        image.paste(tile,(left,top))


def _battered(mesh, p0, p1, q1, q0, y0, y1, region='coursed', span=(.005,.995)):
    """One wall face. p is the bottom edge, q the top edge, so the wall can lean in."""
    mesh.face(
        [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (q1[0], y1, q1[1]), (q0[0], y1, q0[1])],
        ((p0[0] + p1[0]) * 0.5, 0, (p0[1] + p1[1]) * 0.5), region,
        uvs=[(span[0],.99),(span[1],.99),(span[1],.01),(span[0],.01)],
    )


def ancient_banyan(builder, east, south):
    wood = builder.parts['atlas']
    iron = builder.parts['steel']
    solid_tree(wood,(east,0,south),14.8,16.7,4,builder.detail)
    count = 32 if builder.detail else 16
    for index in range(count):
        ends = [(east+11.6*math.cos(math.tau*t/count),south+10.6*math.sin(math.tau*t/count)) for t in (index,index+1)]
        segment_wall(wood,*ends,-.04,.43,.8,'rubble')
        segment_wall(wood,*ends,.12,.72,.64,'foliage')
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
            start=.005+.99*index/count; end=.005+.99*(index+1)/count
            wall.face(points,(math.cos(sum(angles)/2),0,math.sin(sum(angles)/2)),'coursed',uvs=[(start,.99),(end,.99),(end,.01),(start,.01)])
        wall.face([(center+2.35*math.cos(step*math.tau/count),deck,7.9+2.1*math.sin(step*math.tau/count)) for step in range(count)],(0,1,0),'granite')
    solid_tree(wall, (7.2, deck, 6.7), 5.6, 3.2, 82, builder.detail,lobed=False)
    for offset in (-4.5, -1.5, 1.5, 4.5):
        cylinder(wall, (offset, deck + 2.48, 7.6), .24, .45, 'vermilion', 8)
        cylinder(wall, (offset, deck + 2.34, 7.6), .045, .14, 'yellow', 5)
    box(wall, (-15, 1.15, 9), (12, 2.3, 1.15), 'ashlar')
    box(wall,(0,deck/2,-4.5),(22,deck,3.4),'ashlar')
    _battered(wall,(-11,-6.8),(11,-6.8),(11,-6.21),(-11,-6.21),0,deck,'ivywall')
    railing(wall,(-10.7,-6.05),(10.7,-6.05),deck,.95,'white',1.2,stone=True)
    box(wall,(-2,.55,-7.9),(20,1.1,1.2),'foliage')
    curve=[(3+index*1.6,-9.8+.04*(index-4)**2) for index in range(10)]
    for start,end in zip(curve,curve[1:]):
        segment_wall(wall,start,end,0,1.8,.42,'vermilion')
        segment_wall(wall,start,end,1.8,2.02,.64,'glaze')
    for row in range(7):
        front=-10-row*2
        for east in range(-19,19,2):
            corners=[(east,front),(east+2,front),(east+2,front-2),(east,front-2)]
            wall.face([(xx,.035,zz) for xx,zz in corners],(0,1,0),'granite',None)
    box(wall, (14.2,1.5,4.34),(2.2,3,.22),'wood')
    for south in (2.75,5.25):
        wall.face([(11.9,3.28,south),(16.5,3.28,south),(16.5,4.25,4),(11.9,4.25,4)],(0,1,south-4),'glaze',None)
    box(wall,(14.2,3.24,4),(4.65,.22,2.65),'vermilion')
    box(wall,(14.2,4.28,4),(4.7,.22,.25),'glaze')
    for east in (13,15.4):
        box(wall,(east,1.5,4.56),(.2,3.05,.18),'wood')
    for east,height in ((16.4,1.45),(17.6,.95)):
        box(wall,(east,height/2,4.85),(.78,height,.32),'granite')
        box(wall,(east,height*.7,5.03),(.54,.38,.04),'blacktile')


def build(b: Builder):
    shops(b)
    approach(b)
    meshes = [*b.parts.values(), b.hit]
    starts = [len(mesh.pos) for mesh in meshes]
    ground = landmark_surface('gunanmen').ground
    with align_front(b, (0, 0), -26.8, shift=(.95,-15.8)):
        gate(b)
    # Sample feet after rotating into landmark space. Keep the terrace and
    # gatehouse level, tapering the change up the battered masonry walls.
    terrace_datum = ground(.95, -15.8)
    for mesh, start in zip(meshes, starts):
        for i in range(start, len(mesh.pos)):
            x, y, z = mesh.pos[i]
            blend = max(0, 1 - max(0, y) / 6.7)
            datum = terrace_datum
            if blend:
                datum += blend * (ground(x, z) - terrace_datum)
            mesh.pos[i] = (x, y + datum, z)


def gate(b: Builder):
    wall = b.parts['atlas']
    detail = b.detail
    deck = 6.7
    courtyard(b, deck)
    # Solid platform. South face is one wall with the arch; the other three sides
    # are single faces, chamfered at the corners and inset 0.45 m at the top.
    front_z = 9.4
    first_vertex=len(wall.pos)
    arch_wall(wall, (0, 0, front_z), 15.6, deck, 2.6, 3.6, 4.6, 'ashlar', 8 if detail else 4, tile=2.6)
    for index in range(first_vertex,len(wall.pos)):
        east,level,south=wall.pos[index]
        if abs(wall.nrm[index][2])>.9:
            left,top,width,height=RECTS['coursed']
            wall.uv[index]=((left+width*(.5+east/16))/ATLAS,1-(top+height*(.99-.98*level/deck))/ATLAS)
        wall.pos[index]=(east,level,south-.19*level)
        nx,ny,nz=wall.nrm[index];ny+=.19*nz
        length=math.sqrt(nx*nx+ny*ny+nz*nz)
        wall.nrm[index]=(nx/length,ny/length,nz/length)
    inset = 1.15
    # bottom (x, z), top (x, z). Order walks the outside from the front corners back.
    foot = [(-7.6, 8.1), (-8.6, 6.6), (-8.6, -1.4), (-7.2, -2.8), (7.2, -2.8), (8.6, -1.4), (8.6, 6.6), (7.6, 8.1)]
    head = [(-7.6 + inset, 8.1 - inset), (-8.6 + inset, 6.6 - inset), (-8.6 + inset, -1.4 + inset),
            (-7.2 + inset, -2.8 + inset), (7.2 - inset, -2.8 + inset), (8.6 - inset, -1.4 + inset),
            (8.6 - inset, 6.6 - inset), (7.6 - inset, 8.1 - inset)]
    for i in range(len(foot) - 1):
        _battered(wall, foot[i], foot[i + 1], head[i + 1], head[i], 0, deck)
    extrude(wall, [(-7.0, -2.2), (7.0, -2.2), (7.0, 7.4), (-7.0, 7.4)], deck - 0.24, deck, 'ashlar', 2.4)
    # West wing: two-storey yellow building with a gray roof, as on the left of the photo.
    box(wall, (-15.2, 3.5, 3.2), (8.4, 7.0, 7.6), 'yellow', 1.8)
    hip_roof(wall, (-15.2, 3.2), 7.05, 8.6, 7.8, 2.1, 0.7, 0.55, 'graytile', 'vermilion')
    if detail:
        for dx, yy, hh in ((-1.6, 2.1, 2.1), (1.6, 2.1, 2.1), (-1.6, 5.0, 1.35), (1.6, 5.0, 1.35)):
            grille(wall, -15.2 + dx, yy, 7.01, 1.35, hh, 'lattice', 3)
        arch_wall(wall, (-15.2, 0, 6.4), 2.4, 3.4, 0.5, 1.5, 2.6, 'yellow', 8)
        for i in range(12):
            box(wall, (-18.6 + i * 0.62, 7.35, 6.6), (0.1, 0.18, 1.4), 'graytile', 0.3)
    # Low east courtyard wall, yellow with a tile coping.
    box(wall, (14.2, 1.55, 4.0), (7.5, 3.1, 0.55), 'vermilion', 1.5)
    box(wall, (14.2, 3.2, 4.0), (8.0, 0.28, 0.9), 'glaze', 0.6)
    # Gatehouse: yellow hall, vermilion colonnade, gray xieshan, stone rail on the terrace.
    box(wall, (0, deck + 1.55, 3.15), (11.8, 3.1, 4.25), 'yellow', 1.6)
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
    box(wall,(0,deck+3.09,4.3),(14.7,.32,8.8),'wood')
    hip_roof(wall, (0, 4.3), deck + 3.15, 13.4, 7.4, 3.6, 1.15, 0.65, 'graytile', 'vermilion',ceiling=True)
    # Open vermilion doors, studs in the door texture. Leaves swing inward so the arch can be walked.
    yaw_box(wall, (-0.78, 1.85, 8.7), (1.45, 3.5, 0.08), 0.55, 'door', None)
    yaw_box(wall, (0.78, 1.85, 8.7), (1.45, 3.5, 0.08), math.pi - 0.55, 'door', None)
    # 4.8 m plaque. At 10 m and a 60° view it covers ~27° , enough for the three characters.
    wall.face([(east,level,10.71-.19*level) for east,level in ((-2.4,4.84),(2.4,4.84),(2.4,6.26),(-2.4,6.26))],(0,.19,1),'sign_gate',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])
    post = 0.7 if detail else 4.5
    railing(wall, (-6.4, 7.6), (-1.6, 7.6), deck, 0.95, 'ashlar', post, stone=True)
    railing(wall, (1.6, 7.6), (6.4, 7.6), deck, 0.95, 'ashlar', post, stone=True)
    railing(wall, (-6.6, 7.4), (-6.6, -1.2), deck, 0.95, 'ashlar', post, stone=True)
    railing(wall, (6.6, 7.4), (6.6, -1.2), deck, 0.95, 'ashlar', post, stone=True)
    railing(wall, (-6.4, -1.6), (6.4, -1.6), deck, 0.95, 'ashlar', post, stone=True)
    # West stair, about 30 degrees. It lands on the west edge of the terrace.
    stairs(wall, (-12.2, 0, 16.5), (-7.2, deck, 5.2), 2.6, 22 if detail else 8, 'ashlar')
    railing(wall, (-13.4, 16.5), (-8.4, 5.2), 0, 0.9, 'ashlar', post, stone=True)
    # Plaza paving sits a few centimetres above the flattened ground.
    for east in range(-20,18,2):
        for south in range(11,29,2):
            wall.face([(east,.035,south),(east+2,.035,south),(east+2,.035,south+2),(east,.035,south+2)],(0,1,0),'granite',None)
    # Banyans stand off the south axis so a front camera is not inside the crown.
    ancient_banyan(b, -22, 20)
    solid_tree(wall, (20, 0, 22), 12, 8.5, 8, detail)
    if not b.collide:
        return
    for side in (-1,1):
        solid(b.hit,(side*4.25,deck/2,5.7),(4.5,deck,6.6),'ashlar')
    solid(b.hit,(0,(deck+4.6)/2,5.7),(4,deck-4.6,6.6),'ashlar')


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    signs(image)
    stone_cells(image)
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'gunanmen.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'gunanmen triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()
