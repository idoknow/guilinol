"""榕湖. Anchor is OSM node/6320266329 系舟亭 (25.2788955, 110.2853181), ground DEM 153.1 m.

Other pieces are offset in metres from that node (x east, z south) and lifted by the
DEM difference so each one sits on its own ground:

- 湖心亭 node/6317785656 at (+98.8, +137.6), DEM +0.3 m
- 榕湖钢桥 way/155148522 midpoint at (-604.1, +87.2). The bridge center is over
  water (DEM 148 m); the deck is kept near shore height, y=0.6, matching the
  other footbridges which sit about 2 m above the water.
- 图书馆榕湖分部 south front at (-22, -36). The parcel centroid is DEM +4.3 m,
  but the facade sits on the lakeside edge, DEM +1.75 m.
- 榕湖饭店 lakeside mass at (-190, +55), DEM +1.15 m. The grounds centroid
  further inland is higher; the modeled block uses the bank height.

系舟亭, from raw/refs/ronghu/03-2019.jpg: square plan about 5.4 m, columns about
2.8 m (a seated person fixes the 美人靠 at 0.9 m), black tile hip roof with
upturned corners, red upper columns and a dark stone base, white platform and
four steps on the lake side. The night view 04-2017.jpg is the island pavilion:
a taller double eave on a stone pier, with a short covered corridor. Library
01-2019.jpg is a two-storey cream block, four round columns, a pediment and a
red star. Hotel 07-2010.jpg / 02-2019.jpg is a white five-storey block with
dark pitched roofs and a roof pavilion.

Colors: roof #393943, column #9a3832, library wall #adaaa6, column #a7a4a1.
"""
import math
import sys
from rong_bridges import nine_bends, ancient_bridge
from pathlib import Path

from c_kit import (
    Builder, arch_wall, banyan, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, stairs, star, tri_count, tube, ring,
)


def board(mesh, x, y, z, w, h, region, axis='z'):
    uvs = [(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)]
    if axis == 'z':
        mesh.face([(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)], (0, 0, 1), region, uvs=uvs)
    else:
        mesh.face([(x, y - h / 2, z - w / 2), (x, y - h / 2, z + w / 2), (x, y + h / 2, z + w / 2), (x, y + h / 2, z - w / 2)], (1, 0, 0), region, uvs=uvs)


def pavilion(b, x, y, z, span=5.4, column_h=2.75, roof='blacktile'):
    wall = b.parts['atlas']
    deck = y + 0.72
    extrude(wall, [(x - span / 2, z - span / 2), (x + span / 2, z - span / 2), (x + span / 2, z + span / 2), (x - span / 2, z + span / 2)], y, deck, 'ashlar', 1.2)
    stairs(wall, (x, y, z + span / 2 + 2.4), (x, deck, z + span / 2 - 0.2), 1.8, 5 if b.detail else 3, 'granite')
    inset = span / 2 - 0.55
    for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
        cylinder(wall, (x + dx, deck, z + dz), 0.22, 0.4, 'bark', 6, 0.4)
        cylinder(wall, (x + dx, deck + 0.4, z + dz), 0.2, column_h - 0.4, 'vermilion', 8 if b.detail else 5, 0.6)
    # 美人靠: a wood rail at seat-back height on three sides, open toward the steps.
    for a, c in (((-span / 2 + 0.15, -span / 2 + 0.15), (span / 2 - 0.15, -span / 2 + 0.15)),
                 ((span / 2 - 0.15, -span / 2 + 0.15), (span / 2 - 0.15, span / 2 - 0.9)),
                 ((-span / 2 + 0.15, span / 2 - 0.9), (-span / 2 + 0.15, -span / 2 + 0.15))):
        railing(wall, (x + a[0], z + a[1]), (x + c[0], z + c[1]), deck, 0.9, 'wood', 1.15)
    hip_roof(wall, (x, z), deck + column_h, span - 0.2, span - 0.2, 1.85, 1.05, 0.7, roof, 'vermilion', ceiling=True)
    board(wall, x, deck + column_h - 0.15, z + span / 2 - 0.55, 1.8, 0.55, 'wood')
    if b.collide:
        solid(b.hit, (x, y + 0.36, z), (span, 0.72, span), 'ashlar')
        ramp(b.hit, (x, y + 0.05, z + span / 2 + 2.4), (x, deck, z + span / 2 - 0.1), 1.6)
        for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
            solid(b.hit, (x + dx, deck + column_h / 2, z + dz), (0.32, column_h, 0.32), 'wood')


def island(b):
    """Double-eave hexagonal pavilion and a glazed corridor, from the 2017 night photograph."""
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = 98.8, 0.3, 137.6
    deck = y + 0.85
    bank = [(110,118),(129,121),(136,109),(150,113),(158,128),(155,134),(163,142),
            (171,155),(165,161),(174,172),(154,177),(153,171),(162,168),(141,166),
            (136,163),(132,166),(123,165),(111,155),(106,153),(108,144),(101,140),
            (99,142),(95,139),(99,133),(101,134)]
    extrude(wall,bank,-2.8,.24,'rubble',2.4)
    if b.collide:
        extrude(b.hit,bank,-.18,.24,'ashlar')
    box(wall,(133,.29,142),(36,.1,3.4),'granite')
    ring(wall,(123,2.5,136),2.3,1.58,'white',sides=24)
    for offset in (-.7,0,.7):
        ring(wall,(123+offset,2.5,136),.85,.63,'white')
    arch_wall(wall,(130,.24,132),12,3.2,.48,2.2,2.75,'rubble')
    for east in (126,134):
        grille(wall,east,2,132.27,1.7,1.5,'lattice',4)
    for index in range(10 if b.detail else 5):
        east,south=119+3.3*index,142+(-1)**index*3.3
        tube(wall,(east,.2,south),(east+.6,2.6+(index%3)*.45,south+.25),.72,'rubble',5)
        ring(wall,(east+.82,1.45,south),1.05,.46,'rubble',sides=8)
    for index in range(20 if b.detail else 8):
        angle=index*2.4
        east,south=142+4*math.sin(angle),134+3*math.cos(angle)
        tube(wall,(east,.24,south),(east+.4,5+index%3,south-.5),.08,'foliage',5)
    for index in range(5):
        east,south=130+index*2.4,153+index%2
        cylinder(wall,(east,.25,south),.12,.8,'steel',5)
        cylinder(wall,(east,1.05,south),.64,.09,'wood',8)
        for shift in (-.9,.9):
            box(wall,(east+shift,.55,south),(.45,.55,.46),'wood')
    for index in range(10):
        box(wall,(122+index*.32,.43,148),( .30,.30,2),'wood')
    for east in (x-4,x-1,x+2):
        cylinder(lit,(east,2.64,z+1.48),.21,.38,'vermilion',8)
    radius = 3.15
    pad = []
    for i in range(6):
        angle = math.pi / 6 + i * math.tau / 6
        pad.append((x + 4.2 + (radius + 1.1) * math.cos(angle), z + (radius + 1.1) * math.sin(angle)))
    extrude(wall, pad, y, deck, 'ashlar', 1.2)
    stairs(wall, (x + 4.2, y, z + radius + 2.6), (x + 4.2, deck, z + radius - 0.2), 1.8, 5 if b.detail else 3, 'granite')
    for i in range(6):
        angle = math.pi / 6 + i * math.tau / 6
        cx, cz = x + 4.2 + radius * math.cos(angle), z + radius * math.sin(angle)
        cylinder(wall, (cx, deck, cz), 0.2, 3.15, 'vermilion', 8 if b.detail else 5, 0.55)
    hip_roof(wall, (x + 4.2, z), deck + 3.15, 6.4, 6.4, 2.15, 0.85, 0.65, 'blacktile', 'vermilion', tiers=2, sides=6)
    # Glazed corridor running west: floor, columns, lattice windows, its own roof.
    box(wall, (x - 1.2, y + 0.42, z), (9.4, 0.16, 3.0), 'ashlar')
    bays = 5 if b.detail else 3
    for i in range(bays):
        cx = x - 4.6 + i * (8.2 / max(bays - 1, 1))
        cylinder(wall, (cx, y + 0.5, z - 1.15), 0.14, 2.55, 'vermilion', 6, 0.4)
        cylinder(wall, (cx, y + 0.5, z + 1.15), 0.14, 2.55, 'vermilion', 6, 0.4)
        box(lit, (cx, y + 1.85, z - 1.15), (1.15, 1.7, 0.06), 'glass', None)
        box(lit, (cx, y + 1.85, z + 1.15), (1.15, 1.7, 0.06), 'glass', None)
    hip_roof(wall, (x - 1.2, z), y + 3.15, 9.6, 3.5, 1.25, 0.55, 0.5, 'graytile', 'vermilion')
    banyan(wall, (x - 8, y, z - 6), 12, 9, 21, b.detail)
    banyan(wall, (x + 10, y, z - 7), 10, 7.5, 22, b.detail)
    if b.collide:
        solid(b.hit, (x + 4.2, y + 0.42, z), (7.2, 0.85, 7.2), 'ashlar')
        solid(b.hit, (x - 1.2, y + 0.3, z), (9.4, 0.2, 3.0), 'ashlar')
        ramp(b.hit, (x + 4.2, y + 0.05, z + radius + 2.6), (x + 4.2, deck, z + radius - 0.1), 1.6)


def library(b):
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = -22.0, 1.75, -36.0
    # South front faces the lake (+Z). Body is 20 m wide, two storeys plus pediment.
    box(wall, (x, y + 4.3, z - 3.2), (20, 8.6, 10), 'cream', 2.2)
    stairs(wall, (x, y, z + 2.6), (x, y + 0.9, z + 1.6), 8.5, 5 if b.detail else 2, 'granite')
    for dx in (-6.3, -2.1, 2.1, 6.3):
        cylinder(wall, (x + dx, y + 0.9, z + 2.15), 0.72, 7.45, 'granite', 12 if b.detail else 6, 1.6)
        cylinder(wall, (x + dx, y + 8.4, z + 2.15), 0.98, 0.28, 'granite', 8, 0.4)
        box(wall, (x + dx, y + 8.75, z + 2.15), (1.7, 0.28, 1.7), 'granite', 0.4)
    # Pediment proud of the columns, star in front of the triangle.
    wall.face([(x - 8.6, y + 8.9, z + 3.15), (x + 8.6, y + 8.9, z + 3.15), (x, y + 12.4, z + 3.15)], (0, 0, 1), 'cream', None)
    wall.face([(x + 8.6, y + 8.9, z + 2.3), (x - 8.6, y + 8.9, z + 2.3), (x, y + 12.4, z + 2.3)], (0, 0, -1), 'cream', None)
    wall.face([(x - 8.6, y + 8.9, z + 3.15), (x, y + 12.4, z + 3.15), (x, y + 12.4, z + 2.3), (x - 8.6, y + 8.9, z + 2.3)], (-1, 1, 0), 'cream', None)
    wall.face([(x + 8.6, y + 8.9, z + 2.3), (x, y + 12.4, z + 2.3), (x, y + 12.4, z + 3.15), (x + 8.6, y + 8.9, z + 3.15)], (1, 1, 0), 'cream', None)
    star(wall, (x, y + 10.6, z + 3.4), 1.15, 0.16, 'vermilion')
    board(wall, x, y + 8.35, z + 3.35, 12.5, 0.85, 'sign_lib')
    if b.detail:
        for col, row in ((-3.2, 2.4), (0, 2.4), (3.2, 2.4), (-3.2, 5.2), (0, 5.2), (3.2, 5.2)):
            box(lit, (x + col, y + row, z + 1.85), (1.15, 1.7, 0.08), 'glass', None)
        arch_wall(wall, (x, y + 0.9, z + 1.7), 2.2, 2.6, 0.4, 1.3, 2.3, 'cream', 6)
    if b.collide:
        # Leave a 2 m doorway in the south front. Side masses and the back wall stay solid.
        solid(b.hit, (x - 5.6, y + 4.3, z - 3.2), (8.6, 8.6, 10), 'cream')
        solid(b.hit, (x + 5.6, y + 4.3, z - 3.2), (8.6, 8.6, 10), 'cream')
        solid(b.hit, (x, y + 6.6, z - 3.2), (3.2, 4.0, 10), 'cream')
        # Close the north side so the front door is a room, not a tunnel through the block.
        solid(b.hit, (x, y + 4.3, z - 8.0), (20, 8.6, 0.45), 'cream')
        ramp(b.hit, (x, y + 0.05, z + 2.6), (x, y + 0.95, z + 1.5), 8)


def hotel(b):
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = -190.0, 1.15, 55.0
    # Five floors, white, south front. Wings step down. Dark roofs, a small roof pavilion.
    box(wall, (x, y + 8.0, z - 4), (46, 16.0, 14), 'cream', 3)
    box(wall, (x - 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream', 2.5)
    box(wall, (x + 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream', 2.5)
    hip_roof(wall, (x, z - 4), y + 16.05, 42, 13, 2.7, 1.3, 0.6, 'graytile', 'vermilion')
    hip_roof(wall, (x - 28, z - 4), y + 11.25, 13, 12, 1.9, 0.75, 0.5, 'graytile', 'vermilion')
    hip_roof(wall, (x + 28, z - 4), y + 11.25, 13, 12, 1.9, 0.75, 0.5, 'graytile', 'vermilion')
    # Stacked pavilion roofs on the main block, each one smaller than the one below.
    hip_roof(wall, (x, z - 4), y + 19.0, 22, 11, 2.8, 0.9, 0.55, 'blacktile', 'vermilion')
    hip_roof(wall, (x, z - 4), y + 22.0, 12, 7, 2.2, 0.6, 0.5, 'blacktile', 'vermilion')
    board(wall, x, y + 17.2, z + 3.4, 6.5, 1.1, 'sign_hotel')
    floors = 5 if b.detail else 2
    cols = 11 if b.detail else 4
    for row in range(floors):
        eave_y = y + 3.05 * (row + 1)
        box(wall, (x, eave_y, z + 3.85), (46.5, 0.32, 1.7), 'cream', 2)
        box(wall, (x, eave_y + 0.22, z + 4.45), (47.2, 0.14, 0.7), 'graytile', 1.2)
        for col in range(cols):
            cx = x - 20 + 40 * col / (cols - 1)
            box(lit, (cx, y + 2.15 + row * 3.05, z + 3.08), (1.45, 1.45, 0.06), 'glass', None)
    banyan(wall, (x - 34, y, z - 2), 13, 10, 31, b.detail)
    banyan(wall, (x + 34, y, z - 2), 12, 9, 32, b.detail)
    if b.collide:
        solid(b.hit, (x, y + 8, z - 4), (46, 16, 14), 'cream')
        solid(b.hit, (x - 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream')
        solid(b.hit, (x + 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream')


def steel_bridge(b):
    """North-south footbridge, 44.5 m, the length of way/155148522."""
    steel, wall = b.parts['steel'], b.parts['atlas']
    x, y, z = -604.1, 0.6, 87.2
    length, width = 44.5, 3.3
    box(steel, (x, y + 0.12, z), (width, 0.24, length), 'steel', 2)
    bays = 14 if b.detail else 4
    for side in (-width / 2, width / 2):
        z0, z1 = z - length / 2, z + length / 2
        tube(steel, (x + side, y + 0.3, z0), (x + side, y + 0.3, z1), 0.08, 'steel', 5)
        tube(steel, (x + side, y + 2.15, z0), (x + side, y + 2.15, z1), 0.07, 'steel', 5)
        for i in range(bays + 1):
            zz = z0 + length * i / bays
            tube(steel, (x + side, y + 0.3, zz), (x + side, y + 2.15, zz), 0.05, 'steel', 4)
        if b.detail:
            for i in range(bays):
                za = z0 + length * i / bays
                zb = za + length / bays
                tube(steel, (x + side, y + 0.3, za), (x + side, y + 2.15, zb), 0.04, 'steel', 4)
    if b.detail:
        railing(wall, (x - width / 2 + 0.15, z - length / 2), (x - width / 2 + 0.15, z + length / 2), y + 0.25, 1.05, 'steel', 1.6)
        railing(wall, (x + width / 2 - 0.15, z - length / 2), (x + width / 2 - 0.15, z + length / 2), y + 0.25, 1.05, 'steel', 1.6)
    if b.collide:
        solid(b.hit, (x, y + 0.12, z), (width - 0.3, 0.24, length), 'steel')
        solid(b.hit, (x - width / 2, y + 0.7, z), (0.16, 1.1, length), 'steel')
        solid(b.hit, (x + width / 2, y + 0.7, z), (0.16, 1.1, length), 'steel')


def shore(b):
    wall = b.parts['atlas']
    post = 0.95 if b.detail else 8
    # North bank between the pavilion and 古南门, with a gap in front of the steps.
    railing(wall, (-36, 7.2), (-2.2, 7.2), 0, 0.95, 'granite', post, stone=True)
    railing(wall, (2.2, 7.2), (72, 7.2), 0, 0.95, 'granite', post, stone=True)
    # North of the pavilion, so a camera standing beside the pavilion is not inside a crown.
    banyan(wall, (-16, 0, -8), 14, 11, 41, b.detail)
    banyan(wall, (20, 0, -7), 13, 10, 42, b.detail)
    if b.detail:
        banyan(wall, (48, 0, -4), 12, 9, 43, True)
        banyan(wall, (-34, 0, -6), 11, 8, 44, True)


def build(b: Builder):
    nine_bends(b)
    ancient_bridge(b)
    pavilion(b, 0, 0, 0)
    island(b)
    library(b)
    hotel(b)
    steel_bridge(b)
    shore(b)


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'ronghu.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'ronghu triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()
