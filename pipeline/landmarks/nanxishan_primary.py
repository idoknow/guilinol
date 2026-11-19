"""桂林市南溪山小学 (OSM way/1037119966), 象山区中山南路 40 号 / 天鹅巷旁.

Round 2 updates (strictly aligned with Rock 08:15 positioning & sg claude review):
- All 8 campus buildings extruded directly on exact Overture footprints (offset 0.00 m, angle diff 0.0 deg;
  invented east wing removed): 69c30fe2 (西临街穿堂门楼), bd5989c4 + b32c8f05 + e525b5e9 (至善楼北教学组团),
  99e11acf (书香楼), 5f7711c6 (博艺楼), and 4e89c64e / a02f9d94 (校园附楼).
- West gate on 中山南路 40 号 (69c30fe2) follows refs [10], [11]: 3D curved cobalt-blue metallic bullnose
  canopy with dark vertical seam ribs, sloped carved tan stone key-fret frieze band ('石刻纹样带'),
  white signboard ('桂林市南溪山小学'), 2F circular window, grey cylindrical columns with black bases,
  and closed black wrought-iron arched grille gate.
- 至善楼 follows refs [01], [02], [12], [13]: 100% solid 4-storey windowed body with pitched dark-grey roof,
  real ground-floor colonnade portico (outer white columns with blue bases + inner warm-tan fluted columns +
  granite steps), ink-hill calligraphic frieze ('最美的山水 最好的自己'), red-text LED banner, and 2F black LED screen.
- Sports field follows ref [22] (OSM has no leisure=pitch/track here; traced in central open yard):
  terracotta-red oval synthetic running track enclosing terracotta-red apron + twin end-to-end light sky-blue
  synthetic basketball courts with red keys & red center circles (ZERO green grass infield!).
"""
import math

from g2b_kit import SchoolBuilder, export_school_glb

RING = [
    (-57.63, -44.69),
    (-58.36, -11.04),
    (-74.73, -11.39),
    (-75.30, 14.59),
    (-45.09, 15.23),
    (-45.98, 57.31),
    (52.11, 59.39),
    (54.72, -62.27),
    (-5.31, -63.55),
    (-5.73, -43.58),
]

# Exact Overture footprints inside way/1037119966 (relative to campus centroid (-1968.68, 2331.16))
OV_GATEHOUSE  = [(-60.56, 7.58), (-61.80, -24.17), (-72.40, -23.76), (-71.15, 8.00)]    # 69c30fe2
OV_ZHISHAN_N  = [(47.53, -65.19), (19.05, -66.09), (18.68, -54.11), (47.16, -53.22)]    # bd5989c4
OV_ZHISHAN_S  = [(31.91, -44.64), (31.28, -34.16), (44.75, -33.37), (45.37, -43.84)]    # b32c8f05
OV_ZHISHAN_W  = [
    (18.76, -33.14), (27.82, -38.63), (23.97, -44.97),
    (18.53, -41.67), (13.03, -50.73), (9.41, -48.53),
]  # e525b5e9
OV_SHUXIANG   = [(-20.07, 58.78), (0.89, 59.96), (1.40, 50.99), (-19.56, 49.82)]        # 99e11acf
OV_BOYI       = [(-35.37, 50.48), (-35.54, 59.46), (-23.55, 59.69), (-23.37, 50.71)]    # 5f7711c6
OV_ANNEX_SE   = [(18.97, 54.89), (18.19, 49.66), (13.99, 50.29), (14.78, 55.52)]        # 4e89c64e
OV_ANNEX_NW   = [(-7.08, -58.82), (-6.64, -52.48), (-2.40, -52.77), (-2.85, -59.11)]    # a02f9d94

PALETTE = {
    'wall_main':   '#f1efe9',  # crisp white exterior facade (refs [10], [12], [22])
    'wall_accent': '#b88b68',  # warm tan fluted portico columns (refs [01], [02], [12], [13]!)
    'wall_sub':    '#2f669e',  # cobalt-blue curved metallic gate canopy & column bases (refs [10], [12]!)
    'wall_base':   '#5e6268',  # slate-grey ground base
    'win_frame':   '#cfd4da',
    'win_trim':    '#e6e4de',
    'base_frame':  '#cfd4da',
    'base_trim':   '#787c82',
    'has_ac':      True,       # split-AC units visible on street gatehouse in ref [10]!
    'roof_tile':   '#4b4f56',  # dark slate-grey pitched roof tiles (ref [22]!)
    'pave_grey':   '#c8c5bc',
    'pave_dark':   '#4a4e54',
    'track_red':   '#bd4c43',  # terracotta-red synthetic track & infield apron (refs [19], [22]!)
    'turf_a':      '#558b4d',
    'turf_b':      '#45783e',
    'foliage':     '#396534',
    'glass':       '#385266',
    'court_a':     '#609cd0',  # light sky-blue synthetic basketball court surface (ref [22]!)
    'court_b':     '#2f669e',
    'yellow':      '#cfc2aa',  # carved stone key-fret frieze tone (ref [10], [11])
}

SIGNS = {
    'school_name': '桂林市南溪山小学',
    'school_en': 'Nan xi shan Primary School Gui lin',
    'gate_bg': '#f4f2ec',
    'gate_fg': '#ac2620',
    'gate_sub_fg': '#ac2620',
    'gate_border': '#969288',
    'emblem_style': 'key_fret',  # carved stone key-fret frieze pattern for gate canopy!
    'motto': '最美的山水 最好的自己',
    'motto_bg': '#f4f2ec',
    'motto_fg': '#222629',
    'motto_ink_hills': True,     # ink-wash Guilin hills + red seal + calligraphy (refs [01], [12], [13]!)
    'led_style': 'dark_banner',
    'led_title': '提高灾害防治能力 构筑生命安全防线',
    'buildings': ['至善楼', '书香楼', '博艺楼', '尚美坊'],
}


def _nanxishan_gate_canopy(b: SchoolBuilder):
    """Exact street-front gate on West face of OV_GATEHOUSE (69c30fe2) facing 中山南路 40 号 (refs [10], [11]):
    - 3D curved cobalt-blue metallic bullnose canopy (multi-facet smooth curve + dark vertical seam ribs)
    - Sloped carved stone key-fret frieze band ('石刻纹样带') directly above blue canopy
    - White rectangular signboard ('桂林市南溪山小学 / Nan xi shan Primary School Gui lin') + circular emblem
    - 2nd-floor circular landscape window ('圆洞窗') above the signboard
    - Grey cylindrical columns with black bases + closed black wrought-iron arched grille gate.
    """
    old = b.pose
    # West face of OV_GATEHOUSE sits around x = -71.8, z = -1.5, facing West (-X => yaw = -pi/2)
    b.pose = (-71.9, 0.0, -1.5, -math.pi * 0.5)
    y0 = 0.04
    span_w = 11.6

    # Recessed dark archway passage in ground floor + grey cylindrical columns with black bases (ref [10]!)
    b.box(0.0, y0, -0.35, span_w - 0.6, 3.55, 0.65, 'pave_dark')
    for col_x in (-5.1, -0.6, 4.9):
        b.cylinder_y(col_x, y0, 0.92, 0.72, 0.36, 'black_led', segs=12, collide=True)
        b.cylinder_y(col_x, y0 + 0.92, 2.55, 0.72, 0.33, 'pave_grey', segs=12, collide=True)

    # Closed black wrought-iron arched grille gates between columns (ref [10]!)
    b.pose = (-72.6, 0.0, -1.5 - 2.85, -math.pi * 0.5)
    b.retractable_gate(4.0, gate_h=2.35, y0=y0, iron_grille=True)
    b.pose = (-72.6, 0.0, -1.5 + 2.15, -math.pi * 0.5)
    b.retractable_gate(4.9, gate_h=2.35, y0=y0, iron_grille=True)
    b.pose = (-71.9, 0.0, -1.5, -math.pi * 0.5)

    # 3D Curved Cobalt-Blue Metallic Bullnose Canopy ('蓝色弧形金属挑檐', y = 3.45 .. 4.35, projecting to z = +2.35!)
    # Profile curve in (y, z) from soffit (3.42, 0.1) -> (3.45, 1.65) -> bullnose curve -> top (4.32, 2.10)
    prof = [
        (3.42, 0.05),
        (3.45, 1.62),
        (3.56, 2.02),
        (3.78, 2.26),
        (4.06, 2.30),
        (4.32, 2.12),
    ]
    hw = span_w * 0.5 + 0.5
    for pi in range(len(prof) - 1):
        y_a, z_a = prof[pi]
        y_b, z_b = prof[pi + 1]
        b.add_quad((-hw, y_a, z_a), (hw, y_a, z_a), (hw, y_b, z_b), (-hw, y_b, z_b),
                   'wall_sub', full_rect=False, double_sided=True)
    # Side cheeks closing both ends of curved blue canopy
    for sgn in (-1.0, 1.0):
        sx = sgn * hw
        b.box(sx, 3.45, 1.12, 0.12, 0.88, 2.15, 'wall_sub')
    # Vertical dark metallic panel joint ribs along the curved bullnose!
    if b.detail:
        for ri in range(11):
            rx = -hw + 0.7 + ri * ((2 * hw - 1.4) / 10.0)
            b.box(rx, 3.55, 2.18, 0.06, 0.74, 0.22, 'black_led')

    # Sloped Carved Tan Stone Key-Fret Frieze Band ('石刻纹样带', y = 4.32 .. 4.82, z = 2.12 -> 1.48!)
    n_fret = 6
    fw = (2 * hw) / n_fret
    for fi in range(n_fret):
        fx0 = -hw + fi * fw
        fx1 = fx0 + fw
        b.add_quad((fx0, 4.32, 2.12), (fx1, 4.32, 2.12), (fx1, 4.84, 1.48), (fx0, 4.84, 1.48),
                   'sign_emblem', full_rect=True)

    # White rectangular school signboard + left circular school crest (y = 4.84 .. 6.08, z = 1.42)
    b.box(0.0, 4.84, 1.12, 2 * hw - 0.2, 1.26, 0.62, 'white', cap_region='white')
    b.sign(0.75, 5.47, 1.46, 9.6, 1.12, 'sign_gate')
    # Circular crest on left end of signboard (seen in ref [10]!)
    b.box(-4.85, 4.88, 1.45, 1.35, 1.35, 0.14, 'wall_sub')
    b.box(-4.85, 5.04, 1.52, 1.02, 1.02, 0.12, 'white')

    # 2nd-floor circular landscape window ('圆洞窗') directly above signboard (signature in ref [10]!)
    b.box(-0.6, 6.75, 0.08, 2.15, 2.15, 0.22, 'white')
    b.box(-0.6, 6.95, 0.14, 1.65, 1.65, 0.22, 'glass')

    # Street sidewalk granite approach apron
    b.box(0.0, -0.45, 2.2, 2 * hw + 2.0, 0.50, 4.8, 'pave_dark', cap_region='pave_grey')
    b.pose = old


def _zhishan_portico_and_frieze(b: SchoolBuilder):
    """Exact ceremonial south portico of 至善楼 facing the sports field (refs [01], [02], [12], [13]):
    - Wide solid ground-floor colonnade portico with outer white columns + cobalt-blue bases ('白柱蓝础')
      and inner warm-tan fluted columns ('暖棕竖纹方柱') + stepped grey granite stairs
    - 2F white frieze beam inscribed with ink hills + red seal + '最美的山水 最好的自己'
    - Red-text black LED banner under portico beam + large black LED screen on 2F gallery above!
    """
    old = b.pose
    # Bridge & portico centered along the south front of 至善楼 at (30.5, -33.2), facing South (+Z, yaw=0)
    b.pose = (30.5, 0.0, -33.2, 0.0)
    y0 = 0.05
    pw = 17.6

    # Solid 4-storey recessed gallery connector behind portico + shaded colonnade recess!
    b.box(0.0, y0, -2.5, pw + 1.2, 13.5, 3.4, 'win_wall', cap_region='roof_tile', collide=True)
    b.box(0.0, y0 + 0.58, -0.65, pw - 1.2, 3.65, 0.35, 'pave_dark')
    b.box(0.0, y0 + 0.85, -0.42, 7.6, 2.85, 0.18, 'cinnabar')  # festive stage backdrop inside portico (refs [01], [12])

    # Stepped grey granite entrance stairs (5 wide steps, ref [01]!)
    for st in range(4):
        b.box(0.0, y0 + st * 0.14, 2.8 - st * 0.38, pw + 0.8, 0.15, 1.8 + st * 0.35, 'pave_dark', cap_region='pave_grey')
    # Raised portico floor platform
    b.box(0.0, y0, 0.4, pw + 0.6, 0.58, 3.6, 'pave_dark', cap_region='cinnabar', collide=True)

    # Outer white square columns with cobalt-blue lower bases ('白柱配蓝础', refs [02], [13]!)
    for sx in (-7.8, -4.6, 4.6, 7.8):
        b.box(sx, y0 + 0.58, 1.85, 0.72, 1.25, 0.72, 'wall_sub', collide=True)
        b.box(sx, y0 + 1.83, 1.85, 0.68, 2.45, 0.68, 'white', collide=True)

    # Inner pair of warm-tan fluted square ceremonial columns ('暖棕方柱', refs [01], [02], [12], [13]!)
    for sx in (-2.65, 2.65):
        b.box(sx, y0 + 0.58, 1.95, 0.74, 3.70, 0.74, 'wall_accent', collide=True)

    # Portico ceiling soffit + red-text black LED banner underneath ('南溪山小学...', refs [01], [12]!)
    b.box(0.0, y0 + 4.25, 0.55, pw + 1.0, 0.42, 3.8, 'white', cap_region='white')
    b.box(0.0, y0 + 3.68, 1.72, 6.2, 0.56, 0.24, 'black_led')
    b.sign(0.0, y0 + 3.96, 1.86, 5.9, 0.48, 'sign_led')

    # Signature white 2F calligraphic frieze ('最美的山水 [印] 最好的自己', refs [01], [02], [12], [13]!)
    b.box(0.0, y0 + 4.67, 1.65, 14.6, 1.48, 0.75, 'white', cap_region='white')
    b.sign(0.0, y0 + 5.42, 2.06, 13.8, 1.28, 'sign_motto')

    # 2F-4F open balcony frame + black metal railings + large black LED screen on 2F (refs [01], [12], [13]!)
    b.box(0.0, y0 + 6.35, 1.15, 5.2, 2.75, 0.28, 'black_led')
    for fl_y in (6.15, 9.65):
        b.box(0.0, y0 + fl_y, 0.35, pw + 0.8, 0.26, 2.6, 'white')
        for sx in (-7.8, -3.9, 3.9, 7.8):
            b.box(sx, y0 + fl_y + 0.26, 1.45, 0.46, 3.25, 0.46, 'white')
        if b.detail:
            # Dark iron balcony railings on left & right bays (seen clearly in ref [12]!)
            for rx_b in (-5.85, 5.85):
                b.box(rx_b, y0 + fl_y + 1.15, 1.48, 3.4, 0.07, 0.08, 'black_led')
                b.box(rx_b, y0 + fl_y + 0.35, 1.48, 3.4, 0.06, 0.08, 'black_led')
                for k in range(7):
                    b.box(rx_b - 1.5 + k * 0.5, y0 + fl_y + 0.35, 1.48, 0.05, 0.82, 0.06, 'black_led')
    b.hip_roof_rect(30.5, y0 + 13.2, -33.8, pw + 1.2, 5.2, yaw=0.0, rise=1.45, overhang=0.55, tile_region='roof_tile')
    b.pose = old


def build_nanxishan(b: SchoolBuilder):
    # 1. Full campus granite paving across way/1037119966 (zero bare dirt)
    b.prism(RING, -1.6, 1.65, 'pave_dark', cap_region='pave_grey', collide=False)

    # 2. Perimeter fence (skip edge 2 where the street-front gatehouse building OV_GATEHOUSE forms the wall!)
    b.perimeter_fence(RING, gate_edge=2, gate_t0=0.02, gate_t1=0.98, wall_h=2.25)

    # 3. Exact Overture Building Footprints (offset 0.00 m, angle diff 0.0 deg!)
    # (1) West street-front archway gatehouse (69c30fe2) facing 中山南路 40 号
    b.footprint_building(OV_GATEHOUSE, name='西临街穿堂门楼', source_id='overture/69c30fe2',
                         floors=4, floor_h=3.40, roof='flat',
                         base_floors=1, use_base_tex=False,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.5)
    _nanxishan_gate_canopy(b)

    # (2) 至善楼北教学组团 (bd5989c4 + b32c8f05 + e525b5e9) with pitched dark slate-grey roofs & portico
    b.footprint_building(OV_ZHISHAN_N, name='至善楼北翼', source_id='overture/bd5989c4',
                         floors=4, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=False,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.5)
    b.footprint_building(OV_ZHISHAN_S, name='至善楼东讲堂翼', source_id='overture/b32c8f05',
                         floors=4, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=False,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.4)
    b.footprint_building(OV_ZHISHAN_W, name='至善楼西翼', source_id='overture/e525b5e9',
                         floors=4, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=False,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.4)
    _zhishan_portico_and_frieze(b)

    # (3) South teaching wings: 书香楼 (99e11acf) & 博艺楼 (5f7711c6) with dark-grey pitched roofs (ref [22]!)
    b.footprint_building(OV_SHUXIANG, name='书香楼', source_id='overture/99e11acf',
                         floors=4, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.5)
    b.footprint_building(OV_BOYI, name='博艺楼', source_id='overture/5f7711c6',
                         floors=4, floor_h=3.45, roof='hip',
                         base_floors=1, use_base_tex=True,
                         parapet_reg='white', top_parapet_reg='white', bay_target_m=3.4)

    # (4) Small campus annexes on exact Overture footprints
    b.footprint_building(OV_ANNEX_SE, name='东南校园辅房', source_id='overture/4e89c64e',
                         floors=2, floor_h=3.20, roof='hip',
                         base_floors=1, use_base_tex=True, parapet_reg='white')
    b.footprint_building(OV_ANNEX_NW, name='北侧校园辅房', source_id='overture/a02f9d94',
                         floors=2, floor_h=3.20, roof='hip',
                         base_floors=1, use_base_tex=True, parapet_reg='white')

    # 4. Central Sports Field matching ref [22] & ref [19]:
    # Terracotta-red oval running track + terracotta-red infield apron + TWO end-to-end light sky-blue
    # synthetic basketball courts with terracotta-red painted keys & center circles — ZERO green grass!
    b.running_track(-2.0, 8.0, length=74.0, width=37.0, yaw=0.0,
                    y0=0.07, track_reg='track_red', infield_mode='red_apron')
    for court_cx in (-16.2, 12.2):
        b.basketball_court(court_cx, 8.0, yaw=0.0, w=24.6, d=13.8,
                           surface='court_a', apron=None, key_reg='track_red', y0=0.225)
        # Terracotta-red center jump circle matching ref [22]!
        b.cylinder_y(court_cx, 0.268, 0.025, 8.0, 1.65, 'track_red', cap_region='track_red', segs=12)

    # Stepped red-granite flagpole dais at East end of track (exact match to ref [19]!)
    b.flagpole_plaza(40.5, 8.0, yaw=-math.pi * 0.5, y0=0.06, with_motto_wall=False)

    # Lush camphor trees flanking 至善楼 & southern perimeter (refs [12], [19], [22])
    b.tree(14.5, -27.5, scale=1.22, seed=501)
    b.tree(45.5, -25.0, scale=1.12, seed=509)
    b.green_strip(-48.0, 32.0, w=3.8, d=24.0, yaw=0.0, trees=3, seed=521)
    b.green_strip(32.0, 48.0, w=22.0, d=3.8, yaw=0.0, trees=3, seed=537)


if __name__ == '__main__':
    export_school_glb('nanxishan_primary', PALETTE, SIGNS, build_nanxishan, seed=202605)
