"""Derive site icons and logo images from docs/brand/logo-source.jpg (member-designed pixel logo, IDOK-148).

The source is a 500×500 JPEG on white. Outputs (PNG, page images WebP; white made pure so CSS `mix-blend-mode:multiply`
lets the page colour show through):
  public/brand/logo.webp        full logo (emblem + 网上桂林 + GUI LIN Online), tight crop
  public/brand/emblem.webp      emblem only (象山/城/江), for the title screen
  public/favicon-32.png         mountain + cave close-up on white tile (tab icon)
  public/apple-touch-icon.png   180, full logo
  public/brand/icon-192.png / icon-512.png        manifest "any"
  public/brand/icon-maskable-512.png              manifest "maskable" (logo inside the 80 % safe zone)
Run: python3 scripts/brand-logo.py
"""
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

full = tight((69, 140, 434, 419), 6)
emblem = tight((69, 140, 432, 276), 4)
mountain = clean.crop((168, 136, 372, 276))

out = root / 'public/brand'
out.mkdir(parents=True, exist_ok=True)
full.save(out / 'logo.webp', quality=90, method=6)
emblem.save(out / 'emblem.webp', quality=90, method=6)
square(full, 192, .92).save(out / 'icon-192.png', optimize=True)
square(full, 512, .92).save(out / 'icon-512.png', optimize=True)
square(full, 512, .74).save(out / 'icon-maskable-512.png', optimize=True)
square(full, 180, .9).save(root / 'public/apple-touch-icon.png', optimize=True)
square(mountain, 32, 1.0).save(root / 'public/favicon-32.png', optimize=True)
square(mountain, 64, 1.0).save(out / 'favicon-64.png', optimize=True)
print('ok')
