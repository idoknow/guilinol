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
import sys
from pathlib import Path

from c_kit import (
    Builder, arch_wall, banyan, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, stairs, star, tri_count, tube,
)


def board(mesh, x, y, z, w, h, region, axis='z'):
    if axis == 'z':
        mesh.face([(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)], (0, 0, 1), region, None)
    else:
        mesh.face([(x, y - h / 2, z - w / 2), (x, y - h / 2, z + w / 2), (x, y + h / 2, z + w / 2), (x, y + h / 2, z - w / 2)], (1, 0, 0), region, None)


def pavilion(b, x, y, z, span=5.4, column_h=2.75, roof='blacktile'):
    wall = b.parts['atlas']
    deck = y + 0.72
    extrude(wall, [(x - span / 2, z - span / 2), (x + span / 2, z - span / 2), (x + span / 2, z + span / 2), (x - span / 2, z + span / 2)], y, deck, 'ashlar', 1.2)
    stairs(wall, (x, y, z + span / 2 + 2.4), (x, deck, z + span / 2 - 0.2), 1.8, 5 if b.detail else 3, 'granite')
    inset = span / 2 - 0.42
    for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
        cylinder(wall, (x + dx, deck, z + dz), 0.2, 0.85, 'bark', 6, 0.5)
        cylinder(wall, (x + dx, deck + 0.85, z + dz), 0.16, column_h - 0.85, 'vermilion', 8 if b.detail else 5, 0.6)
    post = 0.7 if b.detail else 2.2
    for a, c in (((-span / 2, -span / 2), (span / 2, -span / 2)), ((span / 2, -span / 2), (span / 2, span / 2 - 0.8)),
                 ((-span / 2, span / 2 - 0.8), (-span / 2, -span / 2))):
        railing(wall, (x + a[0], z + a[1]), (x + c[0], z + c[1]), deck, 0.92, 'ashlar', post)
        if b.detail:
            box(wall, (x + (a[0] + c[0]) / 2, deck + 0.42, z + (a[1] + c[1]) / 2), (abs(c[0] - a[0]) + 0.2, 0.08, abs(c[1] - a[1]) + 0.2), 'wood', 0.5)
    hip_roof(wall, (x, z), deck + column_h, span - 0.3, span - 0.3, 1.15, 0.85, 0.58, roof, 'soffit')
    board(wall, x, deck + column_h - 0.35, z + span / 2 - 0.7, 1.6, 0.45, 'wood')
    if b.collide:
        solid(b.hit, (x, y + 0.36, z), (span, 0.72, span), 'ashlar')
        ramp(b.hit, (x, y + 0.05, z + span / 2 + 2.4), (x, deck, z + span / 2 - 0.1), 1.6)
        for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
            solid(b.hit, (x + dx, deck + column_h / 2, z + dz), (0.32, column_h, 0.32), 'wood')


def island(b):
    """Double-eave pavilion and a short gallery, from the 2017 night photograph."""
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = 98.8, 0.3, 137.6
    extrude(wall, [(x - 4.2, z - 3.2), (x + 7.5, z - 3.2), (x + 7.5, z + 3.2), (x - 4.2, z + 3.2)], y, y + 0.7, 'ashlar')
    pavilion(b, x + 4.6, y, z, 4.6, 3.05, 'graytile')
    hip_roof(wall, (x + 4.6, z), y + 0.7 + 3.05 + 1.35, 3.2, 3.2, 0.95, 0.45, 0.4, 'graytile', 'soffit')
    # Gallery running west from the pavilion, lattice bays, lower roof.
    box(wall, (x - 0.6, y + 0.7 + 1.3, z), (8.2, 0.18, 2.6), 'ashlar')
    for i in range(5 if b.detail else 2):
        cx = x - 3.4 + i * 1.6
        cylinder(wall, (cx, y + 0.7, z - 1.05), 0.1, 2.3, 'wood', 6, 0.4)
        cylinder(wall, (cx, y + 0.7, z + 1.05), 0.1, 2.3, 'wood', 6, 0.4)
        if b.detail:
            grille(wall, cx, y + 1.9, z, 1.2, 1.6, 'lattice', 2)
            box(lit, (cx, y + 2.7, z + 1.15), (0.28, 0.4, 0.28), 'vermilion')
    hip_roof(wall, (x - 0.6, z), y + 3.05, 8.4, 2.8, 0.7, 0.4, 0.2, 'graytile', 'soffit')
    if b.detail:
        railing(wall, (x - 4.2, z + 3.2), (x + 2.2, z + 3.2), y + 0.7, 0.85, 'ashlar', 0.9)
    banyan(wall, (x - 6, y, z + 2), 12, 9, 21, b.detail)
    banyan(wall, (x + 7, y, z - 3), 10, 7.5, 22, b.detail)
    if b.collide:
        solid(b.hit, (x + 1.5, y + 0.35, z), (12, 0.7, 6.2), 'ashlar')


def library(b):
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = -22.0, 1.75, -36.0
    # South front faces the lake (+Z). Body is 20 m wide, two storeys plus pediment.
    box(wall, (x, y + 4.3, z - 3.2), (20, 8.6, 10), 'cream', 2.2)
    stairs(wall, (x, y, z + 2.6), (x, y + 0.9, z + 1.6), 8.5, 5 if b.detail else 2, 'granite')
    for dx in (-6.3, -2.1, 2.1, 6.3):
        cylinder(wall, (x + dx, y + 0.9, z + 1.55), 0.55, 6.4, 'ashlar', 10 if b.detail else 6, 1.5)
        if b.detail:
            cylinder(wall, (x + dx, y + 7.15, z + 1.55), 0.72, 0.35, 'ashlar', 8, 0.4)
    # Pediment
    wall.face([(x - 8.2, y + 8.7, z + 1.9), (x + 8.2, y + 8.7, z + 1.9), (x, y + 11.6, z + 1.9)], (0, 0, 1), 'cream', None)
    wall.face([(x + 8.2, y + 8.7, z + 0.6), (x - 8.2, y + 8.7, z + 0.6), (x, y + 11.6, z + 0.6)], (0, 0, -1), 'cream', None)
    wall.face([(x - 8.2, y + 8.7, z + 1.9), (x, y + 11.6, z + 1.9), (x, y + 11.6, z + 0.6), (x - 8.2, y + 8.7, z + 0.6)], (-1, 1, 0), 'cream', None)
    wall.face([(x + 8.2, y + 8.7, z + 0.6), (x, y + 11.6, z + 0.6), (x, y + 11.6, z + 1.9), (x + 8.2, y + 8.7, z + 1.9)], (1, 1, 0), 'cream', None)
    star(wall, (x, y + 10.2, z + 2.05), 0.85, 0.12, 'vermilion')
    board(wall, x, y + 8.15, z + 2.05, 14.5, 0.7, 'sign_lib')
    if b.detail:
        for col, row in ((-3.2, 2.4), (0, 2.4), (3.2, 2.4), (-3.2, 5.2), (0, 5.2), (3.2, 5.2)):
            box(lit, (x + col, y + row, z + 1.95), (1.15, 1.7, 0.08), 'glass', None)
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
    hip_roof(wall, (x, z - 4), y + 16.0, 40, 12, 2.4, 1.1, 0.35, 'graytile', 'soffit')
    hip_roof(wall, (x - 28, z - 4), y + 11.2, 12, 12, 1.6, 0.6, 0.25, 'graytile', 'soffit')
    hip_roof(wall, (x + 28, z - 4), y + 11.2, 12, 12, 1.6, 0.6, 0.25, 'graytile', 'soffit')
    hip_roof(wall, (x, z - 4), y + 18.6, 8, 6, 1.5, 0.4, 0.35, 'blacktile', 'soffit')
    board(wall, x, y + 17.3, z + 2.3, 6.5, 1.1, 'sign_hotel')
    floors = 5 if b.detail else 2
    cols = 11 if b.detail else 4
    for row in range(floors):
        box(wall, (x, y + 1.6 + row * 3.05, z + 3.15), (44, 0.12, 0.9), 'cream', 2)
        for col in range(cols):
            cx = x - 20 + 40 * col / (cols - 1)
            box(lit, (cx, y + 2.3 + row * 3.05, z + 3.55), (1.5, 1.5, 0.06), 'glass', None)
    banyan(wall, (x - 16, y, z + 10), 13, 10, 31, b.detail)
    banyan(wall, (x + 14, y, z + 12), 12, 9, 32, b.detail)
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
    post = 1.3 if b.detail else 6
    # North bank between the pavilion and 古南门, with a gap in front of the steps.
    railing(wall, (-36, 7.2), (-2.2, 7.2), 0, 0.9, 'ashlar', post)
    railing(wall, (2.2, 7.2), (72, 7.2), 0, 0.9, 'ashlar', post)
    banyan(wall, (-8, 0, 4.5), 14, 11, 41, b.detail)
    banyan(wall, (18, 0, 5.5), 13, 10, 42, b.detail)
    if b.detail:
        banyan(wall, (48, 0, 6.0), 12, 9, 43, True)
        banyan(wall, (-30, 0, 5), 11, 8, 44, True)


def build(b: Builder):
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
