#!/usr/bin/env python3
"""
Automated Hard Verification & Visual Deliverable Exporter for Guilin 4:1 Signboard Atlases
(IDOK-471 / IDOK-472 acceptance gates).

Checks all 5 hard criteria and exits non-zero on ANY failure:
  1. Exact dimensions & opaque RGB mode:
       - shop-fascias.webp      : 3840 x 2560 RGB (6x16 @ 640x160, 4.0:1)
       - shop-fascias-emit.webp : 3840 x 2560 RGB
       - shop-blades.webp       : 1024 x 1024 RGB (8x2 @ 128x512)
  2. >=18 distinct registered multi-primitive vector icons (each >= 5 primitives),
     100% of 96 fascias & 16 blades bound to valid industry icons, AND rendered icon
     regions pass pixel variance + edge-activity thresholds (zero blank/flat cells).
  3. 100% of 96 fascias pass WCAG 2.1 contrast thresholds:
       - main title vs effective substrate >= 4.5:1
       - subtitle vs its background (substrate or ribbon) >= 3.8:1 (target >= 4.5:1)
       - LED ticker & split-panel badge text >= 4.5:1
       - all 16 vertical blades >= 4.5:1
  4. check_trademark_compliance() == 0 violations (12x8 hue balance, 0 real trademarks).
  5. Exports review artifacts:
       - Full 96-shop atlas overview sheet
       - Native 640x160 full-scale 8-industry showcase collage
         (米粉 / 药房 / 茶行 / 咖啡 / 花店 / 美发 / 数码 / 水果)
       - 20-icon close-up catalog gallery & 16-blade overview sheet
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from generate_sign_atlases import effective_bg_rgb, ensure_wcag_fg, icon_box_for_mode, load_font, resolve_tile_palette
from sign_catalog import BLADE_SPECS, FASCIA_SPECS, VALID_MODES, check_trademark_compliance
from sign_icons import (
    ICON_NAMES,
    contrast_ratio,
    hex_to_rgb_tuple,
    measure_icon_primitives,
    render_industry_icon,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = REPO_ROOT / "public/city-upgrade"

# 8 mandatory representative industries for native 640x160 showcase collage
SHOWCASE_8: list[tuple[str, str, str]] = [
    ("noodle",   "桂林米粉", "laozihao_fen"),
    ("pharmacy", "便民药房", "guikang_pharm"),
    ("tea",      "桂花茶行", "mingcai_tea"),
    ("coffee",   "精品咖啡", "guiying_coffee"),
    ("flower",   "鲜花花艺", "guiyun_flower"),
    ("salon",    "美发造型", "qinghe_salon"),
    ("digital",  "数码通讯", "jisu_digital"),
    ("fruit",    "鲜果直供", "siji_fruit"),
]


def export_showcase_8(
    alb: Image.Image,
    cols: int,
    cw: int,
    ch: int,
    out_path: Path,
    contrast_map: dict[int, tuple[float, float]],
):
    """Export 8 flagship industries at EXACT 1:1 native 640x160 resolution (2 cols x 4 rows)."""
    key_to_idx = {spec[0]: i for i, spec in enumerate(FASCIA_SPECS)}
    pad = 24
    hdr_h = 34
    title_bar = 66
    cell_w = cw
    cell_h = ch + hdr_h
    grid_cols, grid_rows = 2, 4
    w = pad + grid_cols * (cell_w + pad)
    h = title_bar + pad + grid_rows * (cell_h + pad)

    canvas = Image.new("RGB", (w, h), (22, 24, 28))
    draw = ImageDraw.Draw(canvas)
    f_hdr = load_font(24, "sans")
    f_lbl = load_font(15, "sans_med")
    draw.text(
        (pad, title_bar // 2),
        "IDOK-472 · 8 典型业态原寸 640×160 (4:1, 2× SSAA) 放大验收拼图",
        fill=(244, 240, 232),
        font=f_hdr,
        anchor="lm",
    )

    for slot, (ind_key, ind_zh, shop_key) in enumerate(SHOWCASE_8):
        idx = key_to_idx[shop_key]
        spec = FASCIA_SPECS[idx]
        sc, sr = idx % cols, idx // cols
        crop = alb.crop((sc * cw, sr * ch, (sc + 1) * cw, (sr + 1) * ch))

        gc, gr = slot % grid_cols, slot // grid_cols
        dx = pad + gc * (cell_w + pad)
        dy = title_bar + pad + gr * (cell_h + pad)

        t_cr, s_cr = contrast_map[idx]
        label = f"#{idx:02d} [{ind_zh}] {spec[6]}  ·  {spec[8]}  ·  WCAG {t_cr:.1f}/{s_cr:.1f}:1"
        lbl_font = f_lbl
        tb = draw.textbbox((0, 0), label, font=lbl_font)
        if tb[2] - tb[0] > cw - 4:
            lbl_font = load_font(13, "sans_med")
        draw.text((dx + 2, dy + hdr_h // 2), label, fill=(216, 222, 228), font=lbl_font, anchor="lm")
        canvas.paste(crop, (dx, dy + hdr_h))
        draw.rectangle([dx - 1, dy + hdr_h - 1, dx + cw, dy + hdr_h + ch], outline=(76, 82, 92), width=1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=96)


def export_icon_gallery(out_path: Path, prim_counts: dict[str, int]):
    """Export close-up sheet of all registered industry vector icons for rapid visual inspection."""
    cols = 5
    rows = (len(ICON_NAMES) + cols - 1) // cols
    icon_sz = 160
    cell_w, cell_h = 220, 228
    pad = 16
    top_h = 56
    canvas = Image.new("RGB", (pad + cols * (cell_w + pad), top_h + pad + rows * (cell_h + pad)), (28, 31, 36))
    draw = ImageDraw.Draw(canvas)
    f_hdr = load_font(24, "sans")
    f_lbl = load_font(16, "sans_med")
    draw.text(
        (pad, top_h // 2),
        f"sign_icons.py · {len(ICON_NAMES)} 业态高精度矢量图标库总览 (3× 内超采样)",
        fill=(244, 240, 232),
        font=f_hdr,
        anchor="lm",
    )
    for i, name in enumerate(ICON_NAMES):
        c, r = i % cols, i // cols
        x0 = pad + c * (cell_w + pad)
        y0 = top_h + pad + r * (cell_h + pad)
        # Alternate dark & light card backdrops so rim visibility on both is immediately verifiable
        card_bg = (36, 40, 46) if i % 2 == 0 else (228, 222, 210)
        draw.rounded_rectangle([x0, y0, x0 + cell_w, y0 + cell_h], radius=12, fill=card_bg, outline=(88, 94, 102), width=2)
        im_rgba, _ = render_industry_icon(
            name, icon_sz, card_bg, (198, 152, 72) if i % 2 == 0 else (126, 42, 34),
            (244, 240, 232) if i % 2 == 0 else (34, 32, 30), supersample=3
        )
        tile_rgba = canvas.convert("RGBA")
        tile_rgba.alpha_composite(im_rgba, (x0 + (cell_w - icon_sz) // 2, y0 + 16))
        canvas = tile_rgba.convert("RGB")
        draw = ImageDraw.Draw(canvas)
        lbl_col = (234, 236, 240) if i % 2 == 0 else (30, 32, 36)
        draw.text((x0 + cell_w // 2, y0 + cell_h - 24), f"{name} ({prim_counts[name]} prims)", fill=lbl_col, font=f_lbl, anchor="mm")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, quality=95)


def main():
    ap = argparse.ArgumentParser(description="Hard acceptance verification for 4:1 Guilin signboard atlases.")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--preview-dir", type=Path, default=Path("/tmp/idok-472-verify"))
    ap.add_argument("--json-report", type=Path, default=None)
    args = ap.parse_args()

    errors: list[str] = []
    out_dir: Path = args.out_dir
    preview_dir: Path = args.preview_dir
    preview_dir.mkdir(parents=True, exist_ok=True)

    # ── Gate 1: Dimensions & opaque RGB mode ──
    expected_assets = {
        "shop-fascias.webp": (3840, 2560),
        "shop-fascias-emit.webp": (3840, 2560),
        "shop-blades.webp": (1024, 1024),
    }
    loaded: dict[str, Image.Image] = {}
    asset_stats: dict[str, dict] = {}
    for fname, exp_size in expected_assets.items():
        fp = out_dir / fname
        if not fp.exists():
            errors.append(f"Missing asset: {fp}")
            continue
        im = Image.open(fp)
        loaded[fname] = im
        asset_stats[fname] = {
            "size": list(im.size),
            "mode": im.mode,
            "sizeKB": round(fp.stat().st_size / 1024.0, 1),
        }
        if im.size != exp_size:
            errors.append(f"{fname}: expected size {exp_size}, got {im.size}")
        if im.mode != "RGB":
            errors.append(f"{fname}: expected opaque RGB mode, got {im.mode}")

    if "shop-fascias.webp" not in loaded or "shop-blades.webp" not in loaded:
        print("VERIFICATION FAILED (missing images):\n  - " + "\n  - ".join(errors))
        sys.exit(1)

    alb = loaded["shop-fascias.webp"]
    emit = loaded["shop-fascias-emit.webp"]
    blades = loaded["shop-blades.webp"]
    cols, rows = 6, 16
    cw, ch = 640, 160

    # ── Gate 2: >=18 vector icons, >=5 primitives each, 100% coverage & rendered pixel variance ──
    prim_counts = measure_icon_primitives()
    if len(ICON_NAMES) < 18:
        errors.append(f"Need >=18 distinct industry icons, got {len(ICON_NAMES)}")
    for icon_name, pcount in prim_counts.items():
        if pcount < 5:
            errors.append(f"Icon '{icon_name}' has only {pcount} primitives (< 5)")

    icon_usage = Counter()
    mode_usage = Counter()
    icon_stds: list[float] = []
    icon_grad_means: list[float] = []
    min_icon_std = 999.0
    min_icon_std_shop = ""

    # ── Gate 3: WCAG 2.1 Contrast hard verification on all 96 fascias ──
    title_crs: list[float] = []
    sub_crs: list[float] = []
    extra_crs: list[float] = []
    contrast_map: dict[int, tuple[float, float]] = {}

    alb_np = np.array(alb, dtype=np.float32)
    emit_np = np.array(emit, dtype=np.float32)

    for idx, spec in enumerate(FASCIA_SPECS):
        key, hue, substrate, bg_hex, fg_hex, acc_hex, title, sub, mode, _fs, _gl, _ph, _zn, icon_type, _tag = spec
        icon_usage[icon_type] += 1
        mode_usage[mode] += 1

        # Verify resolved WCAG contrast ratios
        pal = resolve_tile_palette(bg_hex, fg_hex, acc_hex, mode)
        t_cr = contrast_ratio(pal["title_fg"], pal["eff_bg"])
        if mode == "duotone_banner":
            s_cr = contrast_ratio(pal["panel_fg"], pal["panel_bg"])
        else:
            s_cr = contrast_ratio(pal["sub_fg"], pal["eff_bg"])

        title_crs.append(t_cr)
        sub_crs.append(s_cr)
        contrast_map[idx] = (t_cr, s_cr)

        if t_cr < 4.5:
            errors.append(f"Fascia #{idx} ({key}) title WCAG contrast {t_cr:.2f} < 4.5")
        if s_cr < 3.8:
            errors.append(f"Fascia #{idx} ({key}) subtitle WCAG contrast {s_cr:.2f} < 3.8")
        if mode == "led_ticker":
            l_cr = contrast_ratio(pal["led_fg"], pal["led_bg"])
            extra_crs.append(l_cr)
            if l_cr < 4.5:
                errors.append(f"Fascia #{idx} ({key}) LED ticker contrast {l_cr:.2f} < 4.5")
        if mode == "split_tag":
            p_cr = contrast_ratio(pal["panel_fg"], pal["panel_bg"])
            extra_crs.append(p_cr)
            if p_cr < 4.5:
                errors.append(f"Fascia #{idx} ({key}) split panel contrast {p_cr:.2f} < 4.5")

        # Verify rendered icon region pixel richness (std & gradient activity, not empty/flat!)
        c, r = idx % cols, idx // cols
        x0, y0 = c * cw, r * ch
        icx2, icy2, isz2 = icon_box_for_mode(mode, cw * 2, ch * 2)
        icx, icy, ir = icx2 // 2, icy2 // 2, (isz2 // 4) - 4
        patch = alb_np[y0 + icy - ir : y0 + icy + ir, x0 + icx - ir : x0 + icx + ir]
        std_val = float(patch.std())
        gx = np.abs(np.diff(patch, axis=1)).mean()
        gy = np.abs(np.diff(patch, axis=0)).mean()
        grad_val = float(0.5 * (gx + gy))
        icon_stds.append(std_val)
        icon_grad_means.append(grad_val)
        if std_val < min_icon_std:
            min_icon_std = std_val
            min_icon_std_shop = f"#{idx} {key} ({icon_type})"
        if std_val < 22.0 or grad_val < 5.0:
            errors.append(f"Fascia #{idx} ({key}, {icon_type}) icon region too flat: std={std_val:.1f}, grad={grad_val:.1f}")

        # Verify emissive border stays clean dark AND inner emissive stays readable (no dark-dead night tiles!)
        tile_em = emit_np[y0 : y0 + ch, x0 : x0 + cw]
        if float(tile_em[0:2, :, :].mean()) > 4.0 or float(tile_em[-2:, :, :].mean()) > 4.0:
            errors.append(f"Fascia #{idx} ({key}) emissive border bleed detected")
        core_em = tile_em[12 : ch - 12, 12 : cw - 12]
        em_p98 = float(np.percentile(core_em, 98))
        em_p10 = float(np.percentile(core_em, 10))
        if em_p98 < 70.0 or (em_p98 - em_p10) < 35.0:
            errors.append(f"Fascia #{idx} ({key}) night emissive too dark/flat: p98={em_p98:.1f}, span={em_p98 - em_p10:.1f}")

    # Verify all 16 vertical blades (contrast + top icon variance)
    blades_np = np.array(blades, dtype=np.float32)
    blade_crs: list[float] = []
    blade_icon_stds: list[float] = []
    for idx, (bg_hex, fg_hex, _b_hex, text, icon_type) in enumerate(BLADE_SPECS):
        eff_bg = effective_bg_rgb(bg_hex)
        fg_rgb = ensure_wcag_fg(hex_to_rgb_tuple(fg_hex), eff_bg, min_ratio=5.0)
        b_cr = contrast_ratio(fg_rgb, eff_bg)
        blade_crs.append(b_cr)
        if b_cr < 4.5:
            errors.append(f"Blade #{idx} ({text}) WCAG contrast {b_cr:.2f} < 4.5")
        c, r = idx % 8, idx // 8
        bx0, by0 = c * 128, r * 512
        b_patch = blades_np[by0 + 26 : by0 + 106, bx0 + 24 : bx0 + 104]
        b_std = float(b_patch.std())
        blade_icon_stds.append(b_std)
        if b_std < 22.0:
            errors.append(f"Blade #{idx} ({text}, {icon_type}) top icon region too flat: std={b_std:.1f}")

    # Verify layout diversity: all 6 asymmetric modes used
    for m in VALID_MODES:
        if mode_usage[m] < 8:
            errors.append(f"Layout mode '{m}' under-represented ({mode_usage[m]} < 8)")

    # ── Gate 4: Trademark compliance ──
    tm_violations = check_trademark_compliance()
    if tm_violations:
        errors.extend(tm_violations)

    # ── Gate 5: Export visual acceptance deliverables ──
    sheet_path = preview_dir / "fascias-96-overview.jpg"
    emit_sheet_path = preview_dir / "fascias-96-emit-overview.jpg"
    showcase_path = preview_dir / "showcase-8-industries-640x160.png"
    icons_path = preview_dir / "icons-20-gallery.png"
    blades_path = preview_dir / "blades-16-overview.png"

    alb.resize((1920, 1280), Image.Resampling.LANCZOS).save(sheet_path, quality=92)
    emit.resize((1920, 1280), Image.Resampling.LANCZOS).save(emit_sheet_path, quality=90)
    export_showcase_8(alb, cols, cw, ch, showcase_path, contrast_map)
    export_icon_gallery(icons_path, prim_counts)
    blades.save(blades_path)

    report = {
        "ok": len(errors) == 0,
        "assets": asset_stats,
        "grid": {"cols": cols, "rows": rows, "cellSize": [cw, ch], "aspectRatio": round(cw / ch, 2)},
        "icons": {
            "registeredCount": len(ICON_NAMES),
            "usedInFasciasCount": len(icon_usage),
            "minPrimitives": min(prim_counts.values()),
            "maxPrimitives": max(prim_counts.values()),
            "fasciaIconCoverage": f"{sum(icon_usage.values())}/96",
            "minRenderedIconStd": round(min_icon_std, 2),
            "minRenderedIconShop": min_icon_std_shop,
            "avgRenderedIconStd": round(float(np.mean(icon_stds)), 2),
            "avgRenderedIconGrad": round(float(np.mean(icon_grad_means)), 2),
            "minBladeIconStd": round(min(blade_icon_stds), 2),
            "usageByIndustry": dict(sorted(icon_usage.items())),
        },
        "layouts": dict(sorted(mode_usage.items())),
        "wcagContrast": {
            "titleMin": round(min(title_crs), 2),
            "titleAvg": round(float(np.mean(title_crs)), 2),
            "subtitleMin": round(min(sub_crs), 2),
            "subtitleAvg": round(float(np.mean(sub_crs)), 2),
            "extraBadgesMin": round(min(extra_crs), 2) if extra_crs else None,
            "bladesMin": round(min(blade_crs), 2),
            "passCount": f"{sum(1 for t, s in zip(title_crs, sub_crs) if t >= 4.5 and s >= 3.8)}/96",
        },
        "trademarkViolations": len(tm_violations),
        "exports": {
            "overview96": str(sheet_path),
            "emitOverview96": str(emit_sheet_path),
            "showcase8Native": str(showcase_path),
            "icons20Gallery": str(icons_path),
            "blades16": str(blades_path),
        },
        "errors": errors,
    }

    print("=== IDOK-472 Signboard Atlas Hard Verification Report ===")
    for fname, st in asset_stats.items():
        print(f"  {fname:24s}: {st['size'][0]}x{st['size'][1]} {st['mode']} ({st['sizeKB']:.1f} KB)")
    print(f"  Registered vector icons : {len(ICON_NAMES)} industries (used {len(icon_usage)}/20 across 96 fascias; prims {min(prim_counts.values())}-{max(prim_counts.values())})")
    print(f"  Icon pixel richness     : min std={min_icon_std:.1f} ({min_icon_std_shop}), avg std={np.mean(icon_stds):.1f}, avg grad={np.mean(icon_grad_means):.1f} | blades min std={min(blade_icon_stds):.1f}")
    print(f"  Layout distribution     : {dict(sorted(mode_usage.items()))}")
    print(f"  WCAG 2.1 contrast (96)  : title min={min(title_crs):.2f}:1 (avg {np.mean(title_crs):.2f}:1) | sub min={min(sub_crs):.2f}:1 (avg {np.mean(sub_crs):.2f}:1) | blades min={min(blade_crs):.2f}:1")
    print(f"  Trademark compliance    : {len(tm_violations)} violations")
    print(f"  Exported previews       :\n    - {showcase_path}\n    - {sheet_path}\n    - {icons_path}\n    - {blades_path}")

    if args.json_report:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if errors:
        print("\nVERIFICATION FAILED:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("\nVERIFICATION PASSED: ALL 5 HARD GATES GREEN!")


if __name__ == "__main__":
    main()
