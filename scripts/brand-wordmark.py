"""Build the title-screen wordmark 「桂林」 from Ma Shan Zheng outlines (IDOK-468).

The page never loads the calligraphy font: the two glyphs are traced once into a single SVG path and used as a CSS mask
(`.home-h1-city` in web/src/ui/home.css; colour comes from currentColor, the h1 text stays 「网上桂林」).
「桂」 sits high, 「林」 a little lower and to the right, slightly overlapping it — tune DX / DY / LIN_SCALE below.
Output:
  web/src/ui/home-wordmark.svg   viewBox in 1/1000 em, one <path>, no fill (mask reads alpha), 2-unit margin
Prints W, H and W/H; put W/H into `--wm-ratio` on `.home-title`.

Font: Ma Shan Zheng (马善政体), SIL Open Font License 1.1 — not committed. Fetch it to the default path:
  https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf
  → node_modules/.cache/fonts/MaShanZheng-Regular.ttf  (or pass another path as argv[1])
Run: python3 scripts/brand-wordmark.py   (needs `pip install fonttools`)
"""
import math
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

DX = 0.84         # 「林」 horizontal offset from 「桂」, em
DY = 0.16         # 「林」 drop below 「桂」, em
LIN_SCALE = 0.96  # 「林」 scale, about the centre of its em box
EM = 1000         # output units per em
PAD = 2           # margin around the merged bounds, output units

root = Path(__file__).resolve().parents[1]
font_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'node_modules/.cache/fonts/MaShanZheng-Regular.ttf'
out_path = root / 'web/src/ui/home-wordmark.svg'

font = TTFont(font_path)
upm = font['head'].unitsPerEm
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()

def glyph(ch):
    name = cmap.get(ord(ch))
    if name is None:
        sys.exit(f'{font_path.name} has no glyph for {ch}')
    return glyphs[name]

gui, lin = glyph('桂'), glyph('林')

# Font units, y up → output units, y down: (x, y) → (s·x, −s·y)
s = EM / upm
hhea = font['hhea']
cx = lin.width * s / 2                       # em-box centre of 「林」, after the flip
cy = -(hhea.ascent + hhea.descent) * s / 2
k = LIN_SCALE
t_gui = (s, 0, 0, -s, 0, 0)
t_lin = (k * s, 0, 0, -k * s, cx * (1 - k) + DX * EM, cy * (1 - k) + DY * EM)

# Merged bounds of both transformed glyphs
bounds = []
for g, t in ((gui, t_gui), (lin, t_lin)):
    bp = BoundsPen(glyphs)
    g.draw(TransformPen(bp, t))
    if bp.bounds:
        bounds.append(bp.bounds)
x0 = min(b[0] for b in bounds); y0 = min(b[1] for b in bounds)
x1 = max(b[2] for b in bounds); y1 = max(b[3] for b in bounds)

# Shift so the bounds' top-left lands on (PAD, PAD); integers at 1/1000 em are plenty
tx, ty = PAD - x0, PAD - y0
W = math.ceil(x1 - x0) + 2 * PAD
H = math.ceil(y1 - y0) + 2 * PAD

def shifted(t):
    xx, xy, yx, yy, dx, dy = t
    return (xx, xy, yx, yy, dx + tx, dy + ty)

pen = SVGPathPen(glyphs, ntos=lambda v: str(round(v)))
for g, t in ((gui, t_gui), (lin, t_lin)):
    g.draw(TransformPen(pen, shifted(t)))

out_path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><path d="{pen.getCommands()}"/></svg>\n')
print(f'{out_path.relative_to(root)}  W={W} H={H} W/H={W / H:.3f}')
