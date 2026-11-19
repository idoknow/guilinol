"""Usage: python scripts/market-review-sheets.py CAPTURE ESRI_RGB"""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'pipeline'))
from common import xz2ll

capture = Path(sys.argv[1])
rgb = Image.open(sys.argv[2]).convert('RGB')
layout = root / 'docs/layout'
grid = json.loads((layout / 'dongxi-esri-grid.json').read_text())
scale = 256 * 2**grid['zoom']


def pixel(lon, lat):
    return ((lon + 180) * scale / 360 - grid['pixel_origin'][0],
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * scale / 2 - grid['pixel_origin'][1])


plan = Image.new('RGB', rgb.size, '#ddd8c9')
pen = ImageDraw.Draw(plan)
for source, color in [('layout', '#62594f'), ('infill', '#866644')]:
    for feature in json.loads((layout / f'dongxi-{source}.geojson').read_text())['features']:
        coords = feature['geometry']['coordinates']
        kind = feature['properties']['kind']
        if kind in ('roof', 'mall'):
            for index, ring in enumerate(coords):
                pen.polygon([pixel(*pt) for pt in ring], fill=color if not index else '#ddd8c9', outline='white')
        elif kind == 'lane':
            pen.line([pixel(*pt) for pt in coords], fill='#209694', width=3)
for area, x, z, altitude, shot in [('west', -610, -150, 360, 'plan'), ('east', -472, -171, 444, 'east-plan')]:
    half = (altitude - 157.7) * math.tan(math.radians(27.5))
    crop = (*pixel(*reversed(xz2ll(x-half,z-half))), *pixel(*reversed(xz2ll(x+half,z+half))))
    sheet = Image.new('RGB', (1800, 640), '#eceae3')
    for index, (pic, label) in enumerate([(plan.crop(crop), 'Registered + infill'), (Image.open(capture / (shot+'.jpg')), 'Game'), (rgb.crop(crop), 'Esri World Imagery')]):
        sheet.paste(pic.resize((600,600)), (600*index,40))
        ImageDraw.Draw(sheet).text((600*index+8,12), area.upper()+' | '+label, fill='black')
    sheet.save(capture / (area+'.jpg'), quality=92)
for batch, numbers in [('entrances', [f'Y{i:02}' for i in range(1,9)]), ('street', ['05', *map(str,range(14,21))])]:
    pages = []
    for number in numbers:
        estimated = number.startswith('Y')
        path = root/'docs/refs/rock'/('walk-dongxi-xiaoyao-jiefang' if estimated else 'walk-shizijie-wangcheng')
        page = Image.new('RGB', (1280,560), '#eeeae2')
        for index, file in enumerate([next(path.glob(number[-2:]+'_*.jpg')),capture/(number+'.jpg')]):
            pic = ImageOps.contain(Image.open(file), (640,510))
            page.paste(pic,(640*index+(640-pic.width)//2,40+(510-pic.height)//2))
            ImageDraw.Draw(page).text((640*index+8,12), number+' | '+('Rock' if not index else 'Game (estimated pose)' if estimated else 'Game'), fill='black')
        pages.append(page)
    pages[0].save(capture/(batch+'.pdf'),save_all=True,append_images=pages[1:],quality=87)
