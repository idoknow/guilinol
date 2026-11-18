"""古南门. Anchor is OSM node/2596945561 (25.2789075, 110.2859788).

Local axes: +X east, +Z south, origin at the node on the ground. The facade faces
south toward the lakeside plaza (the path south of the node runs to 北斗桥).

Proportions from raw/refs/gunanmen/00-2021.jpg and 02-2019.jpg, using a 1.7 m
person against the doors: round arch about 3.5 m wide and 4.5 m to the crown,
stone bastion about 6.7 m to the terrace (the door is a little over half the
wall), gatehouse columns about 3.1 m, roof another 2.4 m. The stair on the
viewer's left is the west stair. The bastion front is a wide arc (the photo is
a curved rubble wall, not a flat block). Plaque reads 門南古, right to left.

Colors: see c_kit.paint_atlas. Rubble #a8a498 with dark joints and moss,
vermilion door #8e3034, ochre wall #d2ae58, gray tile #58595b, plaza #989389.
"""
import math
import sys
from pathlib import Path

from c_kit import (
    Builder, arch_wall, banyan, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, segment_wall, stairs, tri_count, yaw_box,
)


def arc(cx, cz, radius, a0, a1, n):
    return [(cx + radius * math.sin(a0 + (a1 - a0) * i / n), cz + radius * math.cos(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def board(mesh, x, y, z, w, h, region):
    mesh.face([(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)], (0, 0, 1), region, None)


def build(b: Builder):
    wall, lit = b.parts['atlas'], b.parts['lit']
    detail = b.detail
    deck = 6.7
    # Curved bastion. Circle center sits north of the front so the wall bows south.
    front = arc(0, 2.2, 8.6, math.radians(-62), math.radians(62), 16 if detail else 6)
    arch_wall(wall, (0, 0, 9.15), 4.6, deck, 2.9, 3.5, 4.55, 'rubble', 12 if detail else 4)
    for a, c in zip(front, front[1:]):
        if abs((a[0] + c[0]) / 2) < 2.15:
            continue
        segment_wall(wall, a, c, 0, deck, 2.2, 'rubble')
    segment_wall(wall, front[0], (front[0][0], -3.2), 0, deck, 2.0, 'rubble')
    segment_wall(wall, front[-1], (front[-1][0], -3.2), 0, deck, 2.0, 'rubble')
    segment_wall(wall, (front[0][0], -3.2), (front[-1][0], -3.2), 0, deck, 1.6, 'rubble')
    outline = front + [(front[-1][0], -3.4), (front[0][0], -3.4)]
    extrude(wall, outline, deck - 0.28, deck, 'granite', 1.4)
    # West wing: two-storey yellow building with a gray roof, as on the left of the photo.
    box(wall, (-15.2, 3.5, 3.2), (8.4, 7.0, 7.6), 'yellow', 1.8)
    hip_roof(wall, (-15.2, 3.2), 7.05, 8.6, 7.8, 1.7, 0.55, 0.28, 'graytile', 'soffit')
    if detail:
        for dx, yy, hh in ((-1.6, 2.1, 2.1), (1.6, 2.1, 2.1), (-1.6, 5.0, 1.35), (1.6, 5.0, 1.35)):
            grille(wall, -15.2 + dx, yy, 7.1, 1.35, hh, 'lattice', 3)
        arch_wall(wall, (-15.2, 0, 6.4), 2.4, 3.4, 0.5, 1.5, 2.6, 'yellow', 8)
        for i in range(12):
            box(wall, (-18.6 + i * 0.62, 7.35, 6.6), (0.1, 0.18, 1.4), 'graytile', 0.3)
    # Low east courtyard wall, yellow with a tile coping.
    box(wall, (14.2, 1.55, 4.0), (7.5, 3.1, 0.55), 'yellow', 1.5)
    box(wall, (14.2, 3.2, 4.0), (8.0, 0.28, 0.9), 'graytile', 0.6)
    # Terrace gallery: yellow back wall, open front, gray xieshan roof, red eaves.
    box(wall, (0, deck + 1.7, 2.4), (13.2, 3.4, 0.45), 'yellow', 1.6)
    if detail:
        for x in (-4.2, -1.4, 1.4, 4.2):
            grille(wall, x, deck + 1.8, 2.7, 1.15, 1.45, 'lattice', 3)
            box(lit, (x, deck + 3.55, 4.6), (0.42, 0.55, 0.42), 'vermilion', 0.4)
    columns = 6 if detail else 4
    for i in range(columns):
        x = -5.4 + 10.8 * i / (columns - 1)
        cylinder(wall, (x, deck, 6.15), 0.16, 3.15, 'wood', 8 if detail else 5, 0.8)
    for x in (-6.4, 6.4):
        cylinder(wall, (x, deck, 3.1), 0.16, 3.15, 'wood', 6, 0.8)
    hip_roof(wall, (0, 4.6), deck + 3.15, 13.6, 6.4, 1.85, 0.95, 0.62, 'graytile', 'soffit')
    if detail:
        for i in range(11):
            x = -5.0 + i
            box(wall, (x, deck + 2.95, 7.15), (0.28, 0.22, 0.45), 'wood', 0.3)
            box(wall, (x, deck + 3.2, 7.35), (0.18, 0.16, 0.28), 'vermilion', 0.3)
        for i in range(16):
            box(wall, (-6.2 + i * 0.82, deck + 3.55, 7.5), (0.1, 0.2, 1.6), 'graytile', 0.3)
    # Open vermilion doors, studs in the door texture. Leaves swing inward so the arch can be walked.
    yaw_box(wall, (-0.78, 1.85, 8.55), (1.45, 3.5, 0.08), 0.55, 'door', None)
    yaw_box(wall, (0.78, 1.85, 8.55), (1.45, 3.5, 0.08), math.pi - 0.55, 'door', None)
    board(wall, 0, 5.35, 10.7, 2.5, 0.95, 'sign_gate')
    # Balustrade along the bowed front and the stair.
    post = 0.32 if detail else 2.4
    for a, c in zip(front, front[1:]):
        if abs((a[0] + c[0]) / 2) < 2.4:
            continue
        railing(wall, a, c, deck, 0.92, 'ashlar', post)
    railing(wall, (-6.2, 6.3), (-6.2, 1.2), deck, 0.92, 'ashlar', post)
    railing(wall, (6.2, 6.3), (6.2, 1.2), deck, 0.92, 'ashlar', post)
    # West stair, 31 degrees: 6.7 m rise over 11 m run. Photo stair is the left-hand flight.
    stairs(wall, (-10.6, 0, 14.5), (-10.6, deck, 3.5), 2.5, 26 if detail else 8, 'ashlar')
    railing(wall, (-11.9, 14.5), (-11.9, 3.5), 0, 0.85, 'ashlar', post)
    # Plaza paving sits a few centimetres above the flattened ground.
    extrude(wall, [(-20, 9), (18, 9), (18, 26), (-20, 26)], 0.02, 0.1, 'granite', 1.6)
    # Hero banyan with aerial roots, southwest of the gate toward 古榕双桥, plus one on the east.
    banyan(wall, (-13.5, 0, 16.5), 15.5, 11.5, 4, detail)
    banyan(wall, (11.5, 0, 15.0), 11.0, 8.0, 8, detail)
    if not b.collide:
        return
    # Jambs and lintel leave a 3.1 m by 4.2 m arch. Stair is a ramp the walker can climb.
    solid(b.hit, (-3.6, 3.35, 9.15), (2.6, 6.7, 2.9), 'rubble')
    solid(b.hit, (3.6, 3.35, 9.15), (2.6, 6.7, 2.9), 'rubble')
    solid(b.hit, (0, 5.7, 9.15), (4.6, 2.0, 2.9), 'rubble')
    for a, c in zip(front[::2], front[2::2]):
        if abs((a[0] + c[0]) / 2) < 2.3:
            continue
        segment_wall(b.hit, a, c, 0, deck, 2.0, 'rubble')
    solid(b.hit, (0, deck + 0.12, 3.5), (12, 0.24, 8), 'granite')
    ramp(b.hit, (-10.6, 0.15, 14.5), (-10.6, deck, 3.5), 2.3)
    solid(b.hit, (-15.2, 3.5, 3.2), (8.2, 7.0, 7.4), 'yellow')
    solid(b.hit, (14.2, 1.55, 4.0), (7.5, 3.1, 0.55), 'yellow')
    solid(b.hit, (0, deck + 1.7, 2.4), (13, 3.4, 0.45), 'yellow')
    railing_hit = ((-6.5, 8.5), (6.5, 8.5), (-9.5, 4), (9.5, 4))
    for x, z in railing_hit:
        solid(b.hit, (x, deck + 0.45, z), (0.3, 0.9, 0.3), 'ashlar')


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
