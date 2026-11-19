"""Report symmetric roof disagreement within the replacement polygon on the Esri grid."""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture', type=Path)
parser.add_argument('--rgb', type=Path, help='optional Esri mosaic on the reference grid')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
folder = root / 'docs/layout'
grid = json.loads((folder / 'dongxi-esri-grid.json').read_text())
reference = np.asarray(Image.open(folder / 'dongxi-esri-mask.png').convert('1'))
render = np.asarray(Image.open(args.capture / 'roof-mask.png').convert('L')) >= 128
height, width = reference.shape
assert reference.shape == render.shape
scale = 256 * 2**grid['zoom']


def pixel(lon, lat):
    return ((lon + 180) * scale / 360 - grid['pixel_origin'][0],
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) * scale / 2 - grid['pixel_origin'][1])


market = next(item for item in json.loads((root / 'pipeline/landmarks.json').read_text()) if item['id'] == 'wangcheng_market')
area = Image.new('1', (width, height))
ImageDraw.Draw(area).polygon([pixel(*point) for point in market['replace']['polygon']], fill=1)
inside = np.asarray(area)
east = np.arange(width) >= pixel(110.2941688, 25.2821368)[0]
base = Image.open(args.rgb).convert('RGB') if args.rgb else Image.new('RGB', area.size, '#858585')
assert base.size == area.size
results = {}
for name, region in [('all', inside), ('west', inside & ~east), ('east', inside & east)]:
    missing = region & reference & ~render
    extra = region & render & ~reference
    total = int(region.sum())
    mismatch = (int(missing.sum()) + int(extra.sum())) / total
    results[name] = dict(total_pixels=total, missing=int(missing.sum()), extra=int(extra.sum()), xor=mismatch)
    if name == 'all':
        continue
    picture = np.asarray(base).copy() // 2
    picture[region] = np.asarray(base)[region]
    picture[missing] = [255, 75, 40]
    picture[extra] = [20, 195, 248]
    pic = Image.fromarray(picture).crop(Image.fromarray(region).getbbox())
    sheet = Image.new('RGB', (max(700, pic.width), pic.height + 48), '#17222a')
    sheet.paste(pic, (0, 48))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 4), f'{name.upper()} | Esri / game roof XOR: {mismatch:.2%} of {total:,} pixels', fill='white')
    draw.text((8, 24), f'ORANGE: missing {missing.sum():,}     CYAN: extra {extra.sum():,}     RGB: agreement', fill='white')
    sheet.save(args.capture / f'difference-{name}.png')
print(json.dumps(results, indent=2))
if results['all']['xor'] > .15:
    raise SystemExit(1)
