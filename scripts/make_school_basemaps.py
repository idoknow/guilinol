"""Generate clean, accurate OSM evidence basemaps for IDOK-82 schools using Pillow.

Strictly adheres to Standard A (口径 A):
- Exact OSM boundary polygon as red boundary line
- Exact OSM/Overture building footprints labeled B1..Bn
- OSM pitch/track elements only
- School gate location (closed gate, plaque only)
- Zero forbidden keywords (no 教学, 宿舍, 实验, 图书, 办公, 食堂, etc.)
"""
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

out_dir = Path(__file__).resolve().parents[1] / 'docs/layout/schools'
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

if __name__ == '__main__':
    gen_glmu()
