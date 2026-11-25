#!/usr/bin/env python3
"""
Generate photorealistic, physically weathered 96-shop (8x12) Guilin signboard atlases
+ 16-blade (8x2) pier sign atlas for Guilin Online City Upgrade v1+.

Visual Standards (locked from IDOK-385 v1+ acceptance):
  - 12 sun-faded, low-saturation hue families x 8 unique original Guilin shops = 96 designs
  - Global 20% neutral-gray saturation governor on every signboard substrate
    (compensates engine gradeDay 1.22x saturation boost -> zero electric neon!)
  - 3 realistic substrates: 'gusset' (铝扣板竖缝), 'acp' (哑光铝塑板接缝), 'acrylic' (灯箱布雨渍旧化)
  - Top eave AO shadow + 3D mounted channel-letter multi-pass drop shadow + balanced night emissiveMap
  - Rendered per-tile at 512x256 and supersampled (LANCZOS) to 384x192 -> 3072x2304 (8x12) atlas
    for razor-sharp anti-aliased Chinese typography & mobile-safe WebGL2 VRAM footprint!
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from sign_catalog import BLADE_SPECS, FASCIA_SPECS, check_trademark_compliance

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "public/city-upgrade"

LED_TICKERS = (
    "欢迎光临 · 桂林品质老店 · 营业中",
    "地道桂林风味 · 欢迎进店选购",
    "新鲜现做 · 诚信经营 · 欢迎光临",
    "桂林老字号风味 · 营业中",
)


def load_font(size: int, style: str = "sans"):
    pools = {
        "sans": [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
        ],
        "serif": [
            "/System/Library/Fonts/Supplemental/Songti.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ],
        "brush": [
            "/System/Library/Fonts/Supplemental/Kaiti.ttc",
            "/System/Library/Fonts/Supplemental/Songti.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ],
    }
    for p in pools.get(style, pools["sans"]):
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_w: int, max_size: int, style: str = "sans", min_size: int = 16):
    for sz in range(max_size, min_size - 1, -2):
        f = load_font(sz, style)
        bbox = draw.textbbox((0, 0), text, font=f)
        if bbox[2] - bbox[0] <= max_w:
            return f
    return load_font(min_size, style)


def hex_to_rgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)], dtype=np.float32)


def make_substrate(cw: int, ch: int, bg_hex: str, substrate: str, seed: int) -> Image.Image:
    """Create a physically believable Chinese shop signboard substrate (sun-weathered, 20% saturation cap)."""
    rng = np.random.default_rng(seed)
    base = hex_to_rgb(bg_hex)
    # Global saturation governor: blend 20% neutral luma to offset gradeDay 1.22x saturation boost
    luma = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]
    base = base * 0.80 + np.array([luma, luma, luma], dtype=np.float32) * 0.20
    arr = np.broadcast_to(base[None, None, :], (ch, cw, 3)).copy()
    yy, xx = np.mgrid[0:ch, 0:cw]

    # Top eave overhang contact shadow + subtle bottom bounce AO
    top_ao = 1.0 - 0.16 * np.exp(-yy / 22.0)
    bot_ao = 1.0 - 0.08 * np.exp(-(ch - 1 - yy) / 14.0)
    arr *= (top_ao * bot_ao)[:, :, None]

    if substrate == "gusset":
        # Real Chinese 铝扣板 vertical strips (16px wide ribs with soft bevel & seam groove)
        phase = (xx % 16) / 16.0
        rib = 0.96 + 0.06 * np.sin(phase * np.pi)
        seam = (xx % 16) == 0
        arr *= rib[:, :, None]
        arr[seam] *= 0.80
    elif substrate == "acp":
        # Matte aluminum-composite panel with fine vertical panel joints every 128px + brushed micrograin
        joint = ((xx % 128) < 2) & (xx > 10) & (xx < cw - 10)
        grain = rng.normal(0.0, 2.2, (ch, cw, 1)).astype(np.float32)
        arr += grain
        arr[joint] *= 0.84
    else:
        # Backlit acrylic / flex cloth lightbox: soft edge vignette + gentle organic aging
        vx = (xx / cw - 0.5) * 2.0
        vy = (yy / ch - 0.5) * 2.0
        vig = 1.0 - 0.08 * (vx * vx + vy * vy)
        noise = rng.normal(0.0, 2.8, (ch, cw, 1)).astype(np.float32)
        arr = arr * vig[:, :, None] + noise

    # Subtle top-edge rainwater dust streaks (authentic humid Guilin climate)
    streak_freq = rng.uniform(0.0, 1.0, cw)
    streak_smooth = np.convolve(streak_freq, np.ones(9) / 9.0, mode="same")
    rain = (streak_smooth[None, :] ** 2.2) * np.exp(-yy / 42.0) * 0.14
    arr *= (1.0 - rain[:, :, None])

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def render_fascias(out_dir: Path, cols: int = 8, rows: int = 12, out_cw: int = 384, out_ch: int = 192, preview_path: Path | None = None):
    count = cols * rows
    specs = FASCIA_SPECS[:count]
    assert len(specs) == count, f"Need {count} specs for {cols}x{rows}, have {len(specs)}"

    # Render each tile at native 512x256 (locked v1+ pixel art proportions) then LANCZOS supersample
    CW, CH = 512, 256
    alb = Image.new("RGB", (cols * out_cw, rows * out_ch), (38, 40, 44))
    emit = Image.new("RGB", (cols * out_cw, rows * out_ch), (0, 0, 0))

    for idx, (key, _hue, substrate, bg, fg, accent, title, sub, mode, fstyle, glow, _pref_h, _zones) in enumerate(specs):
        col, row = idx % cols, idx // cols
        x0, y0 = col * out_cw, row * out_ch

        tile = make_substrate(CW, CH, bg, substrate, 8800 + idx * 31)
        da = ImageDraw.Draw(tile)

        # Brushed aluminum outer mounting trim (6px so supersampled border stays >=4px crisp)
        da.rectangle([0, 0, CW - 1, CH - 1], outline=(58, 62, 66), width=6)
        da.line([(0, 0), (CW - 1, 0)], fill=(28, 30, 34), width=3)
        da.line([(0, CH - 1), (CW - 1, CH - 1)], fill=(24, 26, 30), width=3)

        if mode == "box":
            da.rectangle([12, 12, CW - 13, CH - 13], outline=accent, width=3)
        elif mode == "minimal":
            da.line([(38, CH - 28), (CW - 38, CH - 28)], fill=accent, width=2)
        elif mode == "seal":
            da.rectangle([12, 12, CW - 13, CH - 13], outline=accent, width=2)
            da.ellipse([26, 52, 98, 124], fill=accent, outline=fg, width=2)
            sf = load_font(36, "brush")
            da.text((62, 88), title[0], fill="#F8F2E4", font=sf, anchor="mm")
        elif mode == "split":
            da.rectangle([CW - 108, 6, CW - 7, CH - 7], fill=accent)
            da.rectangle([12, 12, CW - 13, CH - 13], outline="#EFECE4", width=2)
        elif mode == "banner":
            da.rectangle([10, CH - 50, CW - 11, CH - 10], fill=fg)
            bf = load_font(20, "sans")
            da.text((CW // 2, CH - 30), sub, fill="#FFF8E8", font=bf, anchor="mm")
        elif mode == "led":
            da.rectangle([12, 12, CW - 13, CH - 52], outline=accent, width=2)
            da.rectangle([12, CH - 46, CW - 13, CH - 12], fill=(22, 16, 16), outline=(64, 66, 70), width=2)
            lf = load_font(18, "sans")
            da.text((CW // 2, CH - 29), LED_TICKERS[idx % len(LED_TICKERS)], fill="#E24A3C", font=lf, anchor="mm")

        tx_left = 112 if mode == "seal" else 26
        tx_right = CW - 118 if mode == "split" else CW - 26
        tx_cx = (tx_left + tx_right) // 2
        max_tw = tx_right - tx_left

        title_y = 92 if mode in ("led", "banner") else 104
        sub_y = 160 if mode == "led" else 186

        ft = fit_font(da, title, max_tw, 62, fstyle)
        fs = fit_font(da, sub, max_tw + 8, 22, "sans")

        # 3D mounted channel-letter multi-pass drop shadow
        da.text((tx_cx + 3, title_y + 4), title, fill=(14, 14, 16), font=ft, anchor="mm")
        da.text((tx_cx + 1, title_y + 2), title, fill=(24, 24, 28), font=ft, anchor="mm")
        da.text((tx_cx, title_y), title, fill=fg, font=ft, anchor="mm")

        if mode != "banner":
            sub_fill = accent if mode in ("minimal", "box") else fg
            if sub_fill.lower() == bg.lower():
                sub_fill = fg
            da.text((tx_cx + 1, sub_y + 1), sub, fill=(18, 18, 20), font=fs, anchor="mm")
            da.text((tx_cx, sub_y), sub, fill=sub_fill, font=fs, anchor="mm")

        # Balanced night emissive plate (toned down so Chinese letters stay razor sharp with zero whiteout!)
        em_full = Image.new("RGB", (CW, CH), (0, 0, 0))
        inner = tile.crop((10, 10, CW - 10, CH - 10))
        em_tile = inner.point(lambda p, g=glow * 0.85: int(min(255, p * g)))
        em_full.paste(em_tile, (10, 10))

        if (out_cw, out_ch) != (CW, CH):
            tile_out = tile.resize((out_cw, out_ch), Image.Resampling.LANCZOS)
            em_out = em_full.resize((out_cw, out_ch), Image.Resampling.LANCZOS)
        else:
            tile_out = tile
            em_out = em_full

        alb.paste(tile_out, (x0, y0))
        emit.paste(em_out, (x0, y0))

    alb_path = out_dir / "shop-fascias.webp"
    emit_path = out_dir / "shop-fascias-emit.webp"
    alb.save(alb_path, quality=88, method=4)
    emit.save(emit_path, quality=84, method=4)
    if preview_path:
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        alb.resize((1536, int(1536 * alb.height / alb.width)), Image.Resampling.LANCZOS).save(preview_path, quality=90)
    print(
        f"Generated {count}-shop ({cols}x{rows}, {alb.width}x{alb.height}) atlases:\n"
        f"  {alb_path.name:24s}: {alb_path.stat().st_size / 1024:.1f} KB\n"
        f"  {emit_path.name:24s}: {emit_path.stat().st_size / 1024:.1f} KB"
    )


def render_blades(out_dir: Path):
    COLS, ROWS = 8, 2
    CW, CH = 128, 512
    img = Image.new("RGB", (COLS * CW, ROWS * CH), (34, 36, 40))
    for idx, (bg, fg, border, text) in enumerate(BLADE_SPECS):
        col, row = idx % COLS, idx // COLS
        x0, y0 = col * CW, row * CH
        tile = make_substrate(CW, CH, bg, "acrylic", 9900 + idx * 17)
        draw = ImageDraw.Draw(tile)
        draw.rectangle([0, 0, CW - 1, CH - 1], outline=(52, 56, 60), width=5)
        draw.rectangle([8, 8, CW - 9, CH - 9], outline=border, width=3)
        n = len(text)
        f = load_font(52 if n <= 4 else 44, "sans")
        step = (CH - 60) / max(1, n)
        for ci, ch in enumerate(text):
            cy = int(30 + step * (ci + 0.5))
            draw.text((CW // 2 + 2, cy + 2), ch, fill=(16, 16, 18), font=f, anchor="mm")
            draw.text((CW // 2, cy), ch, fill=fg, font=f, anchor="mm")
        img.paste(tile, (x0, y0))
    blade_path = out_dir / "shop-blades.webp"
    img.save(blade_path, quality=90, method=4)
    print(f"  {blade_path.name:24s}: {blade_path.stat().st_size / 1024:.1f} KB ({COLS}x{ROWS}, {img.width}x{img.height})")


def main():
    ap = argparse.ArgumentParser(description="Generate Guilin City Upgrade v1+ signboard atlases.")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--grid", choices=("8x8", "8x12"), default="8x12", help="Fascia atlas grid (default: 8x12 = 96 shops)")
    ap.add_argument("--cell-size", choices=("384x192", "512x256"), default="384x192")
    ap.add_argument("--preview", type=Path, default=Path("/tmp/city-upgrade-96-fascias-sheet.jpg"))
    args = ap.parse_args()

    violations = check_trademark_compliance()
    if violations:
        raise SystemExit("Trademark / catalog compliance FAILED:\n  - " + "\n  - ".join(violations))

    cols, rows = map(int, args.grid.split("x"))
    cw, ch = map(int, args.cell_size.split("x"))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    render_fascias(args.out_dir, cols=cols, rows=rows, out_cw=cw, out_ch=ch, preview_path=args.preview)
    render_blades(args.out_dir)


if __name__ == "__main__":
    main()
