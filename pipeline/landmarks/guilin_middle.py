"""桂林中学解西校区. Anchor is OSM way/690980799 奎光楼. The way centroid is the
origin; the footprint is about 16 m by 16 m, two storeys (building:levels=2).

解放西路 (ways 221821072 / 727682110) runs along the south edge of the campus
way/253811718. That edge is 33 m south of the tower, so the gate sits at
z=+33 and faces south. Ground at the tower is DEM 158.4 m; the south edge is
158.3 m, so the gate does not need a vertical offset.

校门, from raw/refs/guilin_middle/00-2019.jpg: a white beam with red 桂林中学,
a green glazed scalloped cap, two thick gray columns (about 6 m to the beam,
a person in the foreground), stone lions, white side wings. The green eave in
the issue is this cap; the white teaching block stands behind the wings with
the same green trim.

奎光楼, from 01-2019.jpg and 03-2019.jpg: a gray-brick gable with a round
window, and a two-storey vermilion gallery, spindle balcony, lattice doors,
dark tile roof. Wood in the sun reads near #7a4038; the gable brick median is
#8b887f. Columns are about 3.4 m per floor against the doorway.

Colors: beam #c9c8cb, glaze green #4e825f, column gray #8d9094.
"""
import math
import sys
from pathlib import Path

from c_kit import (
    Builder, banyan, box, cylinder, disc, ensure_textures, export_landmark, solid,
    grille, hip_roof, railing, ramp, ring, stairs, tri_count,
)


def board(mesh, x, y, z, w, h, region):
    mesh.face([(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)], (0, 0, 1), region, None)


def lion(mesh, x, z, yaw):
    # Blocky seated lion, about 1.35 m, gray stone. Yaw turns the head toward the road.
    box(mesh, (x, 0.18, z), (0.7, 0.28, 1.05), 'ashlar', 0.4)
    box(mesh, (x, 0.62, z + 0.05), (0.55, 0.6, 0.85), 'ashlar', 0.4)
    head = (x + math.sin(yaw) * 0.15, 1.15, z + math.cos(yaw) * 0.35)
    box(mesh, head, (0.38, 0.36, 0.42), 'ashlar', 0.3)
    box(mesh, (head[0], 1.28, head[2] - 0.05), (0.46, 0.16, 0.28), 'ashlar', 0.3)


def gate(b, z=32.9):
    wall, lit = b.parts['atlas'], b.parts['lit']
    # Two gray cylinders and a white beam. Opening between the columns is about 6.4 m.
    for x in (-3.55, 3.55):
        cylinder(wall, (x, 0, z), 0.52, 6.15, 'ashlar', 10 if b.detail else 6, 1.2)
    box(wall, (0, 6.85, z), (13.6, 1.35, 1.7), 'cream', 1.4)
    board(wall, 0, 6.9, z + 0.95, 8.2, 0.95, 'sign_school')
    hip_roof(wall, (0, z), 7.55, 12.4, 2.4, 0.85, 0.35, 0.18, 'glaze', 'glaze')
    # Side piers and white wings. The central path stays open toward 奎光楼.
    for x in (-6.6, 6.6):
        box(wall, (x, 3.4, z), (1.3, 6.8, 1.5), 'cream', 1.2)
        if b.detail:
            box(wall, (x, 7.55, z), (0.7, 0.45, 0.7), 'ashlar', 0.3)
    box(wall, (-11.2, 6.2, z - 1.5), (8.5, 12.4, 8), 'cream', 2)
    box(wall, (11.2, 6.2, z - 1.5), (8.5, 12.4, 8), 'cream', 2)
    hip_roof(wall, (-11.2, z - 1.5), 12.4, 8.8, 8.2, 1.3, 0.4, 0.15, 'glaze', 'glaze')
    hip_roof(wall, (11.2, z - 1.5), 12.4, 8.8, 8.2, 1.3, 0.4, 0.15, 'glaze', 'glaze')
    if b.detail:
        for x in (-11.2, 11.2):
            for row in (2.2, 5.4, 8.6):
                box(lit, (x, row, z + 2.6), (1.3, 1.6, 0.08), 'glass', None)
        for i in range(4):
            box(lit, (-1.6 + i * 1.05, 6.35, z + 0.2), (0.45, 0.7, 0.45), 'vermilion')
    lion(wall, -2.15, z + 2.4, 0.4)
    lion(wall, 2.15, z + 2.4, -0.4)
    if b.collide:
        for x in (-3.55, 3.55, -6.6, 6.6):
            solid(b.hit, (x, 3.4, z), (1.15, 6.8, 1.4), 'ashlar')
        solid(b.hit, (0, 6.9, z), (13.6, 1.4, 1.7), 'cream')
        solid(b.hit, (-11.2, 6.2, z - 1.5), (8.5, 12.4, 8), 'cream')
        solid(b.hit, (11.2, 6.2, z - 1.5), (8.5, 12.4, 8), 'cream')
        solid(b.hit, (-2.15, 0.6, z + 2.4), (0.7, 1.2, 1.0), 'ashlar')
        solid(b.hit, (2.15, 0.6, z + 2.4), (0.7, 1.2, 1.0), 'ashlar')


def kuiguang(b):
    wall = b.parts['atlas']
    # Front gallery faces south. Gable wall is the east end, with the round window.
    width, depth = 13.5, 8.2
    box(wall, (0, 4.6, -1.2), (width, 9.2, depth), 'brick', 1.6)
    # Gable raised on the east, curved top approximated by a stepped wall.
    box(wall, (width / 2 - 0.2, 6.2, -1.2), (0.55, 12.4, depth), 'brick', 1.2)
    if b.detail:
        box(wall, (width / 2 - 0.2, 11.6, -1.2), (0.55, 1.6, depth * 0.55), 'brick', 0.8)
        ring(wall, (width / 2 + 0.1, 7.4, -1.2), 0.85, 0.55, 'brick', 'x', 12 if b.detail else 8)
        disc(wall, (width / 2 + 0.16, 7.4, -1.2), 0.5, 'wood', 10, 'x')
    # Two-storey wooden gallery proud of the south face.
    for x in (-4.8, -2.4, 0, 2.4, 4.8):
        cylinder(wall, (x, 0.35, 3.55), 0.16, 3.3, 'wood', 8 if b.detail else 5, 0.6)
        cylinder(wall, (x, 3.7, 3.55), 0.14, 3.15, 'wood', 8 if b.detail else 5, 0.6)
    box(wall, (0, 3.65, 3.55), (11.2, 0.18, 1.7), 'wood', 0.8)
    box(wall, (0, 6.85, 3.55), (11.2, 0.16, 1.7), 'wood', 0.8)
    post = 0.32 if b.detail else 1.6
    railing(wall, (-5.4, 3.55), (5.4, 3.55), 3.7, 0.95, 'wood', post)
    railing(wall, (-5.4, 4.35), (5.4, 4.35), 0.35, 0.9, 'wood', post)
    if b.detail:
        for x in (-4.6, -3.1, -1.5, 0, 1.5, 3.1, 4.6):
            grille(wall, x, 1.7, 4.45, 1.15, 2.5, 'lattice', 4)
            grille(wall, x, 5.15, 4.45, 1.15, 1.7, 'lattice', 4)
        railing(wall, (-6, 8), (-6, 30), 0, 0.85, 'ashlar', 0.65)
        railing(wall, (6, 8), (6, 30), 0, 0.85, 'ashlar', 0.65)
    stairs(wall, (0, 0, 6.3), (0, 0.35, 4.6), 3.2, 3, 'granite')
    hip_roof(wall, (0, -0.4), 7.15, 14.2, 9.4, 2.5, 0.85, 0.45, 'blacktile', 'soffit')
    board(wall, 0, 6.55, 4.55, 1.8, 0.6, 'sign_kui')
    # 文保碑, a small stone slab in front of the gable, from 02-2019.jpg.
    box(wall, (5.2, 0.85, 6.4), (0.9, 1.7, 0.18), 'ashlar', None)
    banyan(wall, (-8, 0, 8), 9, 6.5, 51, b.detail)
    if b.collide:
        # Back and gable stop you; the south gallery is a porch you can step into.
        solid(b.hit, (0, 4.6, -2.6), (width, 9.2, 5.2), 'brick')
        solid(b.hit, (width / 2 - 0.2, 6, -1.2), (0.55, 12, depth), 'brick')
        for x in (-4.8, -2.4, 0, 2.4, 4.8):
            solid(b.hit, (x, 3.4, 3.55), (0.28, 6.6, 0.28), 'wood')
        solid(b.hit, (0, 4.2, 3.55), (11, 0.16, 1.6), 'wood')
        ramp(b.hit, (0, 0.02, 6.3), (0, 0.35, 4.7), 3.0)


def build(b: Builder):
    kuiguang(b)
    gate(b)
    if b.detail:
        extrude_plaza(b)


def extrude_plaza(b):
    from c_kit import extrude
    extrude(b.parts['atlas'], [(-8, 28), (8, 28), (8, 40), (-8, 40)], 0.02, 0.08, 'granite', 1.5)


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'guilin_middle.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'guilin_middle triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()
