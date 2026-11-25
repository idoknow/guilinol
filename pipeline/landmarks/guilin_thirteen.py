"""桂林市第十三中学 (`way/669069474`) — OSM-level campus (IDOK-80, 口径 A).

Evidence and inferred attributes: .ops-docs/layout/schools/guilin_thirteen.md.
Footprints, sports surfaces and the campus outline are OSM/Overture geometry only;
floors, roofs and colours are inferred. One generalized street-side gate, always closed.
"""
from osm_campus import build_campus, palette, signs
from school_kit import export_school_glb

PALETTE = palette(win_frame='#5d7a96', roof_tile='#70767d')
SIGNS = signs('桂林市第十三中学', 'Guilin No.13 Middle School', '十三中')

FENCE_RING = [(4.37, 59.83), (4.67, 59.3), (7.74, 61.47), (28.48, 32.1), (22.36, 27.78), (22.66, 27.26), (22.21, 26.94), (33.04, 8.76), (37.26, -0.68), (38.29, -0.59), (38.61, -1.17), (44.04, -0.71), (47.68, -43.99), (45.98, -44.13), (46.0, -44.73), (42.2, -45.05), (44.71, -76.56), (18.43, -52.48), (21.57, -48.62), (21.5, -47.86), (6.6, -35.76), (5.84, -35.84), (3.45, -38.76), (-3.81, -32.11), (-1.55, -30.35), (-1.43, -29.64), (-13.59, -14.12), (-14.3, -14.07), (-20.78, -19.13), (-39.57, -4.82), (-53.04, 2.76), (-54.29, 4.18), (-52.97, 9.97), (-61.5, 12.42), (-63.62, 14.84), (-0.17, 62.44), (2.37, 58.42)]
GATE_EDGE = ((42.2, -45.05), (44.71, -76.56))   # faces 四会路
GATE_T = 0.5
BUILDINGS = [
    ('066329fa-3fb1-4834-9e1f-f7479d82b407', 5, [(-0.13, 47.58), (-50.92, 10.37), (-56.23, 17.61), (-5.45, 54.82)]),
    ('06dcb0bc-87b4-4953-ada3-0c5df6f6bb9d', 4, [(19.91, 26.05), (-0.84, 55.42), (7.74, 61.47), (28.48, 32.1)]),
    ('6719a1e1-eb46-4941-be0c-757a1e6a84ee', 4, [(36.56, -1.34), (44.04, -0.71), (47.68, -43.99), (40.21, -44.62)]),
]
TRACKS = [
]
PITCHES = [
    ('way/691138804', 'basketball', [(-19.42, 4.78), (2.19, 20.93), (-7.12, 33.39), (-28.73, 17.25)]),
    ('way/691138805', 'basketball', [(-9.74, -8.91), (12.46, 7.67), (3.9, 19.13), (-18.29, 2.55)]),
]

ROOFS = {}


def build(b):
    build_campus(b, fence=FENCE_RING, gate_edge=GATE_EDGE, gate_t=GATE_T, buildings=BUILDINGS, tracks=TRACKS,
                 pitches=PITCHES, roofs=ROOFS, floor_h=3.4,
                 court_surface='court_a')


if __name__ == '__main__':
    export_school_glb('guilin_thirteen', PALETTE, SIGNS, build, seed=2081)
