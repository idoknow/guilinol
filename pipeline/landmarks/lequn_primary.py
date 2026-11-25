"""乐群小学 (`way/684946203`) — OSM-level campus (IDOK-80, 口径 A).

Evidence and inferred attributes: .ops-docs/layout/schools/lequn_primary.md.
Footprints, sports surfaces and the campus outline are OSM/Overture geometry only;
floors, roofs and colours are inferred. One generalized street-side gate, always closed.
"""
from osm_campus import build_campus, palette, signs
from school_kit import export_school_glb

PALETTE = palette(win_frame='#6d8fb0', wall_sub='#e7b9b0')
SIGNS = signs('乐群小学', 'Lequn Primary School', '乐群')

FENCE_RING = [(-46.51, 35.83), (6.27, 51.04), (6.12, 51.69), (14.05, 53.36), (14.47, 51.51), (18.56, 48.37), (19.48, 45.43), (17.85, 44.53), (17.62, 43.96), (20.32, 33.65), (20.9, 33.31), (23.11, 33.88), (24.37, 29.88), (13.58, 26.05), (13.27, 25.31), (23.9, -4.49), (24.58, -4.7), (34.16, -1.3), (37.12, -10.71), (36.57, -15.36), (38.79, -16.02), (44.92, -35.55), (-13.52, -56.06), (-19.07, -40.59), (-19.02, -39.73), (-24.76, -22.03), (-25.95, -21.42), (-27.18, -17.99), (-31.22, -19.93), (-38.21, -3.27), (-33.33, -0.87), (-35.99, 6.55), (-35.72, 7.65), (-39.27, 17.24), (-40.07, 17.9)]
GATE_EDGE = ((38.79, -16.02), (44.92, -35.55))   # faces 四会路
GATE_T = 0.5
BUILDINGS = [
    ('3fad87f2-180d-42e5-8023-3ac6b070145e', 4, [(31.11, -24.85), (34.69, -34.7), (5.08, -45.41), (1.5, -35.55)]),
    ('a179afed-5e50-478e-80a7-d76205547cbe', 3, [(6.08, 18.81), (-1.15, 16.83), (-5.52, 32.71), (1.72, 34.7)]),
    ('67d2210a-5130-4322-80c1-93a3dfbfc274', 3, [(-21.6, 31.67), (-24.69, 41.7), (-0.32, 49.18), (2.76, 39.15)]),
    ('1425d2c0-bfdd-4ffc-8e3b-220a2b9200a4', 2, [(-27.8, 40.18), (-24.84, 31.7), (-36.17, 27.75), (-39.13, 36.25)]),
    ('95588372-f5bb-4316-bbae-2513d2b96b8f', 2, [(-21.29, 12.33), (-27.99, 8.96), (-32.03, 16.98), (-25.34, 20.36)]),
    ('75d808ea-7179-4d5f-918a-2db8459adac0', 2, [(6.12, 51.69), (13.44, 53.34), (15.09, 46.03), (7.77, 44.38)]),
    ('ebb2b92d-1523-4f2c-908d-0b4d603b3ea4', 3, [(-29.53, 0.33), (-22.8, -15.23), (-30.91, -19.12), (-37.44, -3.56)]),
]
TRACKS = [
]
PITCHES = [
    ('way/1350892046', 'basketball', [(-1.62, -40.27), (-10.89, -13.54), (-24.51, -18.26), (-15.24, -44.99)]),
]

ROOFS = {}


def build(b):
    build_campus(b, fence=FENCE_RING, gate_edge=GATE_EDGE, gate_t=GATE_T, buildings=BUILDINGS, tracks=TRACKS,
                 pitches=PITCHES, roofs=ROOFS, floor_h=3.3,
                 court_surface='court_a')


if __name__ == '__main__':
    export_school_glb('lequn_primary', PALETTE, SIGNS, build, seed=2082)
