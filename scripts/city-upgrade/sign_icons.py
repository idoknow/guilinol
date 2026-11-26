#!/usr/bin/env python3
"""
High-precision multi-layer vector icon emblem library (20 commercial industries)
for Guilin Online City Upgrade 4:1 signboard & vertical blade atlases.

Design principles (IDOK-471 / IDOK-472, aligned with local boutique materials.ts):
  - Zero lazy "single character inside a flat circle" placeholders.
  - All 20 industry icons obey a strict inner safe-zone radius (~70% of badge interior)
    with unified dark-ink outline weight, crisp highlights, and zero frame clipping.
  - Rendered with 2x internal supersampling on top of 2x SSAA fascia canvas (4x+ effective
    anti-aliasing) using smooth Bezier paths and tactile subtly shaded medallion bases.
  - Dark-board medallions use warm harmonious alabaster parchment (avoiding stark bright
    white sticker clash) while preserving >= 6:1 foreground contrast inside every badge.
"""
from __future__ import annotations

import math
from typing import Callable

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

RGB = tuple[int, int, int]
RGBA = tuple[int, int, int, int]
Pt = tuple[float, float]


# ---------------------------------------------------------------------------
# Color & WCAG 2.1 contrast utilities (shared across atlas & verification)
# ---------------------------------------------------------------------------
def hex_to_rgb_tuple(hex_str: str) -> RGB:
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def desaturate_rgb(rgb: RGB, gray_mix: float = 0.20) -> RGB:
    """Apply neutral-luma saturation cap matching make_substrate()."""
    r, g, b = rgb
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    k = 1.0 - gray_mix
    return (
        int(round(max(0.0, min(255.0, r * k + luma * gray_mix)))),
        int(round(max(0.0, min(255.0, g * k + luma * gray_mix)))),
        int(round(max(0.0, min(255.0, b * k + luma * gray_mix)))),
    )


def _srgb_channel_to_linear(c: float) -> float:
    v = max(0.0, min(255.0, c)) / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[float, float, float]) -> float:
    r = _srgb_channel_to_linear(rgb[0])
    g = _srgb_channel_to_linear(rgb[1])
    b = _srgb_channel_to_linear(rgb[2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(rgb1: tuple[float, float, float], rgb2: tuple[float, float, float]) -> float:
    l1 = relative_luminance(rgb1)
    l2 = relative_luminance(rgb2)
    hi, lo = (l1, l2) if l1 >= l2 else (l2, l1)
    return (hi + 0.05) / (lo + 0.05)


def blend_rgb(a: RGB, b: RGB, t: float) -> RGB:
    return (
        int(round(a[0] + (b[0] - a[0]) * t)),
        int(round(a[1] + (b[1] - a[1]) * t)),
        int(round(a[2] + (b[2] - a[2]) * t)),
    )


def rgba(rgb: RGB, alpha: int = 255) -> RGBA:
    return (rgb[0], rgb[1], rgb[2], max(0, min(255, alpha)))


def tone(hex_str: str, gray_mix: float = 0.14) -> RGB:
    """Calibrated icon color with mild saturation governor."""
    return desaturate_rgb(hex_to_rgb_tuple(hex_str), gray_mix)


# ---------------------------------------------------------------------------
# Smooth vector geometry helpers (normalized [-1, 1] icon coordinate space)
# ---------------------------------------------------------------------------
class VectorCanvas:
    """Normalized [-1, 1] drawing wrapper over a high-res RGBA Pillow canvas."""

    def __init__(self, size: int):
        self.size = size
        self.cx = size * 0.5
        self.cy = size * 0.5
        self.r = size * 0.435  # primary badge radius inside canvas (clean shadow margin)
        self.img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.img, "RGBA")
        self.primitives = 0

    def pt(self, x: float, y: float) -> Pt:
        return (self.cx + x * self.r, self.cy + y * self.r)

    def pts(self, coords: list[Pt]) -> list[Pt]:
        return [self.pt(x, y) for x, y in coords]

    def px(self, v: float) -> float:
        return v * self.r

    def pw(self, v: float) -> int:
        return max(2, int(round(v * self.r)))

    def bbox(self, x0: float, y0: float, x1: float, y1: float) -> list[float]:
        p0 = self.pt(x0, y0)
        p1 = self.pt(x1, y1)
        return [min(p0[0], p1[0]), min(p0[1], p1[1]), max(p0[0], p1[0]), max(p0[1], p1[1])]

    def circle(
        self,
        cx: float,
        cy: float,
        rad: float,
        fill: RGBA | None = None,
        outline: RGBA | None = None,
        width: float = 0.0,
    ):
        self.draw.ellipse(
            self.bbox(cx - rad, cy - rad, cx + rad, cy + rad),
            fill=fill,
            outline=outline,
            width=self.pw(width) if outline and width > 0 else 0,
        )
        self.primitives += 1

    def ellipse(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float,
        fill: RGBA | None = None,
        outline: RGBA | None = None,
        width: float = 0.0,
        angle_deg: float = 0.0,
    ):
        if abs(angle_deg) < 0.01:
            self.draw.ellipse(
                self.bbox(cx - rx, cy - ry, cx + rx, cy + ry),
                fill=fill,
                outline=outline,
                width=self.pw(width) if outline and width > 0 else 0,
            )
            self.primitives += 1
            return
        pts = rotated_ellipse_pts(cx, cy, rx, ry, angle_deg, steps=36)
        self.polygon(pts, fill=fill, outline=outline, width=width)

    def polygon(
        self,
        coords: list[Pt],
        fill: RGBA | None = None,
        outline: RGBA | None = None,
        width: float = 0.0,
    ):
        p = self.pts(coords)
        if fill is not None:
            self.draw.polygon(p, fill=fill)
        if outline is not None and width > 0:
            self.stroke_polyline(coords + [coords[0]], width=width, color=outline, closed=True)
        self.primitives += 1

    def rounded_rect(
        self,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        radius: float,
        fill: RGBA | None = None,
        outline: RGBA | None = None,
        width: float = 0.0,
    ):
        self.draw.rounded_rectangle(
            self.bbox(x0, y0, x1, y1),
            radius=max(1.0, self.px(radius)),
            fill=fill,
            outline=outline,
            width=self.pw(width) if outline and width > 0 else 0,
        )
        self.primitives += 1

    def stroke_polyline(
        self,
        coords: list[Pt],
        width: float,
        color: RGBA,
        closed: bool = False,
    ):
        if len(coords) < 2:
            return
        pts = self.pts(coords)
        w = max(2, int(round(self.px(width))))
        half = w * 0.5
        self.draw.line(pts, fill=color, width=w, joint="curve")
        if not closed:
            for x, y in (pts[0], pts[-1]):
                self.draw.ellipse([x - half, y - half, x + half, y + half], fill=color)
        self.primitives += 1

    def stroke_line(self, p0: Pt, p1: Pt, width: float, color: RGBA):
        self.stroke_polyline([p0, p1], width=width, color=color, closed=False)

    def stroke_quad(self, p0: Pt, p1: Pt, p2: Pt, width: float, color: RGBA, steps: int = 20):
        self.stroke_polyline(quad_bezier(p0, p1, p2, steps=steps), width=width, color=color)

    def stroke_cubic(self, p0: Pt, p1: Pt, p2: Pt, p3: Pt, width: float, color: RGBA, steps: int = 24):
        self.stroke_polyline(cubic_bezier(p0, p1, p2, p3, steps=steps), width=width, color=color)

    def sparkle(self, cx: float, cy: float, rad: float, fill: RGBA):
        """Crisp 4-point star sparkle."""
        inner = rad * 0.28
        pts: list[Pt] = []
        for i in range(8):
            a = i * math.pi / 4.0
            rr = rad if i % 2 == 0 else inner
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        self.polygon(pts, fill=fill)

    def composite_layer(self, layer: Image.Image):
        self.img = Image.alpha_composite(self.img, layer)
        self.draw = ImageDraw.Draw(self.img, "RGBA")


def quad_bezier(p0: Pt, p1: Pt, p2: Pt, steps: int = 20) -> list[Pt]:
    out: list[Pt] = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def cubic_bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps: int = 24) -> list[Pt]:
    out: list[Pt] = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def arc_pts(cx: float, cy: float, rx: float, ry: float, a0_deg: float, a1_deg: float, steps: int = 24) -> list[Pt]:
    out: list[Pt] = []
    for i in range(steps + 1):
        a = math.radians(a0_deg + (a1_deg - a0_deg) * (i / steps))
        out.append((cx + math.cos(a) * rx, cy + math.sin(a) * ry))
    return out


def rotated_ellipse_pts(cx: float, cy: float, rx: float, ry: float, angle_deg: float, steps: int = 32) -> list[Pt]:
    ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    out: list[Pt] = []
    for i in range(steps):
        th = 2.0 * math.pi * i / steps
        lx, ly = rx * math.cos(th), ry * math.sin(th)
        out.append((cx + lx * ca - ly * sa, cy + lx * sa + ly * ca))
    return out


def rotate_pts(pts: list[Pt], cx: float, cy: float, angle_deg: float) -> list[Pt]:
    ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    out: list[Pt] = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        out.append((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca))
    return out


def leaf_pts(base: Pt, tip: Pt, bulge: float = 0.36) -> list[Pt]:
    """Smooth symmetrical botanical leaf polygon from base to tip."""
    dx, dy = tip[0] - base[0], tip[1] - base[1]
    nx, ny = -dy, dx
    mx, my = (base[0] + tip[0]) * 0.5, (base[1] + tip[1]) * 0.5
    c1 = (mx + nx * bulge, my + ny * bulge)
    c2 = (mx - nx * bulge, my - ny * bulge)
    side1 = quad_bezier(base, c1, tip, steps=14)
    side2 = quad_bezier(tip, c2, base, steps=14)
    return side1 + side2[1:-1]


# ---------------------------------------------------------------------------
# Tactile badge base renderer (circle / squircle / shield / octagon)
# ---------------------------------------------------------------------------
def _shield_pts(scale: float = 1.0) -> list[Pt]:
    s = scale
    pts: list[Pt] = [(-0.82 * s, -0.82 * s), (0.0, -0.96 * s), (0.82 * s, -0.82 * s)]
    pts += quad_bezier((0.82 * s, -0.82 * s), (0.88 * s, 0.24 * s), (0.0, 0.96 * s), steps=16)[1:]
    pts += quad_bezier((0.0, 0.96 * s), (-0.88 * s, 0.24 * s), (-0.82 * s, -0.82 * s), steps=16)[1:-1]
    return pts


def _octagon_pts(scale: float = 1.0) -> list[Pt]:
    s = scale * 0.98
    k = 0.4142 * s
    return [
        (-k, -s), (k, -s), (s, -k), (s, k),
        (k, s), (-k, s), (-s, k), (-s, -k),
    ]


def _render_badge_base(
    vc: VectorCanvas,
    shape: str,
    bg_rgb: RGB,
    accent_rgb: RGB,
    fg_rgb: RGB,
) -> tuple[RGB, RGB]:
    """
    Draw a tactile, softly shaded medallion base with drop shadow, refined outer rim,
    and fine inner hairline ring. Warm alabaster on dark boards prevents white-sticker clash.
    """
    bg_luma = relative_luminance(bg_rgb)
    if bg_luma < 0.22:
        # Refined warm alabaster-parchment on dark boards (harmonizes without harsh sticker glare)
        top_fill = blend_rgb((240, 234, 222), bg_rgb, 0.05)
        bot_fill = blend_rgb((220, 212, 196), bg_rgb, 0.07)
        cand = accent_rgb if contrast_ratio(accent_rgb, bg_rgb) >= 3.2 else fg_rgb
        if contrast_ratio(cand, bg_rgb) < 3.6:
            cand = (224, 198, 142)
        ring_outer = cand
        ring_inner = blend_rgb(cand, (68, 56, 42), 0.45)
        shadow_alpha = 110
    else:
        # Crisp warm ivory medallion with refined medium-weight heritage rim on light boards
        top_fill = (250, 247, 240)
        bot_fill = (236, 229, 216)
        if contrast_ratio(accent_rgb, bg_rgb) >= 4.2:
            ring_outer = blend_rgb(accent_rgb, (38, 30, 26), 0.18)
        elif contrast_ratio(fg_rgb, bg_rgb) >= 4.5:
            ring_outer = blend_rgb(fg_rgb, (54, 46, 40), 0.18)
        else:
            ring_outer = (52, 46, 42)
        ring_inner = blend_rgb(ring_outer, top_fill, 0.40)
        shadow_alpha = 82

    interior_mid = blend_rgb(top_fill, bot_fill, 0.5)

    # Shape mask for vertical gradient + soft drop shadow
    mask = Image.new("L", (vc.size, vc.size), 0)
    md = ImageDraw.Draw(mask)
    if shape == "squircle":
        md.rounded_rectangle(vc.bbox(-0.95, -0.95, 0.95, 0.95), radius=vc.px(0.36), fill=255)
    elif shape == "shield":
        md.polygon(vc.pts(_shield_pts(0.98)), fill=255)
    elif shape == "octagon":
        md.polygon(vc.pts(_octagon_pts(0.98)), fill=255)
    else:
        md.ellipse(vc.bbox(-0.98, -0.98, 0.98, 0.98), fill=255)

    # Soft contact drop shadow underneath badge
    sh = Image.new("RGBA", (vc.size, vc.size), (0, 0, 0, 0))
    sh_alpha = Image.new("L", (vc.size, vc.size), 0)
    off = max(3, int(round(vc.size * 0.016)))
    sh_alpha.paste(mask, (off, int(off * 1.3)))
    sh_alpha = sh_alpha.filter(ImageFilter.GaussianBlur(radius=max(2.5, vc.size * 0.020)))
    sh_alpha = sh_alpha.point(lambda p, a=shadow_alpha: int(p * a / 255))
    sh.paste((14, 14, 18, 255), (0, 0), sh_alpha)
    vc.composite_layer(sh)

    # Vertical gradient fill inside badge
    grad_arr = np.zeros((vc.size, vc.size, 4), dtype=np.uint8)
    t = np.linspace(0.0, 1.0, vc.size, dtype=np.float32)[:, None]
    for c in range(3):
        grad_arr[:, :, c] = np.clip(top_fill[c] * (1.0 - t) + bot_fill[c] * t, 0, 255).astype(np.uint8)
    grad_arr[:, :, 3] = np.array(mask, dtype=np.uint8)
    badge_layer = Image.fromarray(grad_arr)

    # Subtle top highlight sheen inside badge
    sheen = Image.new("RGBA", (vc.size, vc.size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen, "RGBA")
    sd.ellipse(vc.bbox(-0.80, -1.06, 0.80, -0.14), fill=(255, 255, 255, 48))
    sheen_a = ImageChops.multiply(sheen.split()[3], mask)
    sheen.putalpha(sheen_a)
    badge_layer = Image.alpha_composite(badge_layer, sheen)
    vc.composite_layer(badge_layer)

    # Refined outer & inner crisp rings (slightly slimmer outer_w so medallions stay elegant)
    outer_w = 0.068
    inner_w = 0.020
    if shape == "squircle":
        vc.rounded_rect(-0.95, -0.95, 0.95, 0.95, 0.36, outline=rgba(ring_outer), width=outer_w)
        vc.rounded_rect(-0.85, -0.85, 0.85, 0.85, 0.29, outline=rgba(ring_inner, 160), width=inner_w)
    elif shape == "shield":
        vc.polygon(_shield_pts(0.98), outline=rgba(ring_outer), width=outer_w)
        vc.polygon(_shield_pts(0.87), outline=rgba(ring_inner, 160), width=inner_w)
    elif shape == "octagon":
        vc.polygon(_octagon_pts(0.98), outline=rgba(ring_outer), width=outer_w)
        vc.polygon(_octagon_pts(0.87), outline=rgba(ring_inner, 160), width=inner_w)
    else:
        vc.circle(0.0, 0.0, 0.96, outline=rgba(ring_outer), width=outer_w)
        vc.circle(0.0, 0.0, 0.85, outline=rgba(ring_inner, 160), width=inner_w)

    vc.primitives += 2
    return interior_mid, (32, 34, 38)


# ---------------------------------------------------------------------------
# 20 Distinct High-Precision Industry Vector Icons (strict 70% inner safe zone)
# ---------------------------------------------------------------------------
def _icon_noodle(vc: VectorCanvas):
    """1. 桂林米粉/粉馆: 青花瓷碗 + 浅米白粉条与葱花 + 卤菜片 + 热气 + 留白筷子."""
    ink = rgba(tone("#1F2A3A", 0.10))
    cobalt = rgba(tone("#234E8C", 0.14))
    porcelain = rgba((248, 248, 245))
    porcelain_sh = rgba((222, 228, 236))
    wood = rgba(tone("#7E4624", 0.14))
    wood_hi = rgba(tone("#B67442", 0.14))
    noodle_cream = rgba((248, 240, 214))
    meat = rgba(tone("#9A3A2C", 0.14))
    scallion = rgba(tone("#429648", 0.14))
    steam = rgba(tone("#C67C3A", 0.14), 220)

    # Three graceful steam wisps shifted slightly left to stay well clear of chopsticks
    for sx, h_top in ((-0.34, -0.52), (-0.14, -0.60), (0.04, -0.50)):
        vc.stroke_cubic(
            (sx, -0.14), (sx - 0.08, -0.28), (sx + 0.09, -0.39), (sx - 0.01, h_top),
            width=0.048, color=steam,
        )

    # Diagonal crossed bamboo chopsticks neatly inside safe zone (pulled inward from rim)
    vc.stroke_line((-0.08, -0.02), (0.50, -0.48), width=0.062, color=ink)
    vc.stroke_line((-0.08, -0.02), (0.50, -0.48), width=0.036, color=wood_hi)
    vc.stroke_line((0.06, -0.02), (0.56, -0.30), width=0.058, color=ink)
    vc.stroke_line((0.06, -0.02), (0.56, -0.30), width=0.034, color=wood)

    # Appetizing creamy rice-noodle mound + braised meat slices + bright scallion garnish
    vc.ellipse(0.0, 0.03, 0.48, 0.15, fill=noodle_cream, outline=ink, width=0.030)
    # Creamy rice-noodle curves across mound
    for ny in (-0.04, 0.01):
        vc.stroke_quad((-0.34, ny), (-0.06, ny - 0.08), (0.28, ny + 0.01), width=0.030, color=rgba(tone("#D8B878", 0.10)))
    # Savory braised beef/guoshao slices
    vc.ellipse(-0.22, -0.04, 0.15, 0.085, fill=meat, outline=ink, width=0.024, angle_deg=-12)
    vc.ellipse(0.08, -0.05, 0.14, 0.080, fill=rgba(tone("#B04C32", 0.14)), outline=ink, width=0.024, angle_deg=12)
    # Crisp bright green scallion rings
    for gx, gy in ((-0.34, 0.01), (-0.06, 0.03), (0.24, 0.00)):
        vc.circle(gx, gy, 0.048, fill=scallion, outline=ink, width=0.018)

    # Blue-and-white porcelain bowl pedestal foot
    vc.polygon([(-0.22, 0.46), (0.22, 0.46), (0.27, 0.58), (-0.27, 0.58)], fill=porcelain_sh, outline=ink, width=0.032)
    vc.stroke_line((-0.23, 0.52), (0.23, 0.52), width=0.030, color=cobalt)

    # Main porcelain bowl body (compact & balanced inside safe zone)
    bowl_pts = [(-0.56, 0.04)]
    bowl_pts += cubic_bezier((-0.56, 0.04), (-0.52, 0.40), (-0.26, 0.49), (0.0, 0.49), steps=18)[1:]
    bowl_pts += cubic_bezier((0.0, 0.49), (0.26, 0.49), (0.52, 0.40), (0.56, 0.04), steps=18)[1:]
    vc.polygon(bowl_pts, fill=porcelain, outline=ink, width=0.038)

    # Cobalt Qinghua porcelain decorative band & wave dots
    vc.stroke_quad((-0.50, 0.14), (0.0, 0.22), (0.50, 0.14), width=0.060, color=cobalt)
    vc.stroke_quad((-0.42, 0.31), (0.0, 0.38), (0.42, 0.31), width=0.032, color=cobalt)
    for dx in (-0.28, -0.14, 0.0, 0.14, 0.28):
        vc.circle(dx, 0.25 + (1.0 - abs(dx) * 1.5) * 0.035, 0.034, fill=cobalt)
    vc.stroke_quad((-0.41, 0.14), (-0.37, 0.28), (-0.24, 0.38), width=0.030, color=(255, 255, 255, 215))


def _icon_pharmacy(vc: VectorCanvas):
    """2. 便民药房: 双层医用盾牌 + 饱满白十字 + 鲜嫩黄绿草叶(安全内收+白描边分离)."""
    ink = rgba(tone("#1A3528", 0.10))
    emerald = rgba(tone("#1F7A4D", 0.14))
    emerald_sh = rgba(tone("#165E3B", 0.14))
    leaf_fresh = rgba(tone("#74C452", 0.12))
    white = rgba((252, 253, 250))

    # Inner medical shield cleanly centered with safe margin
    vc.polygon(_shield_pts(0.64), fill=emerald, outline=ink, width=0.038)
    right_shield = [(0.0, -0.60), (0.51, -0.51)]
    right_shield += quad_bezier((0.51, -0.51), (0.55, 0.15), (0.0, 0.60), steps=14)[1:]
    vc.polygon(right_shield, fill=rgba(tone("#165E3B", 0.14), 125))

    # Crisp luminous medical cross
    vc.rounded_rect(-0.13, -0.37, 0.13, 0.25, 0.05, fill=white, outline=ink, width=0.028)
    vc.rounded_rect(-0.34, -0.18, 0.34, 0.08, 0.05, fill=white, outline=ink, width=0.028)
    vc.rounded_rect(-0.10, -0.34, 0.10, 0.22, 0.04, fill=white)
    vc.rounded_rect(-0.31, -0.15, 0.31, 0.05, 0.04, fill=white)

    # Fresh bright spring-green herbal leaf neatly tucked inside lower-right shield (with crisp white separation halo)
    l1 = leaf_pts((0.02, 0.48), (0.44, 0.16), bulge=0.36)
    l2 = leaf_pts((0.02, 0.48), (-0.30, 0.32), bulge=0.34)
    vc.polygon(l2, fill=leaf_fresh, outline=white, width=0.048)
    vc.polygon(l2, fill=rgba(tone("#5AA846", 0.12)), outline=ink, width=0.024)
    vc.polygon(l1, fill=leaf_fresh, outline=white, width=0.052)
    vc.polygon(l1, fill=leaf_fresh, outline=ink, width=0.026)
    vc.stroke_quad((0.08, 0.44), (0.24, 0.32), (0.37, 0.21), width=0.020, color=emerald_sh)
    vc.sparkle(-0.42, -0.42, 0.09, rgba(tone("#E2B244", 0.12)))


def _icon_tcm(vc: VectorCanvas):
    """3. 中医养生/诊所: 精致双肚葫芦 + 底部不对称环抱草叶 + 醒目朱砂方印."""
    ink = rgba(tone("#2A1D15", 0.10))
    gourd_main = rgba(tone("#C68E36", 0.14))
    gourd_hi = rgba(tone("#E8BC64", 0.14))
    gourd_sh = rgba(tone("#9A6422", 0.14))
    ribbon = rgba(tone("#A82C26", 0.14))
    leaf = rgba(tone("#3A824E", 0.14))
    leaf_hi = rgba(tone("#5AA468", 0.14))

    # Asymmetric cradling herbal leaves at lower-left & lower-right base (NOT symmetric owl wings!)
    vc.polygon(leaf_pts((-0.10, 0.56), (-0.58, 0.14), bulge=0.36), fill=leaf, outline=ink, width=0.030)
    vc.stroke_quad((-0.16, 0.50), (-0.36, 0.34), (-0.50, 0.20), width=0.022, color=rgba((234, 246, 234), 210))
    vc.polygon(leaf_pts((0.18, 0.56), (0.56, 0.34), bulge=-0.34), fill=leaf_hi, outline=ink, width=0.028)
    vc.stroke_line((0.24, 0.52), (0.48, 0.39), width=0.020, color=rgba((234, 246, 234), 200))

    # Gourd stem stopper (compact, safe top margin)
    vc.stroke_quad((0.0, -0.46), (0.04, -0.58), (0.14, -0.62), width=0.058, color=ink)
    vc.stroke_quad((0.0, -0.46), (0.04, -0.58), (0.14, -0.62), width=0.032, color=rgba(tone("#7E5028", 0.14)))
    vc.rounded_rect(-0.09, -0.52, 0.09, -0.40, 0.03, fill=gourd_sh, outline=ink, width=0.026)

    # Balanced double-bellied gourd
    vc.ellipse(0.0, 0.22, 0.37, 0.35, fill=gourd_main, outline=ink, width=0.038)
    vc.ellipse(0.0, -0.26, 0.23, 0.21, fill=gourd_main, outline=ink, width=0.038)
    vc.ellipse(0.0, -0.05, 0.15, 0.13, fill=gourd_main)

    # Warm specular highlights on both bellies
    vc.stroke_quad((-0.21, 0.08), (-0.25, 0.22), (-0.16, 0.38), width=0.040, color=gourd_hi)
    vc.stroke_quad((-0.12, -0.35), (-0.14, -0.26), (-0.09, -0.18), width=0.030, color=gourd_hi)

    # Crimson waist ribbon sash & knot
    vc.rounded_rect(-0.20, -0.10, 0.20, 0.00, 0.04, fill=ribbon, outline=ink, width=0.026)
    vc.stroke_quad((0.08, -0.04), (0.24, 0.06), (0.28, 0.22), width=0.050, color=ribbon)
    vc.circle(0.0, -0.05, 0.068, fill=ribbon, outline=ink, width=0.024)

    # Bold vermilion traditional herbal seal square on lower belly (crystal legible at 640x160!)
    vc.rounded_rect(-0.15, 0.10, 0.15, 0.38, 0.04, fill=ribbon, outline=rgba((248, 240, 218)), width=0.026)
    vc.stroke_line((0.0, 0.15), (0.0, 0.33), width=0.046, color=rgba((250, 244, 228)))
    vc.stroke_line((-0.09, 0.24), (0.09, 0.24), width=0.046, color=rgba((250, 244, 228)))


def _icon_flower(vc: VectorCanvas):
    """4. 花艺/花店: 叠层重瓣山茶玫瑰 + 错落双叶(非呆板对称)."""
    ink = rgba(tone("#3A1E28", 0.10))
    petal_deep = rgba(tone("#B63E58", 0.14))
    petal_mid = rgba(tone("#D86880", 0.14))
    petal_hi = rgba(tone("#EE9EB0", 0.14))
    stamen = rgba(tone("#E8B844", 0.14))
    stem_c = rgba(tone("#2E6E48", 0.14))
    leaf_c = rgba(tone("#4B945C", 0.14))

    # Graceful curved botanical stem (shortened neatly inside bottom safe zone)
    vc.stroke_quad((0.0, 0.04), (-0.06, 0.34), (0.04, 0.58), width=0.058, color=ink)
    vc.stroke_quad((0.0, 0.04), (-0.06, 0.34), (0.04, 0.58), width=0.032, color=stem_c)

    # Staggered organic leaves (higher left leaf, lower right leaf -> botanical grace!)
    vc.polygon(leaf_pts((-0.03, 0.36), (-0.54, 0.12), bulge=0.38), fill=leaf_c, outline=ink, width=0.030)
    vc.stroke_line((-0.09, 0.33), (-0.42, 0.17), width=0.020, color=rgba((236, 248, 238), 210))
    vc.polygon(leaf_pts((0.01, 0.50), (0.50, 0.26), bulge=-0.38), fill=stem_c, outline=ink, width=0.030)
    vc.stroke_line((0.07, 0.47), (0.39, 0.31), width=0.020, color=rgba((236, 248, 238), 210))

    # Layered 5-petal organic camellia bloom
    bcx, bcy = 0.0, -0.18
    for i in range(5):
        ang = i * 72.0 - 90.0
        rad = math.radians(ang)
        px = bcx + math.cos(rad) * 0.23
        py = bcy + math.sin(rad) * 0.23
        vc.ellipse(px, py, 0.23, 0.19, fill=petal_deep, outline=ink, width=0.028, angle_deg=ang)

    # Inner staggered rose-pink petals
    for i in range(5):
        ang = i * 72.0 - 54.0
        rad = math.radians(ang)
        px = bcx + math.cos(rad) * 0.14
        py = bcy + math.sin(rad) * 0.14
        vc.ellipse(px, py, 0.16, 0.13, fill=petal_mid, outline=ink, width=0.022, angle_deg=ang)

    # Soft inner cupped petals + golden stamen core
    vc.circle(bcx, bcy, 0.15, fill=petal_hi, outline=ink, width=0.024)
    vc.circle(bcx, bcy, 0.095, fill=stamen, outline=ink, width=0.024)
    for i in range(5):
        a = math.radians(i * 72.0)
        vc.circle(bcx + math.cos(a) * 0.048, bcy + math.sin(a) * 0.048, 0.020, fill=rgba(tone("#A66818", 0.14)))


def _icon_tea(vc: VectorCanvas):
    """5. 茶社/桂花茶行: 紫砂壶(长尖流+全把+盖钮) + 粗清晰茶烟 + 前景桂花枝叶(严禁撞框)."""
    ink = rgba(tone("#2A1D16", 0.10))
    clay = rgba(tone("#8C442A", 0.14))
    clay_hi = rgba(tone("#C0744E", 0.14))
    clay_dark = rgba(tone("#642D1B", 0.14))
    leaf = rgba(tone("#3E824E", 0.14))
    gold = rgba(tone("#E4B038", 0.14))
    steam = rgba(tone("#BC8A46", 0.14), 225)

    # Clear bold rising tea aroma steam (matching coffee/noodle stroke weight!)
    vc.stroke_cubic((-0.44, -0.22), (-0.50, -0.36), (-0.36, -0.46), (-0.40, -0.58), width=0.048, color=steam)
    vc.stroke_cubic((-0.24, -0.32), (-0.30, -0.44), (-0.18, -0.52), (-0.22, -0.62), width=0.042, color=steam)

    # Shifted slightly up-left so teapot + foreground osmanthus sit comfortably inside safe zone
    ox, oy = -0.02, 0.04

    # Elongated graceful tapered S-spout (left)
    spout_pts = [(ox - 0.24, oy + 0.14)]
    spout_pts += cubic_bezier((ox - 0.24, oy + 0.14), (ox - 0.50, oy + 0.12), (ox - 0.48, oy - 0.12), (ox - 0.60, oy - 0.18), steps=14)[1:]
    spout_pts += [(ox - 0.52, oy - 0.24)]
    spout_pts += cubic_bezier((ox - 0.52, oy - 0.24), (ox - 0.38, oy - 0.14), (ox - 0.38, oy - 0.00), (ox - 0.20, oy - 0.02), steps=14)[1:]
    vc.polygon(spout_pts, fill=clay, outline=ink, width=0.032)

    # Full crisp arched ear handle (right, completely visible)
    handle = cubic_bezier((ox + 0.24, oy - 0.16), (ox + 0.60, oy - 0.18), (ox + 0.62, oy + 0.24), (ox + 0.24, oy + 0.24), steps=18)
    vc.stroke_polyline(handle, width=0.102, color=ink)
    vc.stroke_polyline(handle, width=0.058, color=clay)

    # Plump Zisha teapot body & foot
    vc.rounded_rect(ox - 0.20, oy + 0.32, ox + 0.20, oy + 0.40, 0.03, fill=clay_dark, outline=ink, width=0.028)
    vc.ellipse(ox, oy + 0.06, 0.38, 0.31, fill=clay, outline=ink, width=0.038)
    # Domed lid + round lid bead
    vc.ellipse(ox, oy - 0.23, 0.24, 0.095, fill=clay_hi, outline=ink, width=0.032)
    vc.circle(ox, oy - 0.34, 0.072, fill=clay_hi, outline=ink, width=0.028)
    # Specular highlight
    vc.stroke_quad((ox - 0.21, oy - 0.04), (ox - 0.24, oy + 0.09), (ox - 0.14, oy + 0.21), width=0.038, color=clay_hi)

    # Foreground tea leaf & 3 golden osmanthus blossoms cleanly anchored below pot belly (zero octagon clipping!)
    vc.polygon(leaf_pts((-0.08, 0.46), (0.38, 0.34), bulge=0.32), fill=leaf, outline=ink, width=0.026)
    vc.stroke_line((-0.02, 0.44), (0.28, 0.37), width=0.018, color=rgba((232, 246, 232), 205))
    for dx, dy in ((0.22, 0.48), (0.34, 0.44), (0.27, 0.55)):
        vc.circle(dx, dy, 0.048, fill=gold, outline=ink, width=0.018)


def _icon_coffee(vc: VectorCanvas):
    """6. 咖啡馆: 手冲咖啡杯 + 瓷沿高光 + 轻盈杯碟 + 三缕热气弧 + 咖啡豆."""
    ink = rgba(tone("#261B14", 0.10))
    cup_body = rgba(tone("#5C3824", 0.14))
    cup_hi = rgba(tone("#926040", 0.14))
    crema = rgba(tone("#C88A44", 0.14))
    saucer = rgba(tone("#3E2A20", 0.14))
    steam = rgba(tone("#AC7846", 0.14), 220)

    # Three rising aroma waves well inside top safe zone
    for sx, top_y in ((-0.24, -0.54), (0.0, -0.62), (0.24, -0.54)):
        vc.stroke_cubic((sx, -0.18), (sx - 0.08, -0.31), (sx + 0.09, -0.43), (sx - 0.01, top_y), width=0.046, color=steam)

    # Sleeker porcelain saucer plate with subtle horizontal gloss
    vc.ellipse(0.0, 0.49, 0.58, 0.105, fill=saucer, outline=ink, width=0.034)
    vc.stroke_quad((-0.34, 0.47), (0.0, 0.51), (0.34, 0.47), width=0.022, color=rgba((184, 154, 126), 195))

    # D-shaped cup handle
    handle = cubic_bezier((0.32, -0.05), (0.64, -0.05), (0.62, 0.30), (0.28, 0.28), steps=18)
    vc.stroke_polyline(handle, width=0.105, color=ink)
    vc.stroke_polyline(handle, width=0.060, color=cup_body)

    # Tapered artisan mug body
    mug_pts = [(-0.40, -0.13), (0.38, -0.13)]
    mug_pts += cubic_bezier((0.38, -0.13), (0.36, 0.30), (0.24, 0.44), (0.0, 0.44), steps=14)[1:]
    mug_pts += cubic_bezier((0.0, 0.44), (-0.25, 0.44), (-0.38, 0.30), (-0.40, -0.13), steps=14)[1:]
    vc.polygon(mug_pts, fill=cup_body, outline=ink, width=0.038)

    # Porcelain cup rim (bright ivory ring framing dark crema liquid!)
    vc.ellipse(-0.01, -0.13, 0.40, 0.095, fill=rgba((246, 240, 228)), outline=ink, width=0.030)
    vc.ellipse(-0.01, -0.13, 0.32, 0.058, fill=crema)
    # Specular cup highlight
    vc.stroke_quad((-0.27, 0.02), (-0.25, 0.20), (-0.16, 0.33), width=0.034, color=cup_hi)

    # Emblematic roasted coffee bean badge on mug belly
    vc.ellipse(0.0, 0.16, 0.14, 0.10, fill=rgba((246, 236, 218)), outline=ink, width=0.024, angle_deg=-24)
    vc.stroke_quad((-0.08, 0.20), (0.0, 0.15), (0.08, 0.12), width=0.022, color=cup_body)


def _icon_bakery(vc: VectorCanvas):
    """7. 烘焙面包: 雕塑感月牙尖角牛角可颂(非球状毛毛虫) + 简洁大颗黄金麦穗."""
    ink = rgba(tone("#3A2212", 0.10))
    crust = rgba(tone("#D48A30", 0.14))
    crust_dark = rgba(tone("#A25E1C", 0.14))
    crust_hi = rgba(tone("#F2C468", 0.14))
    wheat = rgba(tone("#CA9832", 0.14))

    # Clean, bold golden wheat arc below croissant (4 crisp large kernels per side — zero clutter!)
    vc.stroke_quad((-0.44, 0.44), (0.0, 0.56), (0.44, 0.44), width=0.034, color=crust_dark)
    for wx, wy, ang in ((-0.26, 0.48, -18), (-0.09, 0.53, -6), (0.09, 0.53, 6), (0.26, 0.48, 18)):
        vc.ellipse(wx, wy - 0.05, 0.082, 0.040, fill=crust_hi, outline=ink, width=0.022, angle_deg=ang - 24)
        vc.ellipse(wx, wy + 0.05, 0.082, 0.040, fill=wheat, outline=ink, width=0.022, angle_deg=ang + 24)

    # True crescent croissant outer silhouette: plump arched center tapering to sharp curved horn tips!
    crescent: list[Pt] = [(-0.60, 0.20)]  # sharp left horn tip
    crescent += cubic_bezier((-0.60, 0.20), (-0.48, -0.44), (0.48, -0.44), (0.60, 0.20), steps=26)[1:]
    crescent += cubic_bezier((0.60, 0.20), (0.40, 0.24), (0.26, 0.04), (0.0, 0.04), steps=14)[1:]
    crescent += cubic_bezier((0.0, 0.04), (-0.26, 0.04), (-0.40, 0.24), (-0.60, 0.20), steps=14)[1:-1]
    vc.polygon(crescent, fill=crust, outline=ink, width=0.040)

    # Shaded laminated horn tips
    left_tip = [(-0.60, 0.20)] + quad_bezier((-0.60, 0.20), (-0.52, -0.06), (-0.36, -0.14), steps=10)[1:] + [(-0.28, 0.12)]
    right_tip = [(0.60, 0.20)] + quad_bezier((0.60, 0.20), (0.52, -0.06), (0.36, -0.14), steps=10)[1:] + [(0.28, 0.12)]
    vc.polygon(left_tip, fill=crust_dark, outline=ink, width=0.028)
    vc.polygon(right_tip, fill=crust_dark, outline=ink, width=0.028)

    # Crisp diagonal laminated-pastry fold ribs (classic layered French croissant anatomy)
    vc.stroke_quad((-0.20, -0.26), (-0.24, -0.08), (-0.18, 0.05), width=0.036, color=ink)
    vc.stroke_quad((0.20, -0.26), (0.24, -0.08), (0.18, 0.05), width=0.036, color=ink)
    vc.stroke_quad((-0.38, -0.15), (-0.38, 0.00), (-0.31, 0.12), width=0.030, color=ink)
    vc.stroke_quad((0.38, -0.15), (0.38, 0.00), (0.31, 0.12), width=0.030, color=ink)

    # Glossy butter highlights along upper pastry ridges
    vc.stroke_quad((-0.11, -0.22), (0.0, -0.26), (0.11, -0.22), width=0.044, color=crust_hi)
    vc.stroke_quad((-0.31, -0.14), (-0.26, -0.18), (-0.23, -0.10), width=0.030, color=crust_hi)
    vc.stroke_quad((0.23, -0.10), (0.26, -0.18), (0.31, -0.14), width=0.030, color=crust_hi)

    vc.sparkle(-0.40, -0.44, 0.085, crust_hi)
    vc.sparkle(0.40, -0.42, 0.075, crust_hi)


def _icon_dessert(vc: VectorCanvas):
    """8. 糖水铺/甜品/茶饮: 穹顶奶茶杯 + 安全边距吸管 + 高对比柠檬片 + 珍珠."""
    ink = rgba(tone("#2A1D22", 0.10))
    tea_fill = rgba(tone("#CC7A38", 0.14))
    tea_top = rgba(tone("#F2DCC0", 0.14))
    dome = rgba((246, 250, 252), 220)
    straw = rgba(tone("#C4424A", 0.14))
    lemon = rgba(tone("#F2D24B", 0.10))
    pearl = rgba(tone("#30221C", 0.12))

    # Angled boba straw cleanly inside top safe zone
    vc.stroke_line((0.02, -0.06), (0.24, -0.60), width=0.088, color=ink)
    vc.stroke_line((0.02, -0.06), (0.24, -0.60), width=0.052, color=straw)

    # Domed lid
    dome_pts = arc_pts(0.0, -0.15, 0.38, 0.30, 180, 360, steps=20) + [(0.38, -0.15), (-0.38, -0.15)]
    vc.polygon(dome_pts, fill=dome, outline=ink, width=0.034)

    # Tapered cup silhouette
    cup = [(-0.38, -0.13), (0.38, -0.13), (0.27, 0.58), (-0.27, 0.58)]
    vc.polygon(cup, fill=tea_fill, outline=ink, width=0.038)
    vc.polygon([(-0.36, -0.11), (0.36, -0.11), (0.33, 0.06), (-0.33, 0.06)], fill=tea_top)

    # Lid rim collar
    vc.rounded_rect(-0.44, -0.19, 0.44, -0.09, 0.04, fill=rgba((252, 250, 246)), outline=ink, width=0.030)

    # High-contrast bright lemon wheel slice inside cup
    vc.circle(0.08, 0.21, 0.16, fill=lemon, outline=rgba((254, 252, 240)), width=0.034)
    for k in range(6):
        a = math.radians(k * 60)
        vc.stroke_line((0.08, 0.21), (0.08 + math.cos(a) * 0.13, 0.21 + math.sin(a) * 0.13), width=0.024, color=rgba((254, 252, 240)))

    # Boba tapioca pearls at bottom
    for px, py in ((-0.16, 0.49), (-0.05, 0.51), (0.06, 0.49), (0.16, 0.50), (-0.10, 0.41), (0.03, 0.42)):
        vc.circle(px, py, 0.046, fill=pearl)

    # Crisp glass reflection
    vc.stroke_line((-0.26, -0.01), (-0.20, 0.44), width=0.032, color=(255, 255, 255, 200))


def _icon_fruit(vc: VectorCanvas):
    """9. 鲜果/生鲜超市: 经典双弧红苹果 + 鲜绿叶 + 清晰柑橘切面."""
    ink = rgba(tone("#2A1E18", 0.10))
    apple_red = rgba(tone("#C44236", 0.14))
    apple_hi = rgba(tone("#EC8A70", 0.14))
    orange_c = rgba(tone("#DF8E2E", 0.14))
    leaf_c = rgba(tone("#3B8A46", 0.14))
    stem_c = rgba(tone("#644224", 0.14))

    # Woody stem & twin veined leaves safely inside top zone
    vc.stroke_quad((-0.12, -0.30), (-0.10, -0.49), (-0.02, -0.60), width=0.056, color=stem_c)
    vc.polygon(leaf_pts((-0.08, -0.43), (0.42, -0.56), bulge=0.36), fill=leaf_c, outline=ink, width=0.030)
    vc.polygon(leaf_pts((-0.12, -0.42), (-0.48, -0.50), bulge=-0.34), fill=rgba(tone("#2B6E38", 0.14)), outline=ink, width=0.028)
    vc.stroke_line((0.00, -0.45), (0.32, -0.53), width=0.020, color=rgba((232, 248, 232), 210))

    # Classic crisp symmetrical apple silhouette (with bottom cleft)
    ax, ay = -0.14, 0.08
    apple_pts: list[Pt] = [(ax, ay - 0.34)]
    apple_pts += cubic_bezier((ax, ay - 0.34), (ax + 0.34, ay - 0.46), (ax + 0.48, ay - 0.06), (ax + 0.32, ay + 0.32), steps=16)[1:]
    apple_pts += quad_bezier((ax + 0.32, ay + 0.32), (ax + 0.14, ay + 0.46), (ax, ay + 0.34), steps=10)[1:]
    apple_pts += quad_bezier((ax, ay + 0.34), (ax - 0.14, ay + 0.46), (ax - 0.32, ay + 0.32), steps=10)[1:]
    apple_pts += cubic_bezier((ax - 0.32, ay + 0.32), (ax - 0.48, ay - 0.06), (ax - 0.34, ay - 0.46), (ax, ay - 0.34), steps=16)[1:-1]
    vc.polygon(apple_pts, fill=apple_red, outline=ink, width=0.038)

    # Glossy crescent highlight
    vc.stroke_quad((ax - 0.24, ay - 0.16), (ax - 0.28, ay + 0.02), (ax - 0.18, ay + 0.18), width=0.048, color=apple_hi)
    vc.circle(ax - 0.21, ay - 0.23, 0.034, fill=(255, 245, 235, 220))

    # Companion fresh citrus wheel overlapping bottom-right with bold crisp white radial segments
    vc.circle(0.28, 0.24, 0.30, fill=orange_c, outline=ink, width=0.036)
    vc.circle(0.28, 0.24, 0.23, fill=rgba((252, 244, 218)))
    vc.circle(0.28, 0.24, 0.19, fill=rgba(tone("#E8A034", 0.14)))
    for k in range(6):
        a = math.radians(k * 60 + 15)
        vc.stroke_line((0.28, 0.24), (0.28 + math.cos(a) * 0.20, 0.24 + math.sin(a) * 0.20), width=0.030, color=rgba((254, 248, 226)))
    vc.circle(0.28, 0.24, 0.045, fill=rgba((254, 248, 226)))


def _icon_food(vc: VectorCanvas):
    """10. 小炒/卤味/烧烤/餐饮: 喜庆中式红灯笼(厚实金环帽 + 饱满束状流苏 + 安全边距)."""
    ink = rgba(tone("#2A1816", 0.10))
    crimson = rgba(tone("#B8322A", 0.14))
    glow_core = rgba(tone("#E0663A", 0.14))
    gold = rgba(tone("#E2B03E", 0.14))
    gold_dark = rgba(tone("#9A6A1A", 0.14))

    # Solid top hanging loop inside safe margin
    vc.circle(0.0, -0.56, 0.075, outline=ink, width=0.056)
    vc.circle(0.0, -0.56, 0.075, outline=gold, width=0.032)

    # Full, lush tapered silk tassel body (NOT 3 thin chicken-foot sticks!)
    tassel = [(-0.06, 0.34), (0.06, 0.34), (0.14, 0.60), (-0.14, 0.60)]
    vc.polygon(tassel, fill=crimson, outline=ink, width=0.030)
    vc.stroke_line((-0.04, 0.42), (-0.06, 0.57), width=0.024, color=gold)
    vc.stroke_line((0.04, 0.42), (0.06, 0.57), width=0.024, color=gold)
    vc.circle(0.0, 0.34, 0.068, fill=gold, outline=ink, width=0.026)

    # Main lantern oval body (compact vertical span)
    vc.ellipse(0.0, -0.08, 0.52, 0.36, fill=crimson, outline=ink, width=0.040)
    vc.ellipse(0.0, -0.08, 0.32, 0.26, fill=glow_core)

    # Curved structural golden lantern ribs
    for rx in (0.36, 0.18):
        vc.ellipse(0.0, -0.08, rx, 0.35, outline=gold, width=0.026)
    vc.stroke_line((0.0, -0.43), (0.0, 0.27), width=0.026, color=gold)

    # Solid golden top & bottom ferrules
    vc.rounded_rect(-0.24, -0.48, 0.24, -0.36, 0.04, fill=gold, outline=ink, width=0.032)
    vc.rounded_rect(-0.20, 0.20, 0.20, 0.31, 0.04, fill=gold, outline=ink, width=0.032)

    # Center decorative diamond emblem with inner red dot motif
    vc.polygon([(0.0, -0.22), (0.14, -0.08), (0.0, 0.06), (-0.14, -0.08)], fill=gold, outline=ink, width=0.026)
    vc.polygon([(0.0, -0.15), (0.07, -0.08), (0.0, -0.01), (-0.07, -0.08)], fill=crimson)


def _icon_fashion(vc: VectorCanvas):
    """11. 男女服饰/童装/裁缝: 领口内置挂钩的时尚剪裁大衣/风衣轮廓(杜绝浮空衣架穿帮)."""
    ink = rgba(tone("#242024", 0.10))
    gold_hook = rgba(tone("#C69842", 0.14))
    coat = rgba(tone("#9A484A", 0.14))
    coat_sh = rgba(tone("#763236", 0.14))
    lining = rgba((246, 238, 224))
    belt = rgba(tone("#D2A44C", 0.14))

    # Sleek metallic hanger hook emerging cleanly ONLY from inside the collar neck (no floating triangle!)
    hook = arc_pts(0.0, -0.50, 0.11, 0.11, 180, 415, steps=18)
    vc.stroke_polyline(hook, width=0.056, color=ink)
    vc.stroke_polyline(hook, width=0.030, color=gold_hook)
    vc.stroke_line((0.0, -0.39), (0.0, -0.28), width=0.046, color=ink)

    # Chic belted boutique blazer/coat silhouette draping naturally from shoulder line
    garment = [
        (-0.54, -0.12), (-0.22, -0.30), (0.22, -0.30), (0.54, -0.12),
        (0.58, 0.18), (0.40, 0.20), (0.36, 0.02),
        (0.42, 0.56), (-0.42, 0.56),
        (-0.36, 0.02), (-0.40, 0.20), (-0.58, 0.18),
    ]
    vc.polygon(garment, fill=coat, outline=ink, width=0.038)

    # Inner V-neckline cream lining & sharp fashion lapels
    vc.polygon([(-0.18, -0.30), (0.18, -0.30), (0.0, 0.08)], fill=lining, outline=ink, width=0.026)
    vc.polygon([(-0.22, -0.30), (0.0, 0.08), (-0.28, -0.02)], fill=coat_sh, outline=ink, width=0.026)
    vc.polygon([(0.22, -0.30), (0.0, 0.08), (0.28, -0.02)], fill=coat_sh, outline=ink, width=0.026)

    # Center coat seam + stylish golden waist belt & clasp
    vc.stroke_line((0.0, 0.08), (0.0, 0.54), width=0.024, color=ink)
    vc.rounded_rect(-0.38, 0.16, 0.38, 0.26, 0.03, fill=belt, outline=ink, width=0.026)
    vc.rounded_rect(-0.08, 0.14, 0.08, 0.28, 0.02, fill=lining, outline=ink, width=0.024)
    # Minimal tailored lapel buttons
    for bx in (-0.14, 0.14):
        vc.circle(bx, 0.39, 0.034, fill=belt, outline=ink, width=0.018)


def _icon_salon(vc: VectorCanvas):
    """12. 美发造型: 轻奢金属精剪剪刀 + 清晰分离宽齿造型梳(零拥堵、高级银金配色)."""
    ink = rgba(tone("#1E2228", 0.10))
    steel = rgba(tone("#74808E", 0.12))
    steel_hi = rgba(tone("#C8D2DC", 0.12))
    comb_c = rgba(tone("#424C5A", 0.12))
    champagne = rgba(tone("#C8A252", 0.14))

    # Clean, well-separated wide-tooth styling comb tucked neatly on upper-left (ZERO overlap with finger rings!)
    comb_spine = rotate_pts([(-0.36, -0.10), (0.36, -0.10), (0.36, 0.02), (-0.36, 0.02)], 0.0, 0.0, -48)
    comb_spine = [(x - 0.26, y - 0.16) for x, y in comb_spine]
    vc.polygon(comb_spine, fill=comb_c, outline=ink, width=0.028)
    for ti in range(6):
        tx = -0.28 + ti * 0.112
        tooth = rotate_pts([(tx, 0.02), (tx, 0.20)], 0.0, 0.0, -48)
        vc.stroke_line((tooth[0][0] - 0.26, tooth[0][1] - 0.16), (tooth[1][0] - 0.26, tooth[1][1] - 0.16), width=0.044, color=comb_c)

    # Precision barber shears shifted slightly right-down for balanced asymmetric duo
    sx, sy = 0.08, 0.02
    blade1 = [(sx - 0.07, sy + 0.10), (sx + 0.05, sy + 0.06), (sx - 0.28, sy - 0.52), (sx - 0.35, sy - 0.44)]
    blade2 = [(sx + 0.07, sy + 0.10), (sx - 0.05, sy + 0.06), (sx + 0.28, sy - 0.52), (sx + 0.35, sy - 0.44)]
    vc.polygon(blade1, fill=steel_hi, outline=ink, width=0.032)
    vc.polygon(blade2, fill=steel, outline=ink, width=0.032)

    # Shanks & champagne-gold finger loops comfortably inside bottom safe zone
    vc.stroke_line((sx - 0.02, sy + 0.10), (sx - 0.25, sy + 0.36), width=0.064, color=ink)
    vc.stroke_line((sx - 0.02, sy + 0.10), (sx - 0.25, sy + 0.36), width=0.032, color=steel_hi)
    vc.stroke_line((sx + 0.02, sy + 0.10), (sx + 0.25, sy + 0.36), width=0.064, color=ink)
    vc.stroke_line((sx + 0.02, sy + 0.10), (sx + 0.25, sy + 0.36), width=0.032, color=steel)

    vc.circle(sx - 0.28, sy + 0.40, 0.145, outline=ink, width=0.080)
    vc.circle(sx - 0.28, sy + 0.40, 0.145, outline=champagne, width=0.040)
    vc.circle(sx + 0.28, sy + 0.40, 0.145, outline=ink, width=0.080)
    vc.circle(sx + 0.28, sy + 0.40, 0.145, outline=champagne, width=0.040)

    # Brass pivot screw & clean subtle gleam
    vc.circle(sx, sy + 0.06, 0.068, fill=champagne, outline=ink, width=0.026)
    vc.sparkle(sx + 0.34, sy - 0.44, 0.085, champagne)


def _icon_books(vc: VectorCanvas):
    """13. 书社/文具/图文快印: 展开精装书 + 居中红书签 + 完整斜置钢笔(笔尖朝左下写向书页)."""
    ink = rgba(tone("#1F2836", 0.10))
    cover = rgba(tone("#2C4E74", 0.14))
    page = rgba((250, 247, 238))
    page_sh = rgba((226, 220, 206))
    ribbon = rgba(tone("#B63E38", 0.14))
    pen_body = rgba(tone("#8C3236", 0.14))
    gold = rgba(tone("#D8A63E", 0.14))

    # Hardcover back board
    vc.rounded_rect(-0.58, -0.10, 0.58, 0.52, 0.05, fill=cover, outline=ink, width=0.036)

    # Left & right arched open pages
    left_p = [(-0.52, -0.15)]
    left_p += quad_bezier((-0.52, -0.15), (-0.25, -0.25), (0.0, -0.10), steps=14)[1:]
    left_p += [(0.0, 0.44)]
    left_p += quad_bezier((0.0, 0.44), (-0.25, 0.33), (-0.52, 0.42), steps=14)[1:]
    vc.polygon(left_p, fill=page, outline=ink, width=0.032)

    right_p = [(0.0, -0.10)]
    right_p += quad_bezier((0.0, -0.10), (0.25, -0.25), (0.52, -0.15), steps=14)[1:]
    right_p += [(0.52, 0.42)]
    right_p += quad_bezier((0.52, 0.42), (0.25, 0.33), (0.0, 0.44), steps=14)[1:]
    vc.polygon(right_p, fill=page_sh, outline=ink, width=0.032)

    # Crisp ruled text lines on both pages
    for ly in (0.00, 0.13, 0.26):
        vc.stroke_line((-0.41, ly), (-0.11, ly + 0.02), width=0.024, color=rgba(tone("#5A6878", 0.12)))
        vc.stroke_line((0.11, ly + 0.02), (0.41, ly), width=0.024, color=rgba(tone("#5A6878", 0.12)))

    # Centered crimson bookmark ribbon hanging cleanly from book spine
    vc.polygon([(-0.06, 0.36), (0.06, 0.36), (0.06, 0.62), (0.0, 0.55), (-0.06, 0.62)], fill=ribbon, outline=ink, width=0.022)

    # Complete angled fountain pen (barrel + gold band + nib pointing DOWN-LEFT toward right page!)
    pen_ang = 42.0  # local +y points down-left; nib at bottom-left, cap at top-right
    px, py = 0.22, -0.28
    # Barrel body (upper-right)
    barrel = rotate_pts([(-0.075, -0.36), (0.075, -0.36), (0.085, 0.08), (-0.085, 0.08)], 0.0, 0.0, pen_ang)
    vc.polygon([(x + px, y + py) for x, y in barrel], fill=pen_body, outline=ink, width=0.030)
    # Gold collar ring
    collar = rotate_pts([(-0.09, 0.04), (0.09, 0.04), (0.09, 0.12), (-0.09, 0.12)], 0.0, 0.0, pen_ang)
    vc.polygon([(x + px, y + py) for x, y in collar], fill=gold, outline=ink, width=0.022)
    # Classic gold fountain nib pointing DOWN-LEFT onto the open page
    nib = rotate_pts([(-0.08, 0.12), (0.08, 0.12), (0.00, 0.36)], 0.0, 0.0, pen_ang)
    vc.polygon([(x + px, y + py) for x, y in nib], fill=gold, outline=ink, width=0.026)
    slit = rotate_pts([(0.0, 0.20), (0.0, 0.34)], 0.0, 0.0, pen_ang)
    vc.stroke_line((slit[0][0] + px, slit[0][1] + py), (slit[1][0] + px, slit[1][1] + py), width=0.018, color=ink)


def _icon_digital(vc: VectorCanvas):
    """14. 数码通讯/手机维修: 居中智能手机 + 简洁亮屏 + 带深描边三道无线信号弧."""
    ink = rgba(tone("#1A222E", 0.10))
    chassis = rgba(tone("#2A3648", 0.14))
    screen = rgba(tone("#3E76A8", 0.14))
    screen_hi = rgba(tone("#8AC0E8", 0.14))
    signal = rgba(tone("#E29832", 0.14))
    white = rgba((248, 250, 252))

    # Harmoniously centered smartphone body (balanced with top-right signal arcs)
    vc.rounded_rect(-0.38, -0.34, 0.24, 0.56, 0.10, fill=chassis, outline=ink, width=0.038)
    vc.rounded_rect(-0.31, -0.22, 0.17, 0.42, 0.04, fill=screen, outline=ink, width=0.020)
    # Clean diagonal glass sheen (zero cluttered noise tiles!)
    vc.polygon([(-0.29, -0.20), (0.08, -0.20), (-0.29, 0.18)], fill=rgba(tone("#96C8EC", 0.12), 115))
    # Crisp minimalist screen icon motif (call/app ring + bar)
    vc.circle(-0.07, 0.06, 0.11, fill=rgba((250, 252, 255), 225), outline=ink, width=0.022)
    vc.circle(-0.07, 0.06, 0.045, fill=signal)
    vc.stroke_line((-0.19, 0.28), (0.05, 0.28), width=0.036, color=screen_hi)
    # Speaker notch & home indicator
    vc.stroke_line((-0.14, -0.28), (0.00, -0.28), width=0.026, color=rgba((186, 200, 214)))
    vc.stroke_line((-0.16, 0.49), (0.02, 0.49), width=0.028, color=rgba((194, 208, 222)))

    # Three concentric wireless signal arcs WITH unified dark outline stroke (safely inside top-right!)
    ox, oy = 0.16, -0.14
    for rad in (0.19, 0.32, 0.45):
        pts = arc_pts(ox, oy, rad, rad, -82, 4, steps=16)
        vc.stroke_polyline(pts, width=0.084, color=ink)
        vc.stroke_polyline(pts, width=0.046, color=signal)
    vc.circle(ox, oy, 0.062, fill=signal, outline=ink, width=0.026)


def _icon_hardware(vc: VectorCanvas):
    """15. 五金/汽修/开锁/家电维修: 精密齿轮 + 锐利交叉钢制开口扳手."""
    ink = rgba(tone("#1E262E", 0.10))
    gear_c = rgba(tone("#3C627E", 0.14))
    steel = rgba(tone("#8C96A0", 0.14))
    steel_hi = rgba(tone("#CFD6DC", 0.14))
    amber = rgba(tone("#D29434", 0.14))

    gx, gy = -0.09, -0.07
    g_pts: list[Pt] = []
    n_teeth = 8
    r_in, r_out = 0.35, 0.50
    for i in range(n_teeth):
        a0 = (i / n_teeth) * 2 * math.pi
        da = (2 * math.pi) / n_teeth
        for ang, rr in (
            (a0, r_in), (a0 + da * 0.16, r_out),
            (a0 + da * 0.44, r_out), (a0 + da * 0.60, r_in),
        ):
            g_pts.append((gx + math.cos(ang) * rr, gy + math.sin(ang) * rr))
    vc.polygon(g_pts, fill=gear_c, outline=ink, width=0.034)
    vc.circle(gx, gy, 0.20, fill=rgba((246, 242, 232)), outline=ink, width=0.030)
    vc.circle(gx, gy, 0.095, fill=amber, outline=ink, width=0.022)

    shaft = rotate_pts([(-0.50, -0.08), (0.46, -0.08), (0.46, 0.08), (-0.50, 0.08)], 0.0, 0.0, 42)
    vc.polygon([(x + 0.07, y + 0.07) for x, y in shaft], fill=steel_hi, outline=ink, width=0.032)
    groove = rotate_pts([(-0.30, 0.0), (0.26, 0.0)], 0.0, 0.0, 42)
    vc.stroke_line((groove[0][0] + 0.07, groove[0][1] + 0.07), (groove[1][0] + 0.07, groove[1][1] + 0.07), width=0.032, color=steel)

    # Sharp open-end wrench jaw
    jaw = rotate_pts([
        (-0.42, -0.17), (-0.64, -0.20), (-0.70, -0.07), (-0.53, -0.05),
        (-0.53, 0.05), (-0.70, 0.07), (-0.64, 0.20), (-0.42, 0.17),
    ], 0.0, 0.0, 42)
    vc.polygon([(x + 0.07, y + 0.07) for x, y in jaw], fill=steel_hi, outline=ink, width=0.032)
    rx, ry = rotate_pts([(0.49, 0.0)], 0.0, 0.0, 42)[0]
    vc.circle(rx + 0.07, ry + 0.07, 0.16, fill=steel_hi, outline=ink, width=0.032)
    vc.circle(rx + 0.07, ry + 0.07, 0.075, fill=rgba((246, 242, 232)), outline=ink, width=0.024)


def _icon_laundry(vc: VectorCanvas):
    """16. 洗衣护鞋/家政: 滚筒洗衣机玻璃视窗 + 洁净蓝白水波 + 泡泡与星芒(零歧义重做!)."""
    ink = rgba(tone("#1A3046", 0.10))
    body_c = rgba((246, 249, 252))
    panel_top = rgba(tone("#3B6E9A", 0.14))
    drum_ring = rgba(tone("#8EA2B4", 0.14))
    water_deep = rgba(tone("#327AB0", 0.14))
    water_light = rgba(tone("#6CB4DE", 0.14))
    spark = rgba(tone("#E4AE38", 0.12))

    # Compact sleek washing machine cabinet neatly centered inside safe zone
    vc.rounded_rect(-0.46, -0.52, 0.46, 0.56, 0.09, fill=body_c, outline=ink, width=0.038)
    # Top control header strip with detergent drawer + dial dots
    vc.rounded_rect(-0.44, -0.50, 0.44, -0.28, 0.06, fill=panel_top, outline=ink, width=0.024)
    vc.rounded_rect(-0.34, -0.44, -0.06, -0.34, 0.02, fill=body_c)
    vc.circle(0.14, -0.39, 0.052, fill=body_c, outline=ink, width=0.020)
    vc.circle(0.30, -0.39, 0.036, fill=spark)

    # Prominent circular drum porthole ring
    dcx, dcy = 0.0, 0.12
    vc.circle(dcx, dcy, 0.34, fill=drum_ring, outline=ink, width=0.034)
    vc.circle(dcx, dcy, 0.26, fill=rgba((236, 246, 254)), outline=ink, width=0.026)

    # Swirling clean blue water wave filling lower half of drum window
    wave = [(-0.24, dcy + 0.02)]
    wave += cubic_bezier((-0.24, dcy + 0.02), (-0.08, dcy - 0.10), (0.08, dcy + 0.12), (0.24, dcy - 0.02), steps=18)[1:]
    wave += arc_pts(dcx, dcy, 0.24, 0.24, 0, 180, steps=18)[1:]
    vc.polygon(wave, fill=water_deep)
    # Bright foam crest wave line
    vc.stroke_cubic((-0.22, dcy + 0.02), (-0.08, dcy - 0.08), (0.08, dcy + 0.10), (0.22, dcy - 0.01), width=0.040, color=water_light)
    # Crisp soap bubbles inside porthole
    vc.circle(-0.09, dcy - 0.10, 0.048, fill=(255, 255, 255, 235), outline=water_deep, width=0.018)
    vc.circle(0.08, dcy - 0.07, 0.036, fill=(255, 255, 255, 235), outline=water_deep, width=0.016)
    # Door latch handle on right side of drum ring
    vc.rounded_rect(0.24, dcy - 0.07, 0.34, dcy + 0.07, 0.03, fill=ink)

    # Fresh sparkle outside upper-right
    vc.sparkle(0.52, -0.44, 0.11, spark)


def _icon_specialty(vc: VectorCanvas):
    """17. 桂林特产/烟酒副食: 手提伴手礼袋 + 袋身中央精印桂林喀斯特峻峰漓江山水徽章(推倒重做!)."""
    ink = rgba(tone("#281D1A", 0.10))
    bag_red = rgba(tone("#AE322C", 0.14))
    bag_side = rgba(tone("#84221E", 0.14))
    gold = rgba(tone("#E2B042", 0.14))
    medallion = rgba((248, 243, 230))
    peak_far = rgba(tone("#5C887A", 0.14))
    peak_near = rgba(tone("#2C5E50", 0.14))
    river = rgba(tone("#448090", 0.14))

    # Braided golden carry handles arching cleanly above gift bag
    h_back = arc_pts(0.0, -0.26, 0.22, 0.24, 180, 360, steps=18)
    vc.stroke_polyline(h_back, width=0.072, color=ink)
    vc.stroke_polyline(h_back, width=0.038, color=gold)

    # Structured festive Guilin souvenir carry-bag silhouette
    bag = [(-0.46, -0.26), (0.46, -0.26), (0.54, 0.56), (-0.54, 0.56)]
    vc.polygon(bag, fill=bag_red, outline=ink, width=0.038)
    # Subtle side gusset depth + top fold cuff
    vc.polygon([(0.40, -0.26), (0.46, -0.26), (0.54, 0.56), (0.44, 0.56)], fill=bag_side)
    vc.rounded_rect(-0.48, -0.28, 0.48, -0.14, 0.03, fill=rgba(tone("#C44038", 0.14)), outline=ink, width=0.030)
    # Handle eyelets
    vc.circle(-0.22, -0.21, 0.034, fill=gold, outline=ink, width=0.018)
    vc.circle(0.22, -0.21, 0.034, fill=gold, outline=ink, width=0.018)

    # Framed circular Guilin Karst-Peak & Lijiang scenic emblem printed on bag center
    mcx, mcy = 0.0, 0.20
    vc.circle(mcx, mcy, 0.28, fill=medallion, outline=gold, width=0.038)
    # Steep jagged Guilin karst peaks inside scenic crest
    vc.polygon([(mcx - 0.21, mcy + 0.09), (mcx - 0.10, mcy - 0.15), (mcx + 0.02, mcy + 0.09)], fill=peak_near, outline=ink, width=0.018)
    vc.polygon([(mcx - 0.04, mcy + 0.09), (mcx + 0.09, mcy - 0.19), (mcx + 0.22, mcy + 0.09)], fill=peak_far, outline=ink, width=0.018)
    # Lijiang river wave strokes underneath peaks
    vc.stroke_quad((mcx - 0.18, mcy + 0.13), (mcx, mcy + 0.09), (mcx + 0.18, mcy + 0.14), width=0.026, color=river)
    vc.stroke_quad((mcx - 0.12, mcy + 0.19), (mcx + 0.02, mcy + 0.16), (mcx + 0.14, mcy + 0.19), width=0.022, color=river)
    # Gold sun dot above karst peak
    vc.circle(mcx - 0.12, mcy - 0.16, 0.036, fill=gold)


def _icon_hotel_home(vc: VectorCanvas):
    """18. 酒店民宿/房产: 桂北飞檐青瓦客栈 + 暖灯花窗 + 倒影石阶 + 星月(弃盾牌、改圆角方、零撞框!)."""
    ink = rgba(tone("#22262E", 0.10))
    roof = rgba(tone("#324454", 0.14))
    wall = rgba((246, 240, 228))
    wood = rgba(tone("#7E4C2C", 0.14))
    window_glow = rgba(tone("#F2BE48", 0.10))
    moon = rgba(tone("#E4AE3C", 0.12))
    river = rgba(tone("#508492", 0.14))

    # Crescent moon & stars cleanly placed with generous top-right & top-left margin
    vc.circle(0.36, -0.44, 0.11, fill=moon, outline=ink, width=0.020)
    vc.circle(0.41, -0.47, 0.088, fill=rgba((246, 242, 234)))
    vc.sparkle(-0.40, -0.44, 0.080, moon)
    vc.sparkle(0.10, -0.54, 0.062, moon)

    # Compact Guilin-north white-wall inn body (plenty of horizontal breathing room!)
    vc.rounded_rect(-0.38, 0.00, 0.38, 0.46, 0.03, fill=wall, outline=ink, width=0.034)
    # Stone terrace plinth & subtle Lijiang water reflection lines at bottom (eliminates void!)
    vc.rounded_rect(-0.48, 0.42, 0.48, 0.50, 0.03, fill=roof, outline=ink, width=0.026)
    vc.stroke_line((-0.34, 0.57), (0.34, 0.57), width=0.028, color=river)
    vc.stroke_line((-0.20, 0.63), (0.20, 0.63), width=0.022, color=river)

    # Warm glowing traditional arched doorway & mullioned lantern windows
    vc.rounded_rect(-0.11, 0.14, 0.11, 0.43, 0.10, fill=window_glow, outline=wood, width=0.028)
    vc.stroke_line((0.0, 0.14), (0.0, 0.43), width=0.020, color=wood)
    vc.rounded_rect(-0.30, 0.15, -0.18, 0.30, 0.02, fill=window_glow, outline=wood, width=0.022)
    vc.rounded_rect(0.18, 0.15, 0.30, 0.30, 0.02, fill=window_glow, outline=wood, width=0.022)

    # Sweeping upturned flying-eaves pitched roof strictly inside [-0.58, +0.58] (ZERO clipping!)
    roof_pts = [(-0.58, -0.02)]
    roof_pts += quad_bezier((-0.58, -0.02), (-0.28, -0.06), (0.0, -0.38), steps=14)[1:]
    roof_pts += quad_bezier((0.0, -0.38), (0.28, -0.06), (0.58, -0.02), steps=14)[1:]
    roof_pts += [(0.48, 0.08), (-0.48, 0.08)]
    vc.polygon(roof_pts, fill=roof, outline=ink, width=0.034)
    vc.stroke_line((-0.14, -0.38), (0.14, -0.38), width=0.040, color=wood)


def _icon_jewelry_opt(vc: VectorCanvas):
    """19. 珠宝玉石: 多面切工璀璨翡翠钻石 + 内收星芒."""
    ink = rgba(tone("#1A2A2A", 0.10))
    gem_top = rgba(tone("#4AA88C", 0.14))
    gem_mid = rgba(tone("#2A7E68", 0.14))
    gem_dark = rgba(tone("#1C584A", 0.14))
    gem_hi = rgba(tone("#96DFC8", 0.14))
    gold = rgba(tone("#DFA83A", 0.14))

    outer = [(-0.35, -0.36), (0.35, -0.36), (0.60, -0.05), (0.0, 0.56), (-0.60, -0.05)]
    vc.polygon(outer, fill=gem_mid, outline=ink, width=0.038)

    vc.polygon([(-0.35, -0.36), (0.35, -0.36), (0.22, -0.05), (-0.22, -0.05)], fill=gem_hi, outline=ink, width=0.022)
    vc.polygon([(-0.60, -0.05), (-0.35, -0.36), (-0.22, -0.05)], fill=gem_top, outline=ink, width=0.022)
    vc.polygon([(0.60, -0.05), (0.35, -0.36), (0.22, -0.05)], fill=gem_dark, outline=ink, width=0.022)
    vc.polygon([(-0.22, -0.05), (0.22, -0.05), (0.0, 0.56)], fill=gem_top, outline=ink, width=0.024)
    vc.polygon([(0.22, -0.05), (0.60, -0.05), (0.0, 0.56)], fill=gem_dark, outline=ink, width=0.022)
    vc.polygon([(-0.60, -0.05), (-0.22, -0.05), (0.0, 0.56)], fill=gem_mid, outline=ink, width=0.022)

    vc.sparkle(-0.42, -0.45, 0.12, gold)
    vc.sparkle(0.44, -0.42, 0.10, gold)
    vc.sparkle(0.42, 0.34, 0.08, gold)


def _icon_glasses(vc: VectorCanvas):
    """20. 眼镜验光: 正视光学双圆镜框 + 金属桩头 + 清透天蓝镜片与45°反光(去蟹钳镜腿!)."""
    ink = rgba(tone("#1C2430", 0.10))
    frame = rgba(tone("#2A4260", 0.14))
    lens = rgba((216, 238, 250), 230)
    gold = rgba(tone("#D4A43C", 0.14))

    # Crisp horizontal metallic end-piece hinges (clean front-facing optical silhouette — zero crab claws!)
    vc.rounded_rect(-0.64, -0.05, -0.52, 0.05, 0.02, fill=gold, outline=ink, width=0.022)
    vc.rounded_rect(0.52, -0.05, 0.64, 0.05, 0.02, fill=gold, outline=ink, width=0.022)

    # Centered twin round optical lenses & frames with generous horizontal margin
    vc.circle(-0.31, 0.02, 0.25, fill=lens, outline=frame, width=0.068)
    vc.circle(0.31, 0.02, 0.25, fill=lens, outline=frame, width=0.068)
    vc.circle(-0.31, 0.02, 0.28, outline=ink, width=0.020)
    vc.circle(0.31, 0.02, 0.28, outline=ink, width=0.020)

    # Golden arched nose bridge + subtle lower nose pads
    vc.stroke_quad((-0.07, 0.00), (0.0, -0.10), (0.07, 0.00), width=0.052, color=gold)

    # Crisp 45° twin white specular reflection slashes on airy crystal lenses
    for lx in (-0.31, 0.31):
        vc.stroke_line((lx - 0.12, -0.03), (lx + 0.03, -0.15), width=0.044, color=(255, 255, 255, 240))
        vc.stroke_line((lx - 0.12, 0.10), (lx + 0.08, -0.06), width=0.026, color=(255, 255, 255, 210))

    vc.sparkle(0.0, -0.40, 0.095, gold)


ICON_REGISTRY: dict[str, Callable[[VectorCanvas], None]] = {
    "noodle": _icon_noodle,
    "pharmacy": _icon_pharmacy,
    "tcm": _icon_tcm,
    "flower": _icon_flower,
    "tea": _icon_tea,
    "coffee": _icon_coffee,
    "bakery": _icon_bakery,
    "dessert": _icon_dessert,
    "fruit": _icon_fruit,
    "food": _icon_food,
    "fashion": _icon_fashion,
    "salon": _icon_salon,
    "books": _icon_books,
    "digital": _icon_digital,
    "hardware": _icon_hardware,
    "laundry": _icon_laundry,
    "specialty": _icon_specialty,
    "hotel_home": _icon_hotel_home,
    "jewelry_opt": _icon_jewelry_opt,
    "glasses": _icon_glasses,
}

# Preferred medallion geometry per industry (shield strictly reserved for pharmacy!)
DEFAULT_BADGE_SHAPE: dict[str, str] = {
    "noodle": "circle",
    "pharmacy": "shield",
    "tcm": "octagon",
    "flower": "circle",
    "tea": "octagon",
    "coffee": "circle",
    "bakery": "circle",
    "dessert": "squircle",
    "fruit": "squircle",
    "food": "octagon",
    "fashion": "squircle",
    "salon": "circle",
    "books": "squircle",
    "digital": "squircle",
    "hardware": "octagon",
    "laundry": "squircle",
    "specialty": "octagon",
    "hotel_home": "squircle",
    "jewelry_opt": "octagon",
    "glasses": "squircle",
}

ICON_NAMES: tuple[str, ...] = tuple(ICON_REGISTRY.keys())


def render_industry_icon(
    icon_type: str,
    size: int,
    bg_rgb: RGB,
    accent_rgb: RGB,
    fg_rgb: RGB,
    badge_shape: str | None = None,
    supersample: int = 2,
) -> tuple[Image.Image, int]:
    """
    Render an anti-aliased RGBA industry vector emblem of exact (size, size) pixels.
    Returns (rgba_image, primitive_count).
    """
    if icon_type not in ICON_REGISTRY:
        raise ValueError(f"Unknown industry icon_type='{icon_type}'. Valid: {ICON_NAMES}")

    shape = badge_shape or DEFAULT_BADGE_SHAPE.get(icon_type, "circle")
    hi_size = max(size * supersample, 320)
    vc = VectorCanvas(hi_size)
    _render_badge_base(vc, shape, bg_rgb, accent_rgb, fg_rgb)
    ICON_REGISTRY[icon_type](vc)

    if hi_size != size:
        out = vc.img.resize((size, size), Image.Resampling.LANCZOS)
    else:
        out = vc.img
    return out, vc.primitives


def measure_icon_primitives() -> dict[str, int]:
    """Measure exact vector primitive count for every registered industry icon."""
    counts: dict[str, int] = {}
    for name in ICON_NAMES:
        _img, prims = render_industry_icon(
            name, 128, (36, 40, 44), (200, 160, 80), (242, 238, 228), supersample=2
        )
        counts[name] = prims
    return counts


if __name__ == "__main__":
    counts = measure_icon_primitives()
    print(f"Registered {len(counts)} industry vector icons:")
    for k, v in counts.items():
        print(f"  {k:14s}: {v:2d} primitives")
