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
import sys
from pathlib import Path

from c_kit import (
    Builder, arch_wall, banyan, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, stairs, tri_count, yaw_box, segment_wall,
)


def board(mesh, x, y, z, w, h, region):
    # local v=0 is the top of the atlas cell, so the top edge of the board gets v=0.
    mesh.face(
        [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)],
        (0, 0, 1), region, uvs=[(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)],
    )


def _battered(mesh, p0, p1, q1, q0, y0, y1, region='ashlar'):
    """One wall face. p is the bottom edge, q the top edge, so the wall can lean in."""
    mesh.face(
        [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (q1[0], y1, q1[1]), (q0[0], y1, q0[1])],
        ((p0[0] + p1[0]) * 0.5, (y0 + y1) * 0.5, (p0[1] + p1[1]) * 0.5), region, 2.6,
    )


def courtyard(builder, deck):
    wall = builder.parts['atlas']
    for center in (-6.5, 6.5):
        cylinder(wall, (center, 0, 7.9), 2.65, deck, 'ashlar', 18 if builder.detail else 9, 2.4)
    banyan(wall, (7.2, deck, 6.7), 5.6, 3.2, 82, builder.detail)
    for offset in (-4.5, -1.5, 1.5, 4.5):
        cylinder(wall, (offset, deck + 2.48, 7.6), .24, .45, 'vermilion', 8)
        cylinder(wall, (offset, deck + 2.34, 7.6), .045, .14, 'yellow', 5)
    box(wall, (-15, 1.15, 9), (12, 2.3, 1.15), 'ashlar')
    curve = [(11*math.cos(angle), -1.6-6*math.sin(angle)) for angle in
             [math.pi*index/12 for index in range(13)]]
    for start, end in zip(curve, curve[1:]):
        segment_wall(wall, start, end, 0, 2.5, .6, 'rubble')
        segment_wall(wall, start, end, 2.5, 5.3, .45, 'vermilion')
        segment_wall(wall, start, end, 5.3, 5.55, .82, 'glaze')
        hedge = [(east*1.12,north*1.12) for east,north in (start,end)]
        segment_wall(wall, *hedge, 0, .85, 1, 'foliage')
        if builder.collide:
            segment_wall(builder.hit, start, end, 0, 5.55, .6, 'rubble')
    extrude(wall, [(-19,-24),(19,-24),(19,-10),(-19,-10)], .02,.1,'granite')
    box(wall, (14.2,1.5,4.34),(2.2,3,.22),'wood')
    hip_roof(wall,(14.2,4),3.24,3.8,1.7,.95,.35,.25,'glaze','vermilion')
    for east,height in ((16.4,1.45),(17.6,.95)):
        box(wall,(east,height/2,4.85),(.78,height,.32),'granite')
        box(wall,(east,height*.7,5.03),(.54,.38,.04),'blacktile')


def build(b: Builder):
    wall = b.parts['atlas']
    detail = b.detail
    deck = 6.7
    courtyard(b, deck)
    # Solid platform. South face is one wall with the arch; the other three sides
    # are single faces, chamfered at the corners and inset 0.45 m at the top.
    front_z = 9.4
    arch_wall(wall, (0, 0, front_z), 15.6, deck, 2.6, 3.6, 4.6, 'ashlar', 8 if detail else 4, tile=2.6)
    inset = 0.45
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
            grille(wall, -15.2 + dx, yy, 7.1, 1.35, hh, 'lattice', 3)
        arch_wall(wall, (-15.2, 0, 6.4), 2.4, 3.4, 0.5, 1.5, 2.6, 'yellow', 8)
        for i in range(12):
            box(wall, (-18.6 + i * 0.62, 7.35, 6.6), (0.1, 0.18, 1.4), 'graytile', 0.3)
    # Low east courtyard wall, yellow with a tile coping.
    box(wall, (14.2, 1.55, 4.0), (7.5, 3.1, 0.55), 'vermilion', 1.5)
    box(wall, (14.2, 3.2, 4.0), (8.0, 0.28, 0.9), 'glaze', 0.6)
    # Gatehouse: yellow hall, vermilion colonnade, gray xieshan, stone rail on the terrace.
    box(wall, (0, deck + 1.55, 2.2), (12.2, 3.1, 0.45), 'yellow', 1.6)
    box(wall, (-6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    box(wall, (6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    if detail:
        for x in (-3.6, -1.2, 1.2, 3.6):
            grille(wall, x, deck + 1.9, 2.5, 1.2, 1.7, 'lattice', 3)
    columns = 6 if detail else 4
    for i in range(columns):
        x = -4.4 + 8.8 * i / (columns - 1)
        cylinder(wall, (x, deck, 6.35), 0.28, 3.05, 'vermilion', 10 if detail else 6, 0.7)
        box(wall, (x, deck + 3.1, 6.35), (0.62, 0.16, 0.62), 'vermilion', 0.3)
    hip_roof(wall, (0, 4.3), deck + 3.15, 13.4, 7.4, 3.6, 1.15, 0.65, 'graytile', 'vermilion')
    # Open vermilion doors, studs in the door texture. Leaves swing inward so the arch can be walked.
    yaw_box(wall, (-0.78, 1.85, 8.7), (1.45, 3.5, 0.08), 0.55, 'door', None)
    yaw_box(wall, (0.78, 1.85, 8.7), (1.45, 3.5, 0.08), math.pi - 0.55, 'door', None)
    # 4.8 m plaque. At 10 m and a 60° view it covers ~27° , enough for the three characters.
    board(wall, 0, 5.55, 10.85, 4.8, 1.45, 'sign_gate')
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
    extrude(wall, [(-20, 11), (18, 11), (18, 28), (-20, 28)], 0.02, 0.1, 'granite', 1.6)
    # Banyans stand off the south axis so a front camera is not inside the crown.
    banyan(wall, (-22, 0, 20), 14, 10, 4, detail)
    banyan(wall, (20, 0, 22), 12, 8.5, 8, detail)
    if not b.collide:
        return
    # Jambs and lintel leave a 3.6 m by 4.6 m arch. Stair is a ramp the walker can climb.
    solid(b.hit, (-4.8, 3.35, front_z), (6.0, 6.7, 2.6), 'ashlar')
    solid(b.hit, (4.8, 3.35, front_z), (6.0, 6.7, 2.6), 'ashlar')
    solid(b.hit, (0, 5.65, front_z), (3.6, 2.1, 2.6), 'ashlar')
    solid(b.hit, (-8.2, 3.35, 2.6), (1.3, 6.7, 8.4), 'ashlar')
    solid(b.hit, (8.2, 3.35, 2.6), (1.3, 6.7, 8.4), 'ashlar')
    solid(b.hit, (0, 3.35, -2.4), (14.5, 6.7, 1.4), 'ashlar')
    solid(b.hit, (0, deck + 0.12, 2.6), (13.5, 0.24, 9.2), 'ashlar')
    ramp(b.hit, (-12.2, 0.15, 16.5), (-7.2, deck, 5.2), 2.4)
    solid(b.hit, (-15.2, 3.5, 3.2), (8.2, 7.0, 7.4), 'yellow')
    solid(b.hit, (14.2, 1.55, 4.0), (7.5, 3.1, 0.55), 'yellow')
    solid(b.hit, (0, deck + 1.55, 2.2), (12.2, 3.1, 0.45), 'yellow')
    for x, z in ((-6.4, 7.4), (6.4, 7.4), (-6.4, -1.2), (6.4, -1.2)):
        solid(b.hit, (x, deck + 0.5, z), (0.4, 1.0, 0.4), 'ashlar')


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'gunanmen.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'gunanmen triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()
