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
    mesh.face(
        [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)],
        (0, 0, 1), region, uvs=[(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)],
    )


def lion(mesh, x, y, z, yaw, scale=1.0):
    """Blocky seated lion. `scale` 1 is about 1.6 m, gray stone. Yaw turns the head toward the road."""
    s = scale
    box(mesh, (x, y + 0.22 * s, z), (0.85 * s, 0.36 * s, 1.25 * s), 'granite', 0.4)
    box(mesh, (x, y + 0.75 * s, z + 0.05 * s), (0.68 * s, 0.7 * s, 1.0 * s), 'granite', 0.4)
    head = (x + math.sin(yaw) * 0.18 * s, y + 1.35 * s, z + math.cos(yaw) * 0.42 * s)
    box(mesh, head, (0.46 * s, 0.42 * s, 0.5 * s), 'granite', 0.3)
    box(mesh, (head[0], head[1] + 0.16 * s, head[2] - 0.04 * s), (0.55 * s, 0.18 * s, 0.32 * s), 'granite', 0.3)


def gate(b, z=32.9):
    wall, lit = b.parts['atlas'], b.parts['lit']
    # Two gray stone columns, a lion on each capital, a white beam with red 桂林中学.
    for x in (-3.85, 3.85):
        cylinder(wall, (x, 0, z), 0.92, 6.15, 'granite', 16 if b.detail else 8, 2.4)
        box(wall, (x, 6.32, z), (2.15, 0.42, 2.15), 'granite', 0.8)
        lion(wall, x, 6.48, z + 1.45, 0.25 if x < 0 else -0.25, 0.78)
    box(wall, (0, 6.7, z), (14.4, 1.15, 1.9), 'white', 1.6)
    board(wall, 0, 6.72, z + 1.08, 8.8, 0.95, 'sign_school')
    hip_roof(wall, (0, z), 8.05, 15.6, 4.6, 2.05, 0.75, 0.55, 'glaze', 'white')
    # White tile blocks on either side of the beam. The span between the columns
    # stays open, so the gate is a passage and the campus shows through it.
    for x in (-9.0, 9.0):
        box(wall, (x, 5.2, z - 6), (8.0, 10.4, 12), 'white', 2.2)
        hip_roof(wall, (x, z - 6), 10.55, 8.6, 13, 1.55, 0.5, 0.45, 'glaze', 'white')
    if b.detail:
        for x in (-11.2, -7.2, 7.2, 11.2):
            for row in (2.4, 5.6, 8.4):
                box(lit, (x, row, z + 0.06), (1.35, 1.4, 0.08), 'glass', None)
    lion(wall, -5.4, 0, z + 3.4, 0.5, 1.25)
    lion(wall, 5.4, 0, z + 3.4, -0.5, 1.25)
    if b.collide:
        for x in (-3.85, 3.85):
            solid(b.hit, (x, 3.3, z), (1.9, 6.6, 1.9), 'granite')
        solid(b.hit, (0, 6.7, z), (14.4, 1.2, 1.9), 'white')
        solid(b.hit, (-9.0, 5.2, z - 6), (8.0, 10.4, 12), 'white')
        solid(b.hit, (9.0, 5.2, z - 6), (8.0, 10.4, 12), 'white')
        solid(b.hit, (-5.4, 0.8, z + 3.4), (1.0, 1.6, 1.4), 'granite')
        solid(b.hit, (5.4, 0.8, z + 3.4), (1.0, 1.6, 1.4), 'granite')


def kuiguang(b):
    wall = b.parts['atlas']
    # Front gallery faces south. Gable wall is the east end, with the round window.
    width, depth = 13.5, 8.2
    box(wall, (0, 3.55, -1.2), (width, 7.1, depth), 'brick', 1.6)
    # Round window sits on the east wall, inside the building height. The old slab
    # that rose past the roof was this model's own gable, not a leftover OSM block.
    if b.detail:
        ring(wall, (width / 2 + 0.04, 4.7, -1.2), 0.95, 0.62, 'brick', 'x', 12)
        disc(wall, (width / 2 + 0.1, 4.7, -1.2), 0.55, 'wood', 10, 'x')
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
        railing(wall, (-6, 6.2), (-6, 14), 0, 0.9, 'granite', 1.6, stone=True)
        railing(wall, (6, 6.2), (6, 14), 0, 0.9, 'granite', 1.6, stone=True)
    stairs(wall, (0, 0, 6.3), (0, 0.35, 4.6), 3.2, 3, 'granite')
    hip_roof(wall, (0, -0.4), 7.15, 14.8, 9.8, 3.6, 1.15, 0.65, 'blacktile', 'cream')
    board(wall, 0, 6.55, 4.55, 2.2, 0.7, 'sign_kui')
    # 文保碑, a small stone slab in front of the gallery, from 02-2019.jpg.
    box(wall, (5.2, 0.85, 6.4), (0.9, 1.7, 0.18), 'granite', None)
    banyan(wall, (-14, 0, -6), 9, 6.5, 51, b.detail)
    if b.collide:
        # Back wall stops you; the south gallery is a porch you can step into.
        solid(b.hit, (0, 3.55, -2.6), (width, 7.1, 5.2), 'brick')
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
