"""Render the old-city school basemaps from the same geometry as the GLBs."""
import importlib
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'pipeline'), str(ROOT / 'pipeline/landmarks')]
from mapped_school import layout, markings, sources
from features import polygons

SCHOOLS = ('kuiguang_school', 'guilin_middle', 'libin_middle', 'ronghu_primary',
           'minzhu_primary', 'zhonghua_primary')
OUTPUT = ROOT / 'docs/layout/schools'
SPORTS = {'basketball': '篮球场', 'volleyball': '排球场', 'soccer': '足球场',
          'running': '跑步场地', 'athletics': '跑道'}


def render(module):
    boundary, buildings, sports = layout(module)
    minx, minz, maxx, maxz = boundary.bounds
    scale = min(884 / (maxx-minx), 460 / (maxz-minz))
    image = Image.new('RGB', (960, 600), '#f4f3ee')
    draw = ImageDraw.Draw(image)

    def points(ring):
        return [(480 + (x-(maxx+minx)/2)*scale, 303 + (z-(maxz+minz)/2)*scale)
                for x, z in ring.coords]

    def fill(shape, color):
        mask = Image.new('1', image.size)
        layer = ImageDraw.Draw(mask)
        for part in polygons(shape):
            layer.polygon(points(part.exterior), fill=1)
            for hole in part.interiors:
                layer.polygon(points(hole), fill=0)
        image.paste(color, mask=mask)

    fill(boundary, '#dedbd2')
    for shape, _ in buildings:
        fill(shape, '#929ba0')
    for _, sport, shape in sports:
        color = '#af5f52' if sport in ('running', 'athletics') else '#54856b'
        fill(shape, color)
        for stripe in markings(shape, sport):
            fill(stripe, '#ffffff')

    font_paths = ('/System/Library/Fonts/Hiragino Sans GB.ttc',
                  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
    font_path = next((p for p in font_paths if Path(p).exists()), None)
    font = ImageFont.truetype(font_path, 25) if font_path else ImageFont.load_default()
    name = sources()[2][module.SCHOOL]['name']
    draw.text((30, 14), f'{name} · OSM / Overture', font=font, fill='#20302b')
    draw.text((30, 550), '灰色  楼栋       绿色  球场       砖红  跑步场地', font=font, fill='#20302b')
    dest = OUTPUT / module.SCHOOL
    image.save(dest.with_name(dest.name+'-basemap.png'))
    rows = [f'# {name}', '', f'OSM 校界 `{module.BOUNDARY}`。', '', '## 楼栋', '']
    for _, style in buildings:
        rows.append(f"- {style['bid']} · `{style['source_id']}` · {style['floors']} 层")
    rows.extend(['', '## 运动场地', ''])
    rows.extend(f'- {SPORTS[sport]} · `{key}`' for key, sport, _ in sports)
    if not sports:
        rows.append('本地 OSM 快照在校界内未标注 pitch 或 track。')
    if hasattr(module, 'STREET_SETBACK'):
        rows.extend(['', '临街几何沿用项目的道路退距，以保留人行道和车道净空。'])
    rows.extend(['', '## 推断', '',
                 '层数、高低关系、屋顶、配色、绿化和临街门型沿用游戏概化风格。场地画线为示意。', '',
                 f'![OSM 与 Overture 概化底图]({module.SCHOOL}-basemap.png)', ''])
    dest.with_suffix('.md').write_text('\n'.join(rows))


if __name__ == '__main__':
    for school in SCHOOLS:
        render(importlib.import_module(school))
