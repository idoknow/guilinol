"""Derive site icons and logo images from docs/brand/logo-source.jpg (member-designed pixel logo, IDOK-148).

The source is a 500×500 JPEG on white. Outputs (PNG, page images WebP; white made pure so CSS `mix-blend-mode:multiply`
lets the page colour show through):
  public/brand/logo.webp        full logo (emblem + 网上桂林 + GUI LIN Online), tight crop
  public/brand/emblem.webp      emblem only (象山/城/江), white tile (About page designer card)
  public/brand/emblem-clear.webp  emblem with the outer white cut to transparent (title-screen 落款, IDOK-468);
                                only white connected to the edge goes, the cave wall's whites stay
  public/favicon-32.png         mountain + cave close-up on white tile (tab icon)
  public/apple-touch-icon.png   180, full logo
  public/brand/icon-192.png / icon-512.png        manifest "any"
  public/brand/icon-maskable-512.png              manifest "maskable" (logo inside the 80 % safe zone)
Run: python3 scripts/brand-logo.py
"""
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

root = Path(__file__).resolve().parents[1]
src = Image.open(root / 'docs/brand/logo-source.jpg').convert('RGB')
a = np.asarray(src).astype(np.int16)
# JPEG haze around the white background → pure white (keeps the cave wall's light blues/greys, which sit below 236)
a[(a.min(2) >= 236)] = 255
clean = Image.fromarray(a.astype(np.uint8))

def tight(box, pad):
    x0, y0, x1, y1 = box
    return clean.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))

def square(img, size, fill_ratio, bg=(255, 255, 255)):
    w, h = img.size
    s = fill_ratio * size / max(w, h)
    im = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    out = Image.new('RGB', (size, size), bg)
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return out

def clear_outer_white(img, floor=228, chroma=22):
    """Flood-fill near-white from the border to transparent; light pixels on the cut edge fade out (no white halo)."""
    im = img.convert('RGBA'); w, h = im.size; px = im.load()
    def white(c): return min(c[:3]) >= floor and max(c[:3]) - min(c[:3]) <= chroma
    bg = set(); q = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in bg or not white(px[x, y]): continue
        bg.add((x, y)); q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    for x, y in bg: px[x, y] = (0, 0, 0, 0)
    for y in range(h):
        for x in range(w):
            if (x, y) in bg: continue
            r, g, b, _ = px[x, y]
            if min(r, g, b) > 200 and any(n in bg for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                px[x, y] = (r, g, b, int(255 * (255 - min(r, g, b)) / 55))
    return im.crop(im.getbbox())

full = tight((69, 140, 434, 419), 6)
emblem = tight((69, 140, 432, 276), 4)
mountain = clean.crop((168, 136, 372, 276))

out = root / 'public/brand'
out.mkdir(parents=True, exist_ok=True)
full.save(out / 'logo.webp', quality=90, method=6)
emblem.save(out / 'emblem.webp', quality=90, method=6)
clear_outer_white(emblem).save(out / 'emblem-clear.webp', quality=88, alpha_quality=100, method=6)
square(full, 192, .92).save(out / 'icon-192.png', optimize=True)
square(full, 512, .92).save(out / 'icon-512.png', optimize=True)
square(full, 512, .74).save(out / 'icon-maskable-512.png', optimize=True)
square(full, 180, .9).save(root / 'public/apple-touch-icon.png', optimize=True)
square(mountain, 32, 1.0).save(root / 'public/favicon-32.png', optimize=True)
square(mountain, 64, 1.0).save(out / 'favicon-64.png', optimize=True)
print('ok')
