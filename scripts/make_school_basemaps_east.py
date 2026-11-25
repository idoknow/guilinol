"""Generate clean, accurate OSM evidence basemaps for IDOK-82 schools using Pillow.

Strictly adheres to Standard A (口径 A):
- Exact OSM boundary polygon as red boundary line
- Exact OSM/Overture building footprints labeled B1..Bn
- OSM pitch/track elements only
- School gate location (closed gate, plaque only)
- Zero forbidden keywords (no 教学, 宿舍, 实验, 图书, 办公, 食堂, etc.)
"""
from ops_evidence import require_evidence
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

# Add pipeline to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
from common import load_osm, ll2xz

osm = {f"{el['type']}/{el['id']}": el for el in load_osm()}

def get_poly(wid):
    el = osm.get(wid)
    if not el or 'geometry' not in el:
        return None
    return [ll2xz(n['lat'], n['lon']) for n in el['geometry']]

def font(size):
    for path in (
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()

out_dir = require_evidence('layout/schools')
out_dir.mkdir(parents=True, exist_ok=True)

class MapCanvas:
    def __init__(self, bounds, width=1200, height=900, pad=40):
        self.w = width
        self.h = height
        minx, minz, maxx, maxz = bounds
        spanx = max(1.0, maxx - minx)
        spanz = max(1.0, maxz - minz)
        scale = min((width - pad * 2) / spanx, (height - pad * 2) / spanz)
        self.scale = scale
        self.cx = (minx + maxx) * 0.5
        self.cz = (minz + maxz) * 0.5
        self.img = Image.new('RGB', (width, height), (32, 36, 44))
        self.draw = ImageDraw.Draw(self.img)

    def xz2px(self, x, z):
        px = self.w * 0.5 + (x - self.cx) * self.scale
        pz = self.h * 0.5 + (z - self.cz) * self.scale
        return (px, pz)

    def draw_poly(self, pts, fill=None, outline=None, width=1):
        if not pts: return
        coords = [self.xz2px(x, z) for x, z in pts]
        if fill:
            self.draw.polygon(coords, fill=fill)
        if outline:
            self.draw.polygon(coords, outline=outline, width=width)

    def draw_text(self, x, z, text, col=(240, 240, 240), size=14):
        f = font(size)
        px, pz = self.xz2px(x, z)
        bbox = f.getbbox(text)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        self.draw.text((px - tw * 0.5, pz - th * 0.5), text, fill=col, font=f)

    def draw_star(self, x, z, col=(236, 201, 75), r=8):
        px, pz = self.xz2px(x, z)
        self.draw.ellipse((px - r, pz - r, px + r, pz + r), fill=col, outline=(255, 255, 255), width=2)

    def draw_header(self, title, subtitle):
        self.draw.rectangle((0, 0, self.w, 48), fill=(24, 28, 35))
        f_title = font(18)
        self.draw.text((20, 12), title, fill=(255, 255, 255), font=f_title)
        f_sub = font(12)
        self.draw.text((self.w - 480, 16), subtitle, fill=(160, 174, 192), font=f_sub)

    def draw_footer(self, text):
        self.draw.rectangle((0, self.h - 32, self.w, self.h), fill=(24, 28, 35))
        f = font(12)
        self.draw.text((20, self.h - 24), text, fill=(148, 163, 184), font=f)

    def save(self, path):
        self.img.save(path, optimize=True)


# 1. 桂林医科大学（东城校区）
def gen_glmu():
    b_pts = get_poly('way/627526148')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 15, min(zs) - 15, max(xs) + 15, max(zs) + 15)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('桂林医科大学（东城校区） — 校园平面布局与OSM基线要素底图', 'OSM校界: way/627526148')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # 400m Stadium
    s_pts = get_poly('way/672634658')
    if s_pts:
        c.draw_poly(s_pts, fill=(47, 133, 90), outline=(39, 103, 73), width=2)
        sx = sum(p[0] for p in s_pts) / len(s_pts)
        sz = sum(p[1] for p in s_pts) / len(s_pts)
        c.draw_text(sx, sz, '400m田径场', col=(255, 255, 255), size=13)

    # Ball Courts
    courts = ['way/671760725', 'way/671760840', 'way/671763132', 'way/672638634', 'way/672638635']
    for i, wid in enumerate(courts):
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=(49, 130, 206), outline=(43, 108, 176), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, f'球场{i+1}', col=(255, 255, 255), size=10)

    # OSM Buildings
    bldgs = [
        ('way/459580291', 'B1 (6F)'),
        ('way/671760495', 'B2 (7F)'),
        ('way/671790070', 'B3 (6F)'),
        ('way/672633239', 'B4 (6F)'),
        ('way/672633244', 'B5 (6F)'),
        ('way/672633246', 'B6 (6F)'),
        ('way/672633248', 'B7 (6F)'),
        ('way/672633249', 'B8 (4F)'),
        ('way/672633251', 'B9 (6F)'),
        ('way/672633450', 'B10 (5F)'),
        ('way/672633451', 'B11 (5F)'),
        ('way/672659167', 'B12 (3F)'),
        ('way/672659168', 'B13 (3F)'),
    ]
    for wid, label in bldgs:
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, label, col=(16, 42, 67), size=10)

    # Gate on Huancheng North 2nd Rd
    gx, gz = 666.45, -1687.64
    c.draw_star(gx, gz)
    c.draw_text(gx + 30, gz - 15, '校门: 环城北二路正门 (常闭门型)', col=(236, 201, 75), size=12)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门')
    c.save(out_dir / 'glmu_dongcheng-basemap.png')
    print('Generated glmu_dongcheng-basemap.png')

# 2. 桂林理工大学附属小学 (glut_primary)
def gen_glut():
    b_pts = get_poly('way/473969804')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 10, min(zs) - 10, max(xs) + 10, max(zs) + 10)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('桂林理工大学附属小学 — 校园平面布局与OSM基线要素底图', 'OSM校界: way/473969804')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # Pitches
    for wid, label, col in [('way/692355778', '排球场', (47, 133, 90)), ('way/692355777', '篮球场', (49, 130, 206))]:
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=col, outline=(39, 103, 73), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, label, col=(255, 255, 255), size=11)

    # Buildings
    anchor_x, anchor_z = 979.45, -385.83
    # B1: Overture 253e76b1-cafd-4077-adca-ae60ae8f7c7b
    b1_local = [(36.47, -36.54), (-9.36, -49.73), (-21.52, -8.0), (24.32, 5.17)]
    b1_pts = [(anchor_x + x, anchor_z + z) for x, z in b1_local]
    c.draw_poly(b1_pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
    cx = sum(p[0] for p in b1_pts) / len(b1_pts)
    cz = sum(p[1] for p in b1_pts) / len(b1_pts)
    c.draw_text(cx, cz, 'B1 (4F)', col=(16, 42, 67), size=12)

    bldgs = [
        ('way/473969842', 'B2 (3F)'),
        ('way/473969841', 'B3 (2F)'),
        ('way/692355779', 'B4 (1F)'),
    ]
    for wid, label in bldgs:
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, label, col=(16, 42, 67), size=11)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门')
    c.save(out_dir / 'glut_primary-basemap.png')
    print('Generated glut_primary-basemap.png')


# 3. 桂林市田家炳中学 (tianjiabing)
def gen_tianjiabing():
    b_pts = get_poly('way/658142453')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 10, min(zs) - 10, max(xs) + 10, max(zs) + 10)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('桂林市田家炳中学 — 校园平面布局与OSM基线要素底图', 'OSM校界: way/658142453')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # Buildings (Overture footprints)
    anchor_x, anchor_z = 1076.26, -1041.03
    ov_tjb = [(-7.69, 65.2), (-26.77, 65.48), (-26.64, 75.01), (13.65, 74.42), (13.3, 50.07), (-28.05, 50.66), (-27.85, 64.43), (-7.71, 64.14)]
    ov_gym = [(-69.86, 49.1), (-38.04, 49.13), (-37.99, -2.76), (-69.81, -2.79)]
    ov_blds = [
        ([(120.38, -29.99), (120.46, -38.46), (93.96, -38.73), (93.87, -30.26)], 'B3 (4F)'),
        ([(80.98, -11.59), (79.58, 6.33), (103.5, 8.19), (104.9, -9.74)], 'B4 (5F)'),
        ([(63.01, -58.22), (62.49, -47.75), (43.01, -48.72), (42.12, -30.78), (70.57, -29.35), (72.0, -57.77)], 'B5 (5F)'),
        ([(52.15, -50.22), (61.29, -55.6), (54.82, -66.55), (45.69, -61.16)], 'B6 (3F)'),
        ([(75.26, -13.35), (34.8, -14.76), (34.44, -4.27), (74.9, -2.87)], 'B7 (5F)'),
        ([(34.37, -35.66), (33.75, -44.1), (10.49, -42.41), (11.1, -33.96)], 'B8 (4F)'),
        ([(54.09, 99.72), (56.8, 94.26), (39.59, 85.7), (36.89, 91.16)], 'B9 (2F)'),
        ([(3.67, -43.05), (-6.93, -43.16), (-7.05, -32.57), (3.56, -32.47)], 'B10 (3F)'),
        ([(-26.56, -21.86), (-26.59, -15.5), (0.98, -15.39), (1.01, -21.74)], 'B11 (3F)'),
        ([(-13.94, -31.38), (-13.6, -41.96), (-26.32, -42.36), (-26.65, -31.77)], 'B12 (3F)'),
        ([(-73.77, -11.62), (-46.2, -11.67), (-46.23, -28.62), (-73.8, -28.57)], 'B13 (4F)'),
        ([(-54.84, -44.8), (-54.64, -54.53), (-69.95, -54.61), (-69.95, -45.1)], 'B14 (3F)'),
    ]

    for poly, label in [(ov_tjb, 'B1 (5F)'), (ov_gym, 'B2 (3F)')] + ov_blds:
        pts = [(anchor_x + x, anchor_z + z) for x, z in poly]
        c.draw_poly(pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        c.draw_text(cx, cz, label, col=(16, 42, 67), size=10)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门 (OSM无pitch要素，不画球场)')
    c.save(out_dir / 'tianjiabing-basemap.png')
    print('Generated tianjiabing-basemap.png')


# 4. 桂林市辰山小学 (chenshan_primary)
def gen_chenshan():
    b_pts = get_poly('way/671777304')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 10, min(zs) - 10, max(xs) + 10, max(zs) + 10)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('桂林市辰山小学 — 校园平面布局与OSM基线要素底图', 'OSM校界: way/671777304')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # Buildings
    bldgs = [
        ('way/1475475421', 'B1 (4F/5F)'),
        ('way/1475475422', 'B2 (2F)'),
    ]
    for wid, label in bldgs:
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, label, col=(16, 42, 67), size=12)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门 (OSM无pitch要素，不画球场)')
    c.save(out_dir / 'chenshan_primary-basemap.png')
    print('Generated chenshan_primary-basemap.png')


# 5. 漓江小学 (lijiang_primary)
def gen_lijiang():
    b_pts = get_poly('way/1563350367')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 10, min(zs) - 10, max(xs) + 10, max(zs) + 10)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('漓江小学 — 校园平面布局与OSM基线要素底图', 'OSM校界: way/1563350367')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # Note: No OSM/Overture buildings or pitches
    cx = sum(p[0] for p in b_pts) / len(b_pts)
    cz = sum(p[1] for p in b_pts) / len(b_pts)
    c.draw_text(cx, cz - 10, '校园绿化与铺装空间', col=(160, 174, 192), size=14)
    c.draw_text(cx, cz + 15, '(OSM/Overture内无建筑轮廓与场地要素)', col=(120, 134, 152), size=11)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门 (无OSM楼栋及场地，不虚构补建)')
    c.save(out_dir / 'lijiang_primary-basemap.png')
    print('Generated lijiang_primary-basemap.png')


# 6. 龙隐小学 (longyin_primary)
def gen_longyin():
    b_pts = get_poly('way/1027048356')
    xs = [p[0] for p in b_pts]
    zs = [p[1] for p in b_pts]
    bounds = (min(xs) - 15, min(zs) - 15, max(xs) + 15, max(zs) + 15)
    c = MapCanvas(bounds, 1200, 900)
    c.draw_header('桂林市龙隐小学 — 校园平面布局与OSM基线要素底图', 'OSM校界: way/1027048356')

    # Boundary
    c.draw_poly(b_pts, fill=(42, 48, 60), outline=(239, 68, 68), width=3)

    # Pitches
    track_pts = get_poly('way/1474986237')
    if track_pts:
        c.draw_poly(track_pts, fill=(40, 120, 80), outline=(16, 185, 129), width=1)
        cx = sum(p[0] for p in track_pts) / len(track_pts)
        cz = sum(p[1] for p in track_pts) / len(track_pts)
        c.draw_text(cx, cz, '足球场 (sport=soccer)', col=(255, 255, 255), size=11)

    court_pts = get_poly('way/1474986236')
    if court_pts:
        c.draw_poly(court_pts, fill=(40, 120, 80), outline=(16, 185, 129), width=1)
        cx = sum(p[0] for p in court_pts) / len(court_pts)
        cz = sum(p[1] for p in court_pts) / len(court_pts)
        c.draw_text(cx, cz, '篮球场', col=(255, 255, 255), size=12)

    # Buildings
    bldgs = [
        ('way/1488495381', 'B1 (4F)'),
        ('way/1488495382', 'B2 (3F)'),
        ('way/1488495383', 'B3 (4F)'),
        ('way/1488495384', 'B4 (4F)'),
        ('way/1488495385', 'B5 (3F)'),
        ('way/1488495386', 'B6 (4F)'),
        ('way/1488495387', 'B7 (2F)'),
        ('way/1488495388', 'B8 (4F)'),
    ]
    for wid, label in bldgs:
        pts = get_poly(wid)
        if pts:
            c.draw_poly(pts, fill=(217, 226, 236), outline=(16, 42, 67), width=1)
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            c.draw_text(cx, cz, label, col=(16, 42, 67), size=11)

    # Overture buildings
    anchor_x, anchor_z = 905.52, 1052.41
    ov_b3f9 = [(-10.59, -22.36), (3.81, -25.91), (1.32, -36.16), (-13.29, -32.6)]
    ov_cb0f = [(5.81, -28.27), (19.32, -31.15), (16.73, -42.16), (3.33, -39.29)]
    for rel_pts, label in [(ov_b3f9, 'OV1 (3F)'), (ov_cb0f, 'OV2 (3F)')]:
        pts = [(anchor_x + x, anchor_z + z) for x, z in rel_pts]
        c.draw_poly(pts, fill=(200, 215, 230), outline=(16, 42, 67), width=1)
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        c.draw_text(cx, cz, label, col=(16, 42, 67), size=10)

    c.draw_footer('口径 A 安全边界: 0门卫 0闸机 0监控 无室内 常闭校门 (严格按OSM/Overture要素与场地)')
    c.save(out_dir / 'longyin_primary-basemap.png')
    print('Generated longyin_primary-basemap.png')


if __name__ == '__main__':
    gen_glmu()
    gen_glut()
    gen_tianjiabing()
    gen_chenshan()
    gen_lijiang()
    gen_longyin()
