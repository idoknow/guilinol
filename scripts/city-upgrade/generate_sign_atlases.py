#!/usr/bin/env python3
"""
Generate high-definition 4:1 anti-stretch, 2x SSAA Guilin signboard atlases
(6x16 = 96 fascias @ 640x160 -> 3840x2560 RGB) + 16 vertical blade signs
(8x2 @ 128x512 -> 1024x1024 RGB) with >=20 industry vector icons & WCAG contrast lock.

Visual Standards (IDOK-471 / IDOK-472):
  - 6 cols x 16 rows = 96 fascias, exact 4.0:1 cell ratio (640x160 final, rendered at
    1280x320 2x SSAA then LANCZOS downsampled) matching physical 3.56-6.20m x 0.92-1.24m
    storefronts with ZERO horizontal stretching.
  - 12 sun-faded, low-saturation hue families x 8 unique original Guilin shops = 96 designs.
  - Global 20% neutral-gray saturation governor on every substrate (offsets gradeDay 1.22x).
  - 3 tactile substrates: 'gusset' (铝扣板竖缝), 'acp' (哑光铝塑板接缝), 'acrylic' (灯箱布微旧化).
  - 6 asymmetric commercial layouts: left_hero, split_tag, heritage_seal, led_ticker,
    luxury_frame, duotone_banner — every single tile features a crisp multi-primitive
    vector industry icon emblem from sign_icons.py.
  - Strict WCAG 2.1 contrast enforcement (>= 4.5:1 for titles, subtitles, LED tickers & tags).
  - Physically differentiated night emissiveMap: backlit acrylic boxes glow evenly without
    whiteout; metal acp/gusset fascias glow brightly on letters, icons, trims & LED bars.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from sign_catalog import BLADE_SPECS, FASCIA_SPECS, check_trademark_compliance
from sign_icons import (
    RGB,
    blend_rgb,
    contrast_ratio,
    desaturate_rgb,
    hex_to_rgb_tuple,
    relative_luminance,
    render_industry_icon,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "public/city-upgrade"

LED_TICKERS_FOOD = (
    "欢迎光临 · 桂林地道老味 · 营业中 · 0773",
    "新鲜现做 · 招牌必点 · 堂食打包",
    "现煮现炒 · 诚信老店 · 欢迎品尝",
    "桂林本地风味 · 晚间照常营业",
)
LED_TICKERS_SERVICE = (
    "欢迎光临 · 当季新品上新 · 进店选购 · 0773",
    "品质优选 · 贴心服务 · 欢迎进店体验",
    "邻里口碑好店 · 每日正常营业",
)
FOOD_ICON_TYPES = frozenset({"noodle", "food", "bakery", "dessert", "tea", "coffee", "fruit"})

LUXURY_ANCHORS: dict[str, tuple[str, str, str]] = {
    "coffee":     ("COFFEE",  "08:30-22:00", "手冲精品"),
    "flower":     ("FLORAL",  "GUILIN",      "花艺美学"),
    "salon":      ("SALON",   "STUDIO",      "形象定制"),
    "fashion":    ("ATELIER", "GUILIN",      "质感裁剪"),
    "bakery":     ("BAKERY",  "FRESH",       "手作烘焙"),
    "books":      ("BOOKS",   "09:00-22:00", "静心阅读"),
    "hotel_home": ("HOTEL",   "24H",         "江畔雅居"),
    "food":       ("CRAFT",   "18:00-02:00", "晚间小酌"),
    "digital":    ("PHOTO",   "GUILIN",      "山水纪实"),
}


# ---------------------------------------------------------------------------
# Crisp Simplified Chinese + Latin Font Loader (exact macOS TTC weight indices)
# ---------------------------------------------------------------------------
FONT_CANDIDATES: dict[str, list[tuple[str, int]]] = {
    "sans": [
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),       # Hiragino Sans GB W6 (Bold)
        ("/System/Library/Fonts/STHeiti Medium.ttc", 1),         # Heiti SC Medium
        ("/System/Library/Fonts/PingFang.ttc", 2),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 2),
    ],
    "sans_med": [
        ("/System/Library/Fonts/STHeiti Medium.ttc", 1),         # Heiti SC Medium
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ],
    "serif": [
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 1),    # Songti SC Bold
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),    # Songti SC Black
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),
    ],
    "brush": [
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),    # Songti SC Black (sculptural plaque weight)
        ("/System/Library/Fonts/Supplemental/Songti.ttc", 1),
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),
    ],
    "latin": [
        ("/System/Library/Fonts/Avenir Next.ttc", 0),            # Avenir Next Bold
        ("/System/Library/Fonts/HelveticaNeue.ttc", 1),          # Helvetica Neue Bold
        ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),
    ],
}


@lru_cache(maxsize=512)
def load_font(size: int, style: str = "sans") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path_str, idx in FONT_CANDIDATES.get(style, FONT_CANDIDATES["sans"]):
        p = Path(path_str)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size, index=idx)
            except Exception:
                try:
                    return ImageFont.truetype(str(p), size)
                except Exception:
                    continue
    return ImageFont.load_default()


def fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_w: int,
    max_size: int,
    style: str = "sans",
    min_size: int = 20,
):
    for sz in range(max_size, min_size - 1, -4):
        f = load_font(sz, style)
        bbox = draw.textbbox((0, 0), text, font=f)
        if bbox[2] - bbox[0] <= max_w:
            return f
    return load_font(min_size, style)


# ---------------------------------------------------------------------------
# WCAG 2.1 Color Contrast Guards (exact color resolution shared with verifier)
# ---------------------------------------------------------------------------
def effective_bg_rgb(bg_hex: str) -> RGB:
    """Exact desaturated substrate RGB matching make_substrate() 20% neutral-gray cap."""
    return desaturate_rgb(hex_to_rgb_tuple(bg_hex), 0.20)


def ensure_wcag_fg(candidate_rgb: RGB, bg_rgb: RGB, min_ratio: float = 4.8) -> RGB:
    """Nudge a foreground color cleanly toward cream-white or deep-charcoal if contrast < min_ratio."""
    if contrast_ratio(candidate_rgb, bg_rgb) >= min_ratio:
        return candidate_rgb
    bg_luma = relative_luminance(bg_rgb)
    target = (250, 248, 242) if bg_luma < 0.30 else (24, 22, 20)
    for step in range(1, 21):
        c = blend_rgb(candidate_rgb, target, step / 20.0)
        if contrast_ratio(c, bg_rgb) >= min_ratio:
            return c
    return target


def resolve_tile_palette(bg_hex: str, fg_hex: str, accent_hex: str, mode: str) -> dict[str, RGB]:
    """
    Deterministic, WCAG-locked color palette for a fascia tile.
    Shared by renderer and verify_sign_atlases.py so specs & rendered pixels agree 100%.
    """
    eff_bg = effective_bg_rgb(bg_hex)
    bg_luma = relative_luminance(eff_bg)
    raw_fg = hex_to_rgb_tuple(fg_hex)
    raw_acc = hex_to_rgb_tuple(accent_hex)

    title_fg = ensure_wcag_fg(raw_fg, eff_bg, min_ratio=5.2)

    # Subtitle on main substrate: higher readability floor on dark boards (>= 6.2) so shade stays crisp
    sub_floor = 6.2 if bg_luma < 0.28 else 5.0
    if contrast_ratio(raw_acc, eff_bg) >= sub_floor:
        sub_fg = raw_acc
    else:
        sub_fg = ensure_wcag_fg(blend_rgb(raw_acc, title_fg, 0.62), eff_bg, min_ratio=sub_floor)

    # Decorative accent line/frame color (crisp visibility against board)
    if contrast_ratio(raw_acc, eff_bg) >= 2.6:
        decor = raw_acc
    else:
        decor = blend_rgb(raw_acc, title_fg, 0.55)

    # Contrasting panel background (for split_tag right panel & duotone_banner left block / ribbon)
    panel_bg = desaturate_rgb(raw_acc, 0.16)
    p_luma = relative_luminance(panel_bg)
    # Keep panels clearly dark (L <= 0.16) or clearly light (L >= 0.48) so panel text is ultra crisp
    if 0.16 < p_luma < 0.48:
        if bg_luma >= 0.32:
            # On light boards, deepen contrast panel for bold anchor
            panel_bg = blend_rgb(panel_bg, (28, 28, 32), 0.42)
        else:
            # On dark boards, either brighten to warm champagne/gold or deepen distinctly
            if p_luma >= 0.28:
                panel_bg = blend_rgb(panel_bg, (242, 224, 176), 0.45)
            else:
                panel_bg = blend_rgb(panel_bg, (24, 24, 30), 0.35)
    # Ensure panel separates visibly from main board
    if contrast_ratio(panel_bg, eff_bg) < 1.55:
        panel_bg = (232, 212, 158) if bg_luma < 0.22 else (42, 46, 52)
    panel_fg = ensure_wcag_fg(
        (250, 247, 238) if relative_luminance(panel_bg) < 0.25 else (26, 24, 22),
        panel_bg,
        min_ratio=5.5,
    )

    # LED bar colors (for led_ticker)
    led_bg = (20, 18, 18)
    led_fg = (255, 194, 72) if (bg_luma < 0.25 and raw_fg[0] > 210 and raw_fg[1] > 180) else (255, 114, 96)
    led_fg = ensure_wcag_fg(led_fg, led_bg, min_ratio=6.5)

    # Heritage vermilion/gold chop stamp (for heritage_seal far-right decorative chop)
    chop_bg = desaturate_rgb((148, 38, 32) if bg_luma >= 0.22 else (178, 52, 44), 0.14)
    chop_fg = ensure_wcag_fg((250, 244, 232), chop_bg, min_ratio=5.2)

    return {
        "eff_bg": eff_bg,
        "title_fg": title_fg,
        "sub_fg": sub_fg,
        "decor": decor,
        "panel_bg": panel_bg,
        "panel_fg": panel_fg,
        "led_bg": led_bg,
        "led_fg": led_fg,
        "chop_bg": chop_bg,
        "chop_fg": chop_fg,
    }


# ---------------------------------------------------------------------------
# Tactile Chinese Shop Substrate Generator (20% saturation governor + weathering)
# ---------------------------------------------------------------------------
def make_substrate(cw: int, ch: int, bg_hex: str, substrate: str, seed: int) -> Image.Image:
    """Create a physically believable sun-weathered Guilin signboard substrate at 2x SSAA."""
    rng = np.random.default_rng(seed)
    base = np.array(effective_bg_rgb(bg_hex), dtype=np.float32)
    yy = np.arange(ch, dtype=np.float32)
    xx = np.arange(cw, dtype=np.float32)

    # Top eave overhang contact shadow + subtle bottom bounce AO (1D broadcast -> fast!)
    top_ao = 1.0 - 0.14 * np.exp(-yy / max(18.0, ch * 0.088))
    bot_ao = 1.0 - 0.06 * np.exp(-(ch - 1 - yy) / max(12.0, ch * 0.056))
    v_shade = (top_ao * bot_ao)[:, None]

    # Subtle top-edge humid Guilin rainwater dust streaks
    streak_freq = rng.uniform(0.0, 1.0, cw).astype(np.float32)
    kernel = np.ones(15, dtype=np.float32) / 15.0
    streak_smooth = np.convolve(streak_freq, kernel, mode="same").astype(np.float32)
    rain_y = np.exp(-yy / max(24.0, ch * 0.115))[:, None]
    rain_x = ((streak_smooth ** 2.4) * 0.095)[None, :]
    shade2d = v_shade * (1.0 - rain_y * rain_x)

    if substrate == "gusset":
        # Authentic Chinese 铝扣板 vertical aluminum strips (28px pitch at 1280px -> 14px final)
        pitch = max(14, int(round(cw / 46.0)))
        phase = (xx % pitch) / float(pitch)
        rib = (0.97 + 0.045 * np.sin(phase * np.pi)).astype(np.float32)
        rib[(xx % pitch) < 2] *= 0.85
        shade2d *= rib[None, :]
        arr = shade2d[:, :, None] * base[None, None, :]
    elif substrate == "acp":
        # Matte aluminum-composite panels with fine vertical seam joints + brushed grain
        panel_w = max(96, cw // 5)
        h_mul = np.ones(cw, dtype=np.float32)
        joint = ((xx % panel_w) < 3) & (xx > 16) & (xx < cw - 16)
        h_mul[joint] = 0.86
        shade2d *= h_mul[None, :]
        grain = rng.standard_normal((ch, cw, 1), dtype=np.float32) * 1.8
        arr = shade2d[:, :, None] * base[None, None, :] + grain
    else:
        # Backlit acrylic / flex lightbox: gentle corner vignette + organic grain
        vx = (xx / max(1, cw) - 0.5) * 2.0
        vy = (yy / max(1, ch) - 0.5) * 2.0
        vig = 1.0 - 0.055 * (vx[None, :] ** 2 + vy[:, None] ** 2)
        shade2d *= vig
        noise = rng.standard_normal((ch, cw, 1), dtype=np.float32) * 2.0
        arr = shade2d[:, :, None] * base[None, None, :] + noise

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------------------
# 3D Channel Letter & Emissive Drawing Helpers
# ---------------------------------------------------------------------------
def draw_channel_text(
    albedo_draw: ImageDraw.ImageDraw,
    emit_draw: ImageDraw.ImageDraw,
    pos: tuple[int, int],
    text: str,
    font,
    fill: RGB,
    bg_ref: RGB,
    anchor: str = "lm",
    shadow_depth: int = 5,
    emit_gain: float = 0.88,
):
    """Draw crisp 3D mounted channel lettering onto albedo + matching sharp emissive pass."""
    x, y = pos
    bg_luma = relative_luminance(bg_ref)
    if shadow_depth > 0:
        if bg_luma < 0.30:
            # Dark fascia: deep multi-pass cast drop shadow for extruded 3D feel
            sh_far = (10, 11, 14)
            sh_near = (18, 20, 24)
            albedo_draw.text((x + shadow_depth, y + shadow_depth + 1), text, fill=sh_far, font=font, anchor=anchor)
            if shadow_depth >= 4:
                albedo_draw.text((x + max(2, shadow_depth // 2), y + max(2, shadow_depth // 2)), text, fill=sh_near, font=font, anchor=anchor)
        else:
            # Light fascia: clean subtle grounded contact shadow so dark text stays razor-sharp
            sh_soft = blend_rgb(bg_ref, (22, 20, 18), 0.24)
            albedo_draw.text((x + max(2, shadow_depth - 2), y + max(2, shadow_depth - 1)), text, fill=sh_soft, font=font, anchor=anchor)

    albedo_draw.text((x, y), text, fill=fill, font=font, anchor=anchor)

    # Sharp foreground glow onto emissive layer (dark text stays crisp dark silhouette on lit panels)
    fg_luma = relative_luminance(fill)
    if fg_luma >= 0.20:
        ef = tuple(int(min(238, round(c * emit_gain))) for c in fill)
        emit_draw.text((x, y), text, fill=ef + (255,), font=font, anchor=anchor)
    else:
        ef = tuple(int(round(c * 0.55)) for c in fill)
        emit_draw.text((x, y), text, fill=ef + (235,), font=font, anchor=anchor)


def icon_box_for_mode(mode: str, cw: int, ch: int) -> tuple[int, int, int]:
    """Return (cx, cy, icon_size) on the 2x SSAA canvas for each layout mode."""
    if mode == "led_ticker":
        return (int(cw * 0.115), int(ch * 0.388), int(ch * 0.56))  # 179px @ 1280x320
    if mode == "split_tag":
        return (int(cw * 0.110), int(ch * 0.500), int(ch * 0.61))  # 195px @ 1280x320
    if mode == "duotone_banner":
        return (int(cw * 0.106), int(ch * 0.500), int(ch * 0.62))  # Optical center inside slanted left trapezoid!
    if mode == "heritage_seal":
        return (int(cw * 0.125), int(ch * 0.500), int(ch * 0.62))  # 198px @ 1280x320
    if mode == "luxury_frame":
        return (int(cw * 0.126), int(ch * 0.500), int(ch * 0.60))  # 192px @ 1280x320
    # left_hero
    return (int(cw * 0.120), int(ch * 0.500), int(ch * 0.63))      # 202px @ 1280x320


def draw_heritage_corners(draw: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, color: RGB, arm: int = 28, w: int = 4):
    """Crisp Chinese architectural stepped corner brackets (回纹角饰)."""
    step = arm // 2
    # Top-left
    draw.line([(x0, y0 + arm), (x0, y0), (x0 + arm, y0)], fill=color, width=w)
    draw.line([(x0 + step, y0 + step), (x0 + arm, y0 + step)], fill=color, width=max(2, w - 1))
    draw.line([(x0 + step, y0 + step), (x0 + step, y0 + arm)], fill=color, width=max(2, w - 1))
    # Top-right
    draw.line([(x1 - arm, y0), (x1, y0), (x1, y0 + arm)], fill=color, width=w)
    draw.line([(x1 - arm, y0 + step), (x1 - step, y0 + step), (x1 - step, y0 + arm)], fill=color, width=max(2, w - 1))
    # Bottom-left
    draw.line([(x0, y1 - arm), (x0, y1), (x0 + arm, y1)], fill=color, width=w)
    draw.line([(x0 + step, y1 - arm), (x0 + step, y1 - step), (x0 + arm, y1 - step)], fill=color, width=max(2, w - 1))
    # Bottom-right
    draw.line([(x1 - arm, y1), (x1, y1), (x1, y1 - arm)], fill=color, width=w)
    draw.line([(x1 - arm, y1 - step), (x1 - step, y1 - step), (x1 - step, y1 - arm)], fill=color, width=max(2, w - 1))


# ---------------------------------------------------------------------------
# Main 96-Shop 4:1 Fascia Atlas Renderer (2x SSAA 1280x320 -> 640x160)
# ---------------------------------------------------------------------------
def render_single_fascia(idx: int, spec, cw: int = 1280, ch: int = 320) -> tuple[Image.Image, Image.Image]:
    """Render one 4:1 fascia tile + its balanced night emissive plate at 2x SSAA."""
    (
        _key, _hue, substrate, bg_hex, fg_hex, accent_hex,
        title, sub, mode, fstyle, glow, _pref_h, _zones, icon_type, badge_tag,
    ) = spec

    pal = resolve_tile_palette(bg_hex, fg_hex, accent_hex, mode)
    eff_bg = pal["eff_bg"]
    title_fg = pal["title_fg"]
    sub_fg = pal["sub_fg"]
    decor = pal["decor"]
    panel_bg = pal["panel_bg"]
    panel_fg = pal["panel_fg"]

    tile = make_substrate(cw, ch, bg_hex, substrate, 8800 + idx * 37)
    da = ImageDraw.Draw(tile)
    # Dedicated RGBA foreground emissive overlay for crisp channel letters & glowing emblems
    fg_emit = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    de = ImageDraw.Draw(fg_emit, "RGBA")

    # Determine icon center & size
    icx, icy, isize = icon_box_for_mode(mode, cw, ch)
    icon_bg_ref = panel_bg if mode == "duotone_banner" else eff_bg

    # Helper to draw a night-safe top-right capsule pill (fills light bg into fg_emit so dark text never vanishes!)
    def draw_capsule_pill(text_s: str, right_x: int, top_y: int, pill_h: int, outline_col: RGB) -> int:
        tf = fit_font(da, text_s, 236, 25, "latin" if text_s.isascii() else "sans_med", min_size=18)
        tb = da.textbbox((0, 0), text_s, font=tf)
        pw = (tb[2] - tb[0]) + 34
        px0 = right_x - pw
        da.rounded_rectangle([px0, top_y, right_x, top_y + pill_h], radius=10, fill=panel_bg, outline=outline_col, width=2)
        da.text((px0 + pw // 2, top_y + pill_h // 2), text_s, fill=panel_fg, font=tf, anchor="mm")
        # Night emissive: if panel_bg is light (dark text), light the capsule backdrop cleanly so text stays legible!
        if relative_luminance(panel_bg) >= 0.25:
            ebg = tuple(int(min(210, round(c * 0.80))) for c in panel_bg)
            de.rounded_rectangle([px0, top_y, right_x, top_y + pill_h], radius=10, fill=ebg + (230,), outline=outline_col + (185,), width=2)
            etx = tuple(int(round(c * 0.55)) for c in panel_fg)
            de.text((px0 + pw // 2, top_y + pill_h // 2), text_s, fill=etx + (240,), font=tf, anchor="mm")
        else:
            ebg = tuple(int(round(c * 0.48)) for c in panel_bg)
            de.rounded_rectangle([px0, top_y, right_x, top_y + pill_h], radius=10, fill=ebg + (190,), outline=outline_col + (180,), width=2)
            de.text((px0 + pw // 2, top_y + pill_h // 2), text_s, fill=panel_fg + (225,), font=tf, anchor="mm")
        return px0

    # ── Mode-specific asymmetric background panels & structural framing ──
    if mode == "left_hero":
        # Clean inner hairline frame + crisp vertical divider + top-right tag pill
        da.rectangle([20, 20, cw - 21, ch - 21], outline=decor, width=3)
        da.rectangle([274, 58, 282, 262], fill=decor)
        de.rectangle([274, 58, 282, 262], fill=decor + (180,))

        tx0 = 314
        tx1 = cw - 48
        if badge_tag:
            pill_x0 = draw_capsule_pill(badge_tag, tx1, 36, 44, decor)
            title_max_w = (pill_x0 - 44) - tx0
        else:
            title_max_w = tx1 - tx0

        ft = fit_font(da, title, max(440, title_max_w), 108, fstyle, min_size=54)
        fs = fit_font(da, sub, tx1 - tx0, 40, "sans_med", min_size=26)
        draw_channel_text(da, de, (tx0, 122), title, ft, title_fg, eff_bg, anchor="lm", shadow_depth=5, emit_gain=0.90)
        # Sleek full-width hairline divider between title & subtitle
        da.line([(tx0, 192), (tx1 - 12, 192)], fill=decor, width=2)
        de.line([(tx0, 192), (tx1 - 12, 192)], fill=decor + (155,), width=2)
        draw_channel_text(da, de, (tx0, 236), sub, fs, sub_fg, eff_bg, anchor="lm", shadow_depth=3, emit_gain=0.82)

    elif mode == "split_tag":
        # Right high-contrast vertical utility column (x = 964..cw-14)
        split_x = int(cw * 0.755)
        split_poly = [(split_x + 18, 12), (cw - 13, 12), (cw - 13, ch - 13), (split_x - 14, ch - 13)]
        da.polygon(split_poly, fill=panel_bg)
        da.line([(split_x + 18, 12), (split_x - 14, ch - 13)], fill=title_fg, width=5)
        da.rectangle([18, 18, cw - 19, ch - 19], outline=decor, width=3)

        # Night emissive: illuminate light right-panels cleanly so dark utility text NEVER disappears on gusset/acp!
        if relative_luminance(panel_bg) >= 0.25:
            ebg = tuple(int(min(212, round(c * 0.80))) for c in panel_bg)
            de.polygon(split_poly, fill=ebg + (235,))
        else:
            ebg = tuple(int(round(c * 0.42)) for c in panel_bg)
            de.polygon(split_poly, fill=ebg + (180,))
        de.line([(split_x + 18, 12), (split_x - 14, ch - 13)], fill=title_fg + (190,), width=4)

        # Center left-aligned typography with generous right margin away from slash
        tx0 = 266
        tx1 = split_x - 54
        ft = fit_font(da, title, tx1 - tx0, 98, fstyle, min_size=50)
        fs = fit_font(da, sub, tx1 - tx0, 38, "sans_med", min_size=24)
        draw_channel_text(da, de, (tx0, 118), title, ft, title_fg, eff_bg, anchor="lm", shadow_depth=5, emit_gain=0.90)
        # Full-span subtle hairline divider (no awkward 2-char stub dash!)
        da.line([(tx0, 184), (tx1, 184)], fill=decor, width=2)
        de.line([(tx0, 184), (tx1, 184)], fill=decor + (145,), width=2)
        draw_channel_text(da, de, (tx0, 232), sub, fs, sub_fg, eff_bg, anchor="lm", shadow_depth=3, emit_gain=0.84)

        # Right utility panel 2-line stacked badge
        lines = [ln.strip() for ln in badge_tag.split("\n") if ln.strip()] or ["品质优选", "欢迎光临"]
        rcx = (split_x + cw - 14) // 2 + 4
        if len(lines) == 1:
            rf = fit_font(da, lines[0], cw - split_x - 56, 46, "sans", min_size=26)
            draw_channel_text(da, de, (rcx, ch // 2), lines[0], rf, panel_fg, panel_bg, anchor="mm", shadow_depth=2, emit_gain=0.86)
        else:
            rf1 = fit_font(da, lines[0], cw - split_x - 56, 46, "sans", min_size=26)
            rf2 = fit_font(da, lines[1], cw - split_x - 56, 36, "sans_med", min_size=22)
            draw_channel_text(da, de, (rcx, 116), lines[0], rf1, panel_fg, panel_bg, anchor="mm", shadow_depth=2, emit_gain=0.86)
            da.line([(rcx - 74, 162), (rcx + 74, 162)], fill=panel_fg, width=3)
            draw_channel_text(da, de, (rcx, 208), lines[1], rf2, panel_fg, panel_bg, anchor="mm", shadow_depth=2, emit_gain=0.84)

    elif mode == "heritage_seal":
        # Double Chinese architectural frame + stepped corner fretwork
        da.rectangle([20, 20, cw - 21, ch - 21], outline=decor, width=4)
        da.rectangle([32, 32, cw - 33, ch - 33], outline=decor, width=2)
        draw_heritage_corners(da, 20, 20, cw - 21, ch - 21, decor, arm=36, w=4)
        de.rectangle([20, 20, cw - 21, ch - 21], outline=decor + (145,), width=3)

        # Vertical architectural divider separating left emblem & main plaque title
        div_x = 294
        da.line([(div_x, 54), (div_x, ch - 54)], fill=decor, width=4)
        da.line([(div_x + 9, 68), (div_x + 9, ch - 68)], fill=decor, width=2)
        da.polygon([(div_x, 42), (div_x + 9, 51), (div_x, 60), (div_x - 9, 51)], fill=decor)
        da.polygon([(div_x, ch - 60), (div_x + 9, ch - 51), (div_x, ch - 42), (div_x - 9, ch - 51)], fill=decor)

        # Far-right authentic vertical vermilion chop stamp WITH refined inner inset frame on ALL boards!
        chop_x0, chop_y0, chop_x1, chop_y1 = cw - 124, 58, cw - 50, ch - 58
        da.rounded_rectangle([chop_x0, chop_y0, chop_x1, chop_y1], radius=8, fill=pal["chop_bg"], outline=decor, width=3)
        da.rounded_rectangle([chop_x0 + 6, chop_y0 + 6, chop_x1 - 6, chop_y1 - 6], radius=4, outline=pal["chop_fg"], width=2)
        de.rounded_rectangle([chop_x0, chop_y0, chop_x1, chop_y1], radius=8, fill=pal["chop_bg"] + (205,), outline=decor + (185,), width=2)
        de.rounded_rectangle([chop_x0 + 6, chop_y0 + 6, chop_x1 - 6, chop_y1 - 6], radius=4, outline=pal["chop_fg"] + (195,), width=2)
        chop_txt = badge_tag.replace("\n", "").strip()[:4] or "桂林老味"
        cf = load_font(28 if len(chop_txt) <= 4 else 24, "brush")
        step_y = (chop_y1 - chop_y0 - 26) / max(1, len(chop_txt))
        for ci, ch_char in enumerate(chop_txt):
            cy = int(chop_y0 + 13 + step_y * (ci + 0.5))
            da.text(((chop_x0 + chop_x1) // 2, cy), ch_char, fill=pal["chop_fg"], font=cf, anchor="mm")
            de.text(((chop_x0 + chop_x1) // 2, cy), ch_char, fill=pal["chop_fg"] + (230,), font=cf, anchor="mm")

        # Main plaque title & subtitle: optically centered inside the middle window between divider & chop!
        mid_x0 = div_x + 34
        mid_x1 = chop_x0 - 34
        mid_cx = (mid_x0 + mid_x1) // 2
        ft = fit_font(da, title, mid_x1 - mid_x0, 114, fstyle, min_size=58)
        fs = fit_font(da, sub, mid_x1 - mid_x0, 40, "serif" if fstyle != "sans" else "sans_med", min_size=26)
        draw_channel_text(da, de, (mid_cx, 120), title, ft, title_fg, eff_bg, anchor="mm", shadow_depth=5, emit_gain=0.90)
        draw_channel_text(da, de, (mid_cx, 232), sub, fs, sub_fg, eff_bg, anchor="mm", shadow_depth=3, emit_gain=0.82)

    elif mode == "led_ticker":
        # Upper frame + crisp bottom dot-matrix LED ticker bar
        led_y0, led_y1 = 238, ch - 18
        da.rectangle([18, 18, cw - 19, led_y0 - 8], outline=decor, width=3)

        # Bottom LED housing & industry-aware crisp dot-matrix glow text (zero fashion/food mismatch!)
        da.rounded_rectangle([18, led_y0, cw - 19, led_y1], radius=8, fill=pal["led_bg"], outline=(82, 86, 92), width=3)
        for ly in range(led_y0 + 8, led_y1 - 4, 8):
            da.line([(26, ly), (cw - 27, ly)], fill=(28, 25, 25), width=1)
        tickers = LED_TICKERS_FOOD if icon_type in FOOD_ICON_TYPES else LED_TICKERS_SERVICE
        ticker_text = tickers[idx % len(tickers)]
        lf = fit_font(da, ticker_text, cw - 90, 34, "sans", min_size=22)
        da.text((cw // 2, (led_y0 + led_y1) // 2), ticker_text, fill=pal["led_fg"], font=lf, anchor="mm")
        de.text((cw // 2, (led_y0 + led_y1) // 2), ticker_text, fill=pal["led_fg"] + (248,), font=lf, anchor="mm")

        # Upper right typography
        tx0 = 262
        tx1 = cw - 44
        if badge_tag:
            pill_x0 = draw_capsule_pill(badge_tag, tx1, 32, 42, decor)
            title_max_w = (pill_x0 - 38) - tx0
        else:
            title_max_w = tx1 - tx0

        ft = fit_font(da, title, max(440, title_max_w), 96, fstyle, min_size=50)
        fs = fit_font(da, sub, tx1 - tx0, 36, "sans_med", min_size=24)
        draw_channel_text(da, de, (tx0, 96), title, ft, title_fg, eff_bg, anchor="lm", shadow_depth=5, emit_gain=0.92)
        draw_channel_text(da, de, (tx0, 186), sub, fs, sub_fg, eff_bg, anchor="lm", shadow_depth=3, emit_gain=0.84)

    elif mode == "luxury_frame":
        # High-contrast minimal boutique double hairline frame + balanced editorial right anchor (ZERO right void!)
        da.rectangle([22, 22, cw - 23, ch - 23], outline=decor, width=3)
        da.rectangle([34, 34, cw - 35, ch - 35], outline=decor, width=2)
        de.rectangle([22, 22, cw - 23, ch - 23], outline=decor + (140,), width=2)

        # Refined industry-tailored right-aligned editorial metadata column anchors wide 4:1 plaques
        anchor_x = cw - 246
        da.line([(anchor_x, 62), (anchor_x, ch - 62)], fill=decor, width=2)
        de.line([(anchor_x, 62), (anchor_x, ch - 62)], fill=decor + (145,), width=2)
        r_cx = (anchor_x + cw - 44) // 2
        anc_top, anc_mid, anc_bot = LUXURY_ANCHORS.get(icon_type, ("GUILIN", "0773", "品质严选"))
        f_meta_top = load_font(22, "latin")
        f_meta_mid = fit_font(da, anc_mid, 176, 26, "latin", min_size=18)
        f_meta_bot = load_font(20, "sans_med")
        draw_channel_text(da, de, (r_cx, 102), anc_top, f_meta_top, sub_fg, eff_bg, anchor="mm", shadow_depth=0, emit_gain=0.82)
        draw_channel_text(da, de, (r_cx, 158), anc_mid, f_meta_mid, title_fg, eff_bg, anchor="mm", shadow_depth=2, emit_gain=0.88)
        da.line([(r_cx - 42, 190), (r_cx + 42, 190)], fill=decor, width=2)
        draw_channel_text(da, de, (r_cx, 220), anc_bot, f_meta_bot, sub_fg, eff_bg, anchor="mm", shadow_depth=0, emit_gain=0.80)

        tx0 = 308
        tx1 = anchor_x - 36
        kicker = (badge_tag or "GUILIN BOUTIQUE").upper().replace("·", "/").strip()
        kicker_disp = " ".join(list(kicker)) if (kicker.isascii() and len(kicker) <= 13) else kicker
        kf = fit_font(da, kicker_disp, tx1 - tx0, 25, "latin" if kicker_disp.isascii() else "sans_med", min_size=18)
        draw_channel_text(da, de, (tx0, 72), kicker_disp, kf, sub_fg, eff_bg, anchor="lm", shadow_depth=0, emit_gain=0.84)

        # Short titles (<=4 chars) get refined spacious character tracking + slightly bolder presence
        display_title = " ".join(list(title)) if (len(title) <= 4 and not title.isascii()) else title
        ft = fit_font(da, display_title, tx1 - tx0, 102, fstyle, min_size=52)
        fs = fit_font(da, sub, tx1 - tx0, 36, "sans_med", min_size=24)
        # Soft modern luxury shadow (never heavy dated black block drop shadow!)
        draw_channel_text(da, de, (tx0, 152), display_title, ft, title_fg, eff_bg, anchor="lm", shadow_depth=3, emit_gain=0.90)
        da.line([(tx0, 208), (tx1, 208)], fill=decor, width=2)
        de.line([(tx0, 208), (tx1, 208)], fill=decor + (140,), width=2)
        draw_channel_text(da, de, (tx0, 248), sub, fs, sub_fg, eff_bg, anchor="lm", shadow_depth=0, emit_gain=0.84)

    else:  # duotone_banner
        # Bold contrasting left color block (slanted trapezoid) + bottom subtitle ribbon
        slant_top, slant_bot = 314, 276
        left_poly = [(12, 12), (slant_top, 12), (slant_bot, ch - 13), (12, ch - 13)]
        da.polygon(left_poly, fill=panel_bg)
        da.line([(slant_top, 12), (slant_bot, ch - 13)], fill=title_fg, width=5)
        if relative_luminance(panel_bg) >= 0.25:
            ebg = tuple(int(min(205, round(c * 0.72))) for c in panel_bg)
            de.polygon(left_poly, fill=ebg + (210,))

        # Bottom contrasting subtitle ribbon across right zone
        rib_y0, rib_y1 = 220, ch - 18
        rib_x0 = slant_bot + 10
        rib_poly = [(rib_x0 + 10, rib_y0), (cw - 18, rib_y0), (cw - 18, rib_y1), (rib_x0 - 4, rib_y1)]
        da.polygon(rib_poly, fill=panel_bg)
        if relative_luminance(panel_bg) >= 0.25:
            ebg = tuple(int(min(212, round(c * 0.80))) for c in panel_bg)
            de.polygon(rib_poly, fill=ebg + (235,))
        else:
            ebg = tuple(int(round(c * 0.48)) for c in panel_bg)
            de.polygon(rib_poly, fill=ebg + (185,))

        tx0 = 342
        tx1 = cw - 44
        if badge_tag:
            pill_x0 = draw_capsule_pill(badge_tag, tx1, 34, 44, title_fg)
            title_max_w = (pill_x0 - 42) - tx0
        else:
            title_max_w = tx1 - tx0

        ft = fit_font(da, title, max(440, title_max_w), 104, fstyle, min_size=52)
        fs = fit_font(da, sub, cw - rib_x0 - 70, 38, "sans", min_size=24)
        # Slightly lifted title (y=112) for ideal vertical balance above bottom ribbon
        draw_channel_text(da, de, (tx0, 112), title, ft, title_fg, eff_bg, anchor="lm", shadow_depth=5, emit_gain=0.90)
        draw_channel_text(da, de, (tx0, (rib_y0 + rib_y1) // 2), sub, fs, panel_fg, panel_bg, anchor="lm", shadow_depth=2, emit_gain=0.86)

    # ── Composite high-precision multi-layer industry vector emblem ──
    badge_shape_override = "octagon" if mode == "heritage_seal" else None
    icon_rgba, _prims = render_industry_icon(
        icon_type=icon_type,
        size=isize,
        bg_rgb=icon_bg_ref,
        accent_rgb=decor,
        fg_rgb=title_fg,
        badge_shape=badge_shape_override,
        supersample=2,
    )
    ix0 = icx - isize // 2
    iy0 = icy - isize // 2
    tile.paste(icon_rgba, (ix0, iy0), icon_rgba)

    # Add icon emblem glow to foreground emissive layer (attenuated cleanly so details stay sharp)
    ie_arr = np.array(icon_rgba, dtype=np.float32)
    ie_arr[:, :, :3] = np.clip(ie_arr[:, :, :3] * (glow * 0.84), 0, 224)
    icon_emit = Image.fromarray(ie_arr.astype(np.uint8))
    fg_emit.alpha_composite(icon_emit, (ix0, iy0))

    # Brushed anodized aluminum outer mounting trim (12px @ 2x SSAA -> 6px crisp final; also sampled for 3D sides)
    da_final = ImageDraw.Draw(tile)
    da_final.rectangle([0, 0, cw - 1, ch - 1], outline=(56, 60, 66), width=12)
    da_final.line([(0, 0), (cw - 1, 0)], fill=(28, 30, 34), width=5)
    da_final.line([(0, ch - 1), (cw - 1, ch - 1)], fill=(24, 26, 30), width=5)

    # ── Compose physically balanced night emissive plate ──
    # Outer 12px metal trim stays strictly black (0,0,0) so 3D box edges never bleed glow.
    tile_arr = np.array(tile, dtype=np.float32)
    fg_arr = np.array(fg_emit, dtype=np.float32)
    fg_alpha = fg_arr[:, :, 3:4] / 255.0

    if substrate == "acrylic":
        # Backlit lightbox: entire inner fascia glows smoothly without washing out text
        bg_scale = glow * 0.68
        base_emit = np.clip(tile_arr * bg_scale, 0, 212)
        em_arr = base_emit * (1.0 - fg_alpha * 0.45) + np.clip(fg_arr[:, :, :3] * glow, 0, 232) * (fg_alpha * 0.45)
    elif relative_luminance(eff_bg) >= 0.30:
        # Light-background metal acp / gusset: top-mounted gooseneck spotlight wash keeps dark lettering razor sharp!
        wy = np.linspace(1.08, 0.88, ch, dtype=np.float32)[:, None, None]
        bg_scale = min(0.84, glow * 0.88)
        base_emit = np.clip(tile_arr * bg_scale * wy, 0, 202)
        # Preserve crisp dark lettering silhouettes and luminous emblem/accent overlays
        em_arr = base_emit * (1.0 - fg_alpha * 0.65) + np.clip(fg_arr[:, :, :3] * 0.92, 0, 224) * (fg_alpha * 0.65)
    else:
        # Dark-background metal acp / gusset: subtle down-lit wash on panel + bright illuminated channel letters, emblem & light panels
        bg_scale = glow * 0.28
        base_emit = np.clip(tile_arr * bg_scale, 0, 145)
        em_arr = base_emit * (1.0 - fg_alpha) + np.clip(fg_arr[:, :, :3] * min(1.0, glow * 1.15), 0, 236) * fg_alpha

    # Mask outer 12px metal frame cleanly to pure black
    em_arr[:12, :, :] = 0
    em_arr[-12:, :, :] = 0
    em_arr[:, :12, :] = 0
    em_arr[:, -12:, :] = 0
    em_full = Image.fromarray(np.clip(em_arr, 0, 255).astype(np.uint8))

    return tile, em_full


def _render_fascia_worker(args: tuple[int, tuple, int, int, int, int]) -> tuple[int, Image.Image, Image.Image]:
    idx, spec, cw, ch, out_cw, out_ch = args
    tile_2x, emit_2x = render_single_fascia(idx, spec, cw=cw, ch=ch)
    tile_out = tile_2x.resize((out_cw, out_ch), Image.Resampling.LANCZOS)
    emit_out = emit_2x.resize((out_cw, out_ch), Image.Resampling.LANCZOS)
    return idx, tile_out, emit_out


def render_fascias(
    out_dir: Path,
    cols: int = 6,
    rows: int = 16,
    out_cw: int = 640,
    out_ch: int = 160,
    preview_path: Path | None = None,
    workers: int = 4,
):
    count = cols * rows
    specs = FASCIA_SPECS[:count]
    assert len(specs) == count, f"Need {count} specs for {cols}x{rows}, have {len(specs)}"

    # Mandatory 2x SSAA canvas (1280x320 -> LANCZOS -> 640x160)
    CW, CH = out_cw * 2, out_ch * 2
    alb = Image.new("RGB", (cols * out_cw, rows * out_ch), (38, 40, 44))
    emit = Image.new("RGB", (cols * out_cw, rows * out_ch), (0, 0, 0))

    jobs = [(idx, spec, CW, CH, out_cw, out_ch) for idx, spec in enumerate(specs)]
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            for done_n, (idx, tile_out, emit_out) in enumerate(ex.map(_render_fascia_worker, jobs), 1):
                col, row = idx % cols, idx // cols
                alb.paste(tile_out, (col * out_cw, row * out_ch))
                emit.paste(emit_out, (col * out_cw, row * out_ch))
                if done_n % 24 == 0 or done_n == count:
                    print(f"  rendered {done_n}/{count} fascia tiles (2x SSAA {CW}x{CH} -> {out_cw}x{out_ch})", flush=True)
    else:
        for done_n, job in enumerate(jobs, 1):
            idx, tile_out, emit_out = _render_fascia_worker(job)
            col, row = idx % cols, idx // cols
            alb.paste(tile_out, (col * out_cw, row * out_ch))
            emit.paste(emit_out, (col * out_cw, row * out_ch))
            if done_n % 24 == 0 or done_n == count:
                print(f"  rendered {done_n}/{count} fascia tiles", flush=True)

    alb_path = out_dir / "shop-fascias.webp"
    emit_path = out_dir / "shop-fascias-emit.webp"
    alb.save(alb_path, quality=93, method=4)
    emit.save(emit_path, quality=88, method=4)
    if preview_path:
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        alb.resize((1920, int(1920 * alb.height / alb.width)), Image.Resampling.LANCZOS).save(preview_path, quality=92)

    print(
        f"Generated {count}-shop ({cols}x{rows}, cell {out_cw}x{out_ch} from {CW}x{CH} 2x SSAA, "
        f"atlas {alb.width}x{alb.height} RGB):\n"
        f"  {alb_path.name:24s}: {alb_path.stat().st_size / 1024:.1f} KB (quality=93)\n"
        f"  {emit_path.name:24s}: {emit_path.stat().st_size / 1024:.1f} KB (quality=88)",
        flush=True,
    )


# ---------------------------------------------------------------------------
# 16 Vertical Pier Blade Signs (8x2, 2x SSAA 256x1024 -> 128x512 -> 1024x1024)
# ---------------------------------------------------------------------------
def render_blades(out_dir: Path):
    COLS, ROWS = 8, 2
    OUT_CW, OUT_CH = 128, 512
    CW, CH = OUT_CW * 2, OUT_CH * 2  # 256x1024 mandatory 2x SSAA
    img = Image.new("RGB", (COLS * OUT_CW, ROWS * OUT_CH), (34, 36, 40))

    for idx, (bg_hex, fg_hex, border_hex, text, icon_type) in enumerate(BLADE_SPECS):
        col, row = idx % COLS, idx // COLS
        x0, y0 = col * OUT_CW, row * OUT_CH

        eff_bg = effective_bg_rgb(bg_hex)
        fg_rgb = ensure_wcag_fg(hex_to_rgb_tuple(fg_hex), eff_bg, min_ratio=5.0)
        border_rgb = hex_to_rgb_tuple(border_hex)
        if contrast_ratio(border_rgb, eff_bg) < 2.6:
            border_rgb = blend_rgb(border_rgb, fg_rgb, 0.6)

        tile = make_substrate(CW, CH, bg_hex, "acrylic", 9900 + idx * 17)
        draw = ImageDraw.Draw(tile)
        draw.rectangle([16, 16, CW - 17, CH - 17], outline=border_rgb, width=5)
        draw.rectangle([26, 26, CW - 27, CH - 27], outline=border_rgb, width=2)

        # Dedicated industry vector emblem at top of vertical blade
        icon_size = 176
        icon_rgba, _prims = render_industry_icon(
            icon_type=icon_type,
            size=icon_size,
            bg_rgb=eff_bg,
            accent_rgb=border_rgb,
            fg_rgb=fg_rgb,
            supersample=2,
        )
        tile.paste(icon_rgba, ((CW - icon_size) // 2, 44), icon_rgba)
        draw = ImageDraw.Draw(tile)

        # Clean accent separator under top icon
        sep_y = 238
        draw.line([(46, sep_y), (CW - 46, sep_y)], fill=border_rgb, width=4)
        draw.polygon([(CW // 2, sep_y - 7), (CW // 2 + 8, sep_y), (CW // 2, sep_y + 7), (CW // 2 - 8, sep_y)], fill=border_rgb)

        # Vertical Chinese lettering with crisp 3D shadow
        n = len(text)
        f = load_font(124 if n <= 4 else 104, "brush" if idx % 3 == 0 else "sans")
        y_start, y_end = 264, CH - 48
        step = (y_end - y_start) / max(1, n)
        bg_luma = relative_luminance(eff_bg)
        sh_col = (12, 13, 16) if bg_luma < 0.30 else blend_rgb(eff_bg, (24, 22, 20), 0.18)
        for ci, ch_char in enumerate(text):
            cy = int(y_start + step * (ci + 0.5))
            draw.text((CW // 2 + 3, cy + 4), ch_char, fill=sh_col, font=f, anchor="mm")
            draw.text((CW // 2, cy), ch_char, fill=fg_rgb, font=f, anchor="mm")

        # Outer anodized metal trim (10px @ 2x -> 5px final)
        draw.rectangle([0, 0, CW - 1, CH - 1], outline=(52, 56, 60), width=10)
        tile_out = tile.resize((OUT_CW, OUT_CH), Image.Resampling.LANCZOS)
        img.paste(tile_out, (x0, y0))

    blade_path = out_dir / "shop-blades.webp"
    img.save(blade_path, quality=92, method=4)
    print(
        f"  {blade_path.name:24s}: {blade_path.stat().st_size / 1024:.1f} KB "
        f"({COLS}x{ROWS}, cell {OUT_CW}x{OUT_CH} from {CW}x{CH} 2x SSAA, atlas {img.width}x{img.height} RGB, quality=92)"
    )


def main():
    ap = argparse.ArgumentParser(description="Generate Guilin City Upgrade 4:1 HD signboard atlases.")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--grid", choices=("6x16", "8x12", "8x8"), default="6x16", help="Fascia atlas grid (default: 6x16 = 96 shops)")
    ap.add_argument("--cell-size", choices=("640x160", "384x192", "512x256"), default="640x160")
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
