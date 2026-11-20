"""Authoritative procedural low-poly generator for Guilin street & waterfront trees (M2.6-26 / IDOK-71).

Generates `pipeline/tree-specs.json` consumed by `web/src/look/trees.ts` and provides
`emit_landmark_tree()` so street landmarks (`yiwu_street`, `xinyi_arcade`, `ronghu`) share
the exact same botanical crowns, trunks, roots, and seasonal palettes.

Slot order (preserving 0..5 compatibility with `.trees` 12-byte records and `physics.ts` kind!==5):
  0: camphor      — 香樟 (Cinnamomum camphora)
  1: banyan       — 小叶榕/高山榕 (Ficus microcarpa)
  2: osmanthus    — 桂花 (Osmanthus fragrans, 市树)
  3: palm         — 蒲葵/大王椰 (Livistona chinensis / Roystonea regia)
  4: conifer      — 水杉 (Metasequoia glyptostroboides)
  5: shrub        — 山石灌丛 (Karst scrub, trunkless collider-exempt slot 5)
  6: virens       — 黄葛榕/大叶榕 (Ficus virens)
  7: bischofia    — 秋枫/复羽叶栾树 (Bischofia javanica / Koelreuteria bipinnata)
  8: elaeocarpus  — 杜英 (Elaeocarpus decipiens)
  9: ginkgo       — 银杏 (Ginkgo biloba)
 10: willow       — 垂柳 (Salix babylonica)
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import numpy as np

OUT_JSON = Path(__file__).with_name('tree-specs.json')

# Palette anchored to docs/reference.md deep lush subtropical greens + species botanical accents
PALETTE = {
    'camphor':          {'c': 0x35642F, 'lit': 0x729B42, 'dark': 0x19331D},
    'camphorTrunk':     0x4A3F34,
    'banyan':           {'c': 0x2C582A, 'lit': 0x527F3B, 'dark': 0x152D1A},
    'banyanTrunk':      0x473C31,
    'osmanthus':        {'c': 0x2A5428, 'lit': 0x4E7A39, 'dark': 0x162E1B},
    'osmanthusTrunk':   0x665F55,
    'palm':             {'c': 0x4E7B34, 'lit': 0x7BA04B, 'dark': 0x294823},
    'palmTrunk':        0x9E988C,
    'palmCrownshaft':   {'c': 0x4B8736, 'lit': 0x6CA848, 'dark': 0x2C5922},
    'conifer':          {'c': 0x2E5831, 'lit': 0x5F833E, 'dark': 0x18321F},
    'coniferTrunk':     0x5B3E30,
    'shrub':            {'c': 0x355E2E, 'lit': 0x5A843D, 'dark': 0x19321E},
    'virens':           {'c': 0x48803B, 'lit': 0x80B44B, 'dark': 0x234725},
    'virensTrunk':      0x685F54,
    'bischofia':        {'c': 0x37642F, 'lit': 0x689040, 'dark': 0x1B351F},
    'bischofiaPod':     {'c': 0xBE7D63, 'lit': 0xDC9E7E, 'dark': 0x7D4B3B},
    'bischofiaTrunk':   0x463C33,
    'elaeocarpus':      {'c': 0x2D5B2C, 'lit': 0x55803B, 'dark': 0x17311C},
    'elaeocarpusRed':   {'c': 0xAE3A2A, 'lit': 0xD4573B, 'dark': 0x6D2018},
    'elaeocarpusTrunk': 0x52483E,
    'ginkgo':           {'c': 0xA4AF38, 'lit': 0xDEC547, 'dark': 0x637226},
    'ginkgoTrunk':      0x665D52,
    'willow':           {'c': 0x638E3C, 'lit': 0x94BA54, 'dark': 0x355626},
    'willowTrunk':      0x4E4438,
}


def hex_rgb(h: int) -> tuple[float, float, float]:
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


def _scale_hex(h: int, f: float) -> int:
    r = min(255, max(0, round(((h >> 16) & 255) * f)))
    g = min(255, max(0, round(((h >> 8) & 255) * f)))
    b = min(255, max(0, round((h & 255) * f)))
    return (r << 16) | (g << 8) | b


def wood(key: str) -> dict:
    base = PALETTE[key]
    return {'c': base, 'lit': _scale_hex(base, 1.24), 'dark': _scale_hex(base, 0.66)}


def leaf(key: str) -> dict:
    return dict(PALETTE[key])


def build_species_specs() -> list[dict]:
    # -------------------------------------------------------------------------
    # 0. camphor — 香樟 (Cinnamomum camphora)
    # Wide rounded dome (W=11.6m >= crown H=9.6m), crown starts 2.6-3.0m;
    # trunk D=0.72m at base (>=0.05*12.2m), leans ~5.5 deg; 4 thick limbs at 38-48 deg
    # terminating strictly inside 8 overlapping irregular icosphere blobs.
    # -------------------------------------------------------------------------
    cam_leaf = leaf('camphor')
    cam_wood = wood('camphorTrunk')
    camphor = {
        'id': 0, 'name': 'camphor', 'zh': '香樟', 'latin': 'Cinnamomum camphora',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.05, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.08, 0.95, 1.06], 'lean': -0.06, 'tint': [0.96, 1.02, 0.95]},
            {'scale': [0.95, 1.06, 0.96], 'lean': 0.07, 'tint': [1.04, 1.02, 0.92]},
        ],
        'near': [
            # Flared base D=0.74m (r=0.37), strong taper, slight 5.5 deg curve (+0.28m at y=3.0m)
            {'op': 'tube', **cam_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.42], [0.0, 0.0, 0.0, 0.37], [0.08, 1.3, 0.02, 0.30],
                [0.20, 2.6, 0.05, 0.25], [0.34, 5.2, 0.08, 0.14],
            ]},
            # 4 stout primary limbs (38-48 deg from vertical), tips deep inside outer blobs
            {'op': 'tube', **cam_wood, 'sides': 5, 'pts': [[0.18, 2.5, 0.04, 0.20], [1.45, 4.0, 0.55, 0.14], [2.75, 5.4, 1.05, 0.09]]},
            {'op': 'tube', **cam_wood, 'sides': 5, 'pts': [[0.16, 2.4, 0.04, 0.19], [-1.35, 3.9, 0.70, 0.14], [-2.55, 5.3, 1.35, 0.09]]},
            {'op': 'tube', **cam_wood, 'sides': 5, 'pts': [[0.19, 2.6, 0.02, 0.18], [0.55, 4.2, -1.45, 0.13], [1.10, 5.6, -2.65, 0.08]]},
            {'op': 'tube', **cam_wood, 'sides': 5, 'pts': [[0.24, 3.1, 0.05, 0.16], [-1.05, 4.8, -1.15, 0.12], [-2.05, 6.3, -2.15, 0.08]]},
            # 8 overlapping organic icosphere(subdiv=1) blobs, vertically squashed 0.68-0.75, starting y=2.7m
            {'op': 'blob', **cam_leaf, 'r': [3.3, 2.25, 3.1], 'p': [2.65, 5.5, 1.0], 'yaw': 0.4, 'seed': 11, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **cam_leaf, 'r': [3.2, 2.20, 3.0], 'p': [-2.45, 5.4, 1.25], 'yaw': 1.3, 'seed': 23, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **cam_leaf, 'r': [3.1, 2.20, 3.2], 'p': [1.05, 5.7, -2.55], 'yaw': 2.1, 'seed': 37, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **cam_leaf, 'r': [2.9, 2.10, 2.9], 'p': [-1.95, 6.4, -2.0], 'yaw': 2.9, 'seed': 53, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **cam_leaf, 'r': [3.0, 2.10, 2.8], 'p': [0.2, 4.9, 2.35], 'yaw': 0.9, 'seed': 67, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **cam_leaf, 'r': [3.8, 2.65, 3.6], 'p': [0.25, 7.5, 0.1], 'yaw': 1.7, 'seed': 79, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **cam_leaf, 'r': [3.3, 2.35, 3.2], 'p': [1.4, 8.6, -0.6], 'yaw': 2.5, 'seed': 89, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **cam_leaf, 'r': [3.1, 2.25, 3.0], 'p': [-0.6, 9.7, 0.2], 'yaw': 0.6, 'seed': 101, 'subdiv': 1, 'jitter': 0.14},
        ],
        'mid': [
            {'op': 'tube', **cam_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.37], [0.22, 5.6, 0.04, 0.16]]},
            {'op': 'blob', **cam_leaf, 'r': [3.7, 2.5, 3.5], 'p': [1.8, 5.8, 0.6], 'yaw': 0.4, 'seed': 11, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **cam_leaf, 'r': [3.6, 2.4, 3.5], 'p': [-1.7, 5.9, -0.5], 'yaw': 1.8, 'seed': 37, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **cam_leaf, 'r': [3.8, 2.6, 3.6], 'p': [0.2, 7.2, -1.2], 'yaw': 1.1, 'seed': 67, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **cam_leaf, 'r': [3.5, 2.5, 3.4], 'p': [0.1, 9.2, 0.2], 'yaw': 2.4, 'seed': 89, 'subdiv': 0, 'jitter': 0.13},
        ],
        'far': [
            {'op': 'tube', **cam_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.36], [0.2, 5.8, 0.0, 0.16]]},
            {'op': 'blob', **cam_leaf, 'r': [5.2, 3.3, 5.0], 'p': [0.2, 6.4, 0.0], 'yaw': 0.5, 'seed': 11, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **cam_leaf, 'r': [4.1, 2.8, 4.0], 'p': [-0.3, 8.8, 0.2], 'yaw': 1.9, 'seed': 79, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 1. banyan — 小叶榕/高山榕 (Ficus microcarpa)
    # Multi-stem fused buttress trunk 1.5-1.9m across at base; low broad spreading crown
    # (crown W=15.0m, crown H=9.2m, ratio 1.63x); thick secondary-trunk pillar prop roots
    # (D=0.36-0.44m); bundled aerial root curtains of varied lengths.
    # -------------------------------------------------------------------------
    ban_leaf = leaf('banyan')
    ban_wood = wood('banyanTrunk')
    banyan = {
        'id': 1, 'name': 'banyan', 'zh': '小叶榕', 'latin': 'Ficus microcarpa',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.02, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.09, 0.94, 1.07], 'lean': -0.03, 'tint': [0.95, 1.02, 0.96]},
            {'scale': [0.94, 1.05, 0.95], 'lean': 0.03, 'tint': [1.03, 1.02, 0.94]},
        ],
        'near': [
            # Massive central core + 5 thick fused buttress root-stems (total base span ~1.68m within 1.2-2.0m!)
            {'op': 'tube', **ban_wood, 'sides': 8, 'pts': [
                [0.0, -1.5, 0.0, 0.80], [0.0, 0.0, 0.0, 0.70], [0.04, 1.4, 0.02, 0.54], [0.06, 2.9, 0.0, 0.42],
            ]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.64, -1.2, 0.18, 0.32], [0.54, 0.0, 0.16, 0.30], [0.40, 1.0, 0.12, 0.23], [0.22, 2.5, 0.06, 0.18]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[-0.60, -1.2, 0.26, 0.30], [-0.52, 0.0, 0.22, 0.28], [-0.38, 1.0, 0.16, 0.22], [-0.18, 2.5, 0.08, 0.16]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.16, -1.2, -0.66, 0.31], [0.14, 0.0, -0.56, 0.29], [0.10, 1.0, -0.40, 0.22], [0.05, 2.5, -0.20, 0.17]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[-0.38, -1.2, -0.54, 0.28], [-0.32, 0.0, -0.46, 0.26], [-0.22, 0.9, -0.34, 0.20], [-0.12, 2.4, -0.16, 0.15]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.30, -1.2, 0.60, 0.29], [0.26, 0.0, 0.52, 0.27], [0.18, 0.9, 0.36, 0.21], [0.10, 2.4, 0.18, 0.16]]},
            # 5 heavy horizontal-spreading limbs reaching deep into wide crown pads
            {'op': 'tube', **ban_wood, 'sides': 6, 'pts': [[0.08, 2.3, 0.02, 0.31], [2.1, 3.6, 0.70, 0.22], [3.8, 4.9, 1.25, 0.12]]},
            {'op': 'tube', **ban_wood, 'sides': 6, 'pts': [[0.02, 2.2, -0.02, 0.30], [-2.0, 3.5, -0.80, 0.21], [-3.7, 4.8, -1.40, 0.12]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.04, 2.4, 0.05, 0.27], [-0.70, 3.7, 2.0, 0.19], [-1.30, 5.0, 3.55, 0.11]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.06, 2.4, -0.05, 0.27], [0.90, 3.8, -1.95, 0.19], [1.65, 5.1, -3.45, 0.11]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.06, 2.7, 0.0, 0.25], [0.25, 5.2, 0.15, 0.16], [0.35, 7.6, 0.1, 0.10]]},
            # 3 thick grounded pillar prop-root secondary trunks (base D=0.38-0.46m, clear taper)
            {'op': 'tube', **ban_wood, 'sides': 6, 'pts': [[2.25, -1.4, 0.76, 0.24], [2.20, 0.0, 0.74, 0.22], [2.14, 1.9, 0.72, 0.16], [2.10, 3.65, 0.70, 0.17]]},
            {'op': 'tube', **ban_wood, 'sides': 6, 'pts': [[-2.15, -1.4, -0.84, 0.22], [-2.10, 0.0, -0.82, 0.20], [-2.04, 1.8, -0.80, 0.15], [-2.00, 3.55, -0.80, 0.16]]},
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[-0.76, -1.4, 2.15, 0.20], [-0.74, 0.0, 2.10, 0.18], [-0.72, 1.9, 2.04, 0.14], [-0.70, 3.75, 2.00, 0.15]]},
            # 4 clustered aerial-root curtain bundles (each bundle has 4 staggered rootlets of varied drop!)
            {'op': 'bundles', **ban_wood, 'clusters': [
                {'p': [3.15, 4.4, 1.00], 'spread': 0.34, 'lengths': [1.5, 2.4, 3.0, 1.9], 'r': 0.044},
                {'p': [-3.05, 4.3, -1.15], 'spread': 0.34, 'lengths': [2.7, 1.4, 2.2, 3.0], 'r': 0.044},
                {'p': [-1.05, 4.4, 2.95], 'spread': 0.30, 'lengths': [1.7, 2.8, 1.3, 2.3], 'r': 0.040},
                {'p': [1.35, 4.5, -2.85], 'spread': 0.30, 'lengths': [2.5, 1.6, 2.9, 2.0], 'r': 0.040},
            ]},
            # 9 broad overlapping organic blobs forming a low, wide dome (crown W ~14.7m, crown H ~9.8m -> W/H = 1.50!)
            {'op': 'blob', **ban_leaf, 'r': [3.85, 2.40, 3.55], 'p': [3.65, 4.95, 1.15], 'yaw': 0.3, 'seed': 17, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **ban_leaf, 'r': [3.80, 2.40, 3.55], 'p': [-3.55, 4.85, -1.35], 'yaw': 1.5, 'seed': 31, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **ban_leaf, 'r': [3.60, 2.35, 3.80], 'p': [-1.25, 5.05, 3.45], 'yaw': 2.2, 'seed': 47, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **ban_leaf, 'r': [3.60, 2.35, 3.75], 'p': [1.60, 5.15, -3.35], 'yaw': 0.9, 'seed': 61, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **ban_leaf, 'r': [3.35, 2.25, 3.25], 'p': [2.55, 5.65, -1.95], 'yaw': 1.8, 'seed': 73, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [3.35, 2.25, 3.25], 'p': [-2.45, 5.55, 2.05], 'yaw': 2.7, 'seed': 83, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [4.65, 2.85, 4.40], 'p': [0.10, 7.35, 0.00], 'yaw': 1.1, 'seed': 97, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **ban_leaf, 'r': [3.85, 2.50, 3.65], 'p': [-0.85, 8.85, -0.35], 'yaw': 2.4, 'seed': 109, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [3.45, 2.35, 3.35], 'p': [0.75, 9.95, 0.25], 'yaw': 0.6, 'seed': 127, 'subdiv': 1, 'jitter': 0.14},
        ],
        'mid': [
            {'op': 'tube', **ban_wood, 'sides': 6, 'pts': [[0.0, -1.5, 0.0, 0.78], [0.04, 1.5, 0.0, 0.52], [0.06, 5.4, 0.0, 0.26]]},
            {'op': 'tube', **ban_wood, 'sides': 4, 'pts': [[2.35, -1.2, 0.80, 0.20], [2.30, 4.8, 0.76, 0.14]]},
            {'op': 'tube', **ban_wood, 'sides': 4, 'pts': [[-2.25, -1.2, -0.88, 0.19], [-2.20, 4.7, -0.85, 0.14]]},
            {'op': 'blob', **ban_leaf, 'r': [4.8, 2.6, 4.4], 'p': [2.6, 5.6, 0.7], 'yaw': 0.3, 'seed': 17, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [4.7, 2.6, 4.4], 'p': [-2.5, 5.5, -0.8], 'yaw': 1.6, 'seed': 31, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [4.6, 2.5, 4.6], 'p': [-0.2, 5.8, 2.2], 'yaw': 2.3, 'seed': 47, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **ban_leaf, 'r': [4.8, 2.8, 4.5], 'p': [0.1, 8.0, -0.3], 'yaw': 1.1, 'seed': 97, 'subdiv': 0, 'jitter': 0.14},
        ],
        'far': [
            {'op': 'tube', **ban_wood, 'sides': 5, 'pts': [[0.0, -1.2, 0.0, 0.76], [0.05, 5.2, 0.0, 0.30]]},
            {'op': 'tube', **ban_wood, 'sides': 3, 'pts': [[2.3, -1.0, 0.7, 0.19], [2.2, 4.6, 0.7, 0.14]]},
            {'op': 'blob', **ban_leaf, 'r': [7.0, 3.2, 6.6], 'p': [0.0, 5.9, 0.0], 'yaw': 0.4, 'seed': 17, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **ban_leaf, 'r': [5.0, 2.8, 4.8], 'p': [0.2, 8.2, 0.0], 'yaw': 1.8, 'seed': 97, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 2. osmanthus — 桂花 (Osmanthus fragrans, 市树; matched to IMG_1359)
    # Low branching at 1.1-1.5m into multiple ascending stems; compact dense ovoid-round
    # crown descending down to ~1.5m so crown height is ~76% of total tree height (6.3m).
    # -------------------------------------------------------------------------
    osm_leaf = leaf('osmanthus')
    osm_wood = wood('osmanthusTrunk')
    osmanthus = {
        'id': 2, 'name': 'osmanthus', 'zh': '桂花', 'latin': 'Osmanthus fragrans',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.06, 0.95, 1.05], 'lean': -0.02, 'tint': [1.04, 1.02, 0.92]},
            {'scale': [0.94, 1.07, 0.95], 'lean': 0.02, 'tint': [0.96, 1.00, 0.97]},
        ],
        'near': [
            # Sturdy base stem D=0.38m, forking low at y=1.15m into 4 ascending multi-stems
            {'op': 'tube', **osm_wood, 'sides': 6, 'pts': [[0.0, -1.5, 0.0, 0.22], [0.0, 0.0, 0.0, 0.19], [0.01, 1.25, 0.0, 0.15]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.02, 1.05, 0.02, 0.11], [0.52, 2.1, 0.30, 0.08], [0.85, 3.1, 0.48, 0.05]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[-0.02, 1.05, 0.02, 0.11], [-0.50, 2.05, 0.34, 0.08], [-0.82, 3.05, 0.52, 0.05]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.01, 1.10, -0.02, 0.11], [0.15, 2.15, -0.52, 0.08], [0.25, 3.2, -0.82, 0.05]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[-0.01, 1.15, -0.01, 0.10], [-0.28, 2.4, -0.35, 0.07], [-0.35, 3.8, -0.45, 0.045]]},
            # 8 tightly overlapping organic blobs from y=1.5m up to y=6.3m (compact ovoid crown, 76% of height!)
            {'op': 'blob', **osm_leaf, 'r': [1.65, 1.25, 1.55], 'p': [0.80, 2.75, 0.45], 'yaw': 0.5, 'seed': 13, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.60, 1.25, 1.55], 'p': [-0.78, 2.70, 0.50], 'yaw': 1.6, 'seed': 29, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.60, 1.25, 1.65], 'p': [0.22, 2.80, -0.78], 'yaw': 2.5, 'seed': 43, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.55, 1.20, 1.50], 'p': [-0.45, 2.95, -0.55], 'yaw': 0.9, 'seed': 57, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [2.05, 1.55, 1.95], 'p': [0.05, 3.85, 0.05], 'yaw': 1.2, 'seed': 71, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.75, 1.35, 1.70], 'p': [0.45, 4.55, -0.20], 'yaw': 2.1, 'seed': 83, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.70, 1.35, 1.65], 'p': [-0.40, 4.65, 0.25], 'yaw': 0.3, 'seed': 97, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **osm_leaf, 'r': [1.45, 1.25, 1.40], 'p': [0.02, 5.25, -0.02], 'yaw': 1.8, 'seed': 113, 'subdiv': 1, 'jitter': 0.13},
        ],
        'mid': [
            {'op': 'tube', **osm_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.19], [0.02, 3.2, 0.0, 0.09]]},
            {'op': 'blob', **osm_leaf, 'r': [2.25, 1.75, 2.15], 'p': [0.05, 3.15, 0.05], 'yaw': 0.6, 'seed': 13, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **osm_leaf, 'r': [1.95, 1.60, 1.90], 'p': [-0.10, 4.45, -0.05], 'yaw': 1.9, 'seed': 71, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **osm_leaf, 'r': [1.35, 1.15, 1.30], 'p': [0.0, 5.25, 0.0], 'yaw': 0.9, 'seed': 113, 'subdiv': 0, 'jitter': 0.12},
        ],
        'far': [
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.19], [0.0, 3.2, 0.0, 0.09]]},
            {'op': 'blob', **osm_leaf, 'r': [2.35, 1.95, 2.25], 'p': [0.0, 3.4, 0.0], 'yaw': 0.6, 'seed': 13, 'subdiv': 0, 'jitter': 0.12},
            {'op': 'blob', **osm_leaf, 'r': [1.75, 1.50, 1.70], 'p': [0.0, 4.8, 0.0], 'yaw': 1.9, 'seed': 71, 'subdiv': 0, 'jitter': 0.12},
        ],
    }

    # -------------------------------------------------------------------------
    # 3. palm — 蒲葵/大王椰 (Livistona chinensis / Roystonea regia)
    # Smooth pale-grey columnar stem (D=0.64m at base, slight mid swell) clearly separated
    # from vivid green 1.7m crownshaft; rounded spherical-fan head with drooping leaflet tips.
    # -------------------------------------------------------------------------
    palm_leaf = leaf('palm')
    palm_wood = wood('palmTrunk')
    palm_shaft = PALETTE['palmCrownshaft']
    palm = {
        'id': 3, 'name': 'palm', 'zh': '蒲葵/大王椰', 'latin': 'Livistona chinensis / Roystonea regia',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.03, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.95, 1.10, 0.95], 'lean': -0.04, 'tint': [0.97, 1.03, 0.95]},
            {'scale': [1.05, 0.91, 1.05], 'lean': 0.04, 'tint': [1.03, 0.99, 0.93]},
        ],
        'near': [
            # Pale grey-white smooth trunk with subtle royal-palm swell + distinct vivid green crownshaft
            {'op': 'tube', **palm_wood, 'sides': 8, 'pts': [
                [0.0, -1.5, 0.0, 0.35], [0.0, 0.0, 0.0, 0.32], [0.03, 2.8, 0.01, 0.27],
                [0.06, 5.4, 0.02, 0.29], [0.09, 8.5, 0.03, 0.22],
            ]},
            {'op': 'tube', **palm_shaft, 'sides': 7, 'pts': [
                [0.09, 8.45, 0.03, 0.235], [0.10, 9.5, 0.03, 0.21], [0.11, 10.25, 0.03, 0.15],
            ]},
            # Upper ascending fan crown + lower wide arching crown with pronounced drooping tips
            {'op': 'fronds', **palm_leaf, 'origin': [0.11, 10.2, 0.03], 'count': 7, 'length': 2.85, 'width': 0.96, 'rise': 1.55, 'droop': 1.45, 'segs': 5, 'phase': 0.22},
            {'op': 'fronds', **palm_leaf, 'origin': [0.11, 10.0, 0.03], 'count': 9, 'length': 3.30, 'width': 1.05, 'rise': 0.78, 'droop': 2.55, 'segs': 5, 'phase': 0.0},
        ],
        'mid': [
            {'op': 'tube', **palm_wood, 'sides': 6, 'pts': [[0.0, -1.5, 0.0, 0.32], [0.09, 8.5, 0.03, 0.22]]},
            {'op': 'tube', **palm_shaft, 'sides': 5, 'pts': [[0.09, 8.45, 0.03, 0.23], [0.11, 10.2, 0.03, 0.15]]},
            {'op': 'fronds', **palm_leaf, 'origin': [0.11, 10.1, 0.03], 'count': 8, 'length': 3.20, 'width': 1.05, 'rise': 1.10, 'droop': 2.25, 'segs': 3, 'phase': 0.0},
        ],
        'far': [
            {'op': 'tube', **palm_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.31], [0.09, 8.6, 0.03, 0.22]]},
            {'op': 'tube', **palm_shaft, 'sides': 4, 'pts': [[0.09, 8.5, 0.03, 0.23], [0.11, 10.2, 0.03, 0.16]]},
            {'op': 'fronds', **palm_leaf, 'origin': [0.11, 10.1, 0.03], 'count': 6, 'length': 3.15, 'width': 1.15, 'rise': 1.05, 'droop': 2.20, 'segs': 2, 'phase': 0.1},
        ],
    }

    # -------------------------------------------------------------------------
    # 4. conifer — 水杉 (Metasequoia glyptostroboides)
    # Narrow spire (H=15.6m, W=4.4m -> W:H = 1:3.55 inside 1:4..1:3!); fluted buttress trunk
    # D=0.82m; horizontal-to-slightly-upturned feathery whorls (NO drooping spruce skirts);
    # Variant 2 has November rusty-ochre/bronze-yellow autumn foliage tint.
    # -------------------------------------------------------------------------
    con_leaf = leaf('conifer')
    con_wood = wood('coniferTrunk')
    conifer = {
        'id': 4, 'name': 'conifer', 'zh': '水杉', 'latin': 'Metasequoia glyptostroboides',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.008, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.95, 1.06, 0.95], 'lean': -0.010, 'tint': [1.18, 1.03, 0.84]},
            {'scale': [1.04, 0.96, 1.04], 'lean': 0.010, 'tint': [2.55, 1.14, 0.56]},  # Nov rusty-yellow/ochre variant!
        ],
        'near': [
            {'op': 'tube', **con_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.46], [0.0, 0.0, 0.0, 0.41], [0.0, 2.2, 0.0, 0.27],
                [0.0, 8.0, 0.0, 0.16], [0.0, 14.8, 0.0, 0.05],
            ]},
            # Tapered conical inner foliage core so whorls form a lush continuous narrow cone (not bare fishbone!)
            {'op': 'blob', **con_leaf, 'r': [1.32, 1.85, 1.32], 'p': [0.0, 4.1, 0.0], 'yaw': 0.2, 'seed': 17, 'subdiv': 0, 'jitter': 0.12},
            {'op': 'blob', **con_leaf, 'r': [1.14, 1.85, 1.14], 'p': [0.0, 6.5, 0.0], 'yaw': 1.1, 'seed': 41, 'subdiv': 0, 'jitter': 0.12},
            {'op': 'blob', **con_leaf, 'r': [0.94, 1.80, 0.94], 'p': [0.0, 8.9, 0.0], 'yaw': 2.0, 'seed': 67, 'subdiv': 0, 'jitter': 0.12},
            {'op': 'blob', **con_leaf, 'r': [0.72, 1.70, 0.72], 'p': [0.0, 11.2, 0.0], 'yaw': 0.7, 'seed': 97, 'subdiv': 0, 'jitter': 0.11},
            {'op': 'blob', **con_leaf, 'r': [0.48, 1.55, 0.48], 'p': [0.0, 13.4, 0.0], 'yaw': 1.6, 'seed': 127, 'subdiv': 0, 'jitter': 0.10},
            # 10 fine horizontal + slightly upturned (+lift) feathery whorls tapering 2.22m -> 0.44m (W:H = 1:3.5)
            {'op': 'whorl', **con_leaf, 'y': 2.7,  'r': 2.16, 'thick': 0.64, 'lift': 0.28, 'lobes': 7, 'yaw': 0.00, 'seed': 11},
            {'op': 'whorl', **con_leaf, 'y': 4.0,  'r': 2.22, 'thick': 0.66, 'lift': 0.30, 'lobes': 7, 'yaw': 0.45, 'seed': 23},
            {'op': 'whorl', **con_leaf, 'y': 5.3,  'r': 2.04, 'thick': 0.62, 'lift': 0.28, 'lobes': 7, 'yaw': 0.90, 'seed': 37},
            {'op': 'whorl', **con_leaf, 'y': 6.6,  'r': 1.84, 'thick': 0.58, 'lift': 0.26, 'lobes': 7, 'yaw': 1.35, 'seed': 51},
            {'op': 'whorl', **con_leaf, 'y': 7.9,  'r': 1.62, 'thick': 0.54, 'lift': 0.24, 'lobes': 6, 'yaw': 1.80, 'seed': 65},
            {'op': 'whorl', **con_leaf, 'y': 9.2,  'r': 1.40, 'thick': 0.50, 'lift': 0.22, 'lobes': 6, 'yaw': 2.25, 'seed': 79},
            {'op': 'whorl', **con_leaf, 'y': 10.5, 'r': 1.16, 'thick': 0.46, 'lift': 0.20, 'lobes': 6, 'yaw': 2.70, 'seed': 93},
            {'op': 'whorl', **con_leaf, 'y': 11.8, 'r': 0.92, 'thick': 0.42, 'lift': 0.18, 'lobes': 5, 'yaw': 3.15, 'seed': 107},
            {'op': 'whorl', **con_leaf, 'y': 13.1, 'r': 0.68, 'thick': 0.38, 'lift': 0.16, 'lobes': 5, 'yaw': 3.60, 'seed': 121},
            {'op': 'whorl', **con_leaf, 'y': 14.3, 'r': 0.44, 'thick': 0.34, 'lift': 0.15, 'lobes': 5, 'yaw': 4.05, 'seed': 135},
            {'op': 'blob',  **con_leaf, 'r': [0.32, 0.78, 0.32], 'p': [0.0, 15.0, 0.0], 'yaw': 0.5, 'seed': 149, 'subdiv': 0, 'jitter': 0.10},
        ],
        'mid': [
            {'op': 'tube', **con_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.40], [0.0, 13.5, 0.0, 0.07]]},
            {'op': 'blob',  **con_leaf, 'r': [1.65, 2.35, 1.65], 'p': [0.0, 4.8, 0.0], 'yaw': 0.2, 'seed': 17, 'subdiv': 0, 'jitter': 0.11},
            {'op': 'blob',  **con_leaf, 'r': [1.22, 2.40, 1.22], 'p': [0.0, 8.6, 0.0], 'yaw': 1.3, 'seed': 67, 'subdiv': 0, 'jitter': 0.11},
            {'op': 'blob',  **con_leaf, 'r': [0.72, 2.15, 0.72], 'p': [0.0, 12.5, 0.0], 'yaw': 2.2, 'seed': 127, 'subdiv': 0, 'jitter': 0.10},
            {'op': 'whorl', **con_leaf, 'y': 3.4,  'r': 2.18, 'thick': 0.68, 'lift': 0.28, 'lobes': 6, 'yaw': 0.0, 'seed': 11},
            {'op': 'whorl', **con_leaf, 'y': 6.2,  'r': 1.88, 'thick': 0.62, 'lift': 0.25, 'lobes': 6, 'yaw': 0.5, 'seed': 37},
            {'op': 'whorl', **con_leaf, 'y': 9.0,  'r': 1.44, 'thick': 0.55, 'lift': 0.21, 'lobes': 5, 'yaw': 1.0, 'seed': 65},
            {'op': 'whorl', **con_leaf, 'y': 11.8, 'r': 0.96, 'thick': 0.46, 'lift': 0.18, 'lobes': 5, 'yaw': 1.5, 'seed': 93},
            {'op': 'blob',  **con_leaf, 'r': [0.42, 1.15, 0.42], 'p': [0.0, 14.5, 0.0], 'yaw': 0.3, 'seed': 135, 'subdiv': 0, 'jitter': 0.10},
        ],
        'far': [
            {'op': 'tube', **con_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.39], [0.0, 13.0, 0.0, 0.08]]},
            {'op': 'blob', **con_leaf, 'r': [2.05, 2.55, 2.05], 'p': [0.0, 4.8, 0.0], 'yaw': 0.2, 'seed': 11, 'subdiv': 0, 'jitter': 0.11},
            {'op': 'blob', **con_leaf, 'r': [1.45, 2.65, 1.45], 'p': [0.0, 8.7, 0.0], 'yaw': 1.4, 'seed': 65, 'subdiv': 0, 'jitter': 0.11},
            {'op': 'blob', **con_leaf, 'r': [0.78, 2.35, 0.78], 'p': [0.0, 12.8, 0.0], 'yaw': 2.5, 'seed': 121, 'subdiv': 0, 'jitter': 0.10},
        ],
    }

    # -------------------------------------------------------------------------
    # 5. shrub — 山石灌丛 (Karst scrub, slot 5 preserved)
    # -------------------------------------------------------------------------
    sh_leaf = leaf('shrub')
    shrub = {
        'id': 5, 'name': 'shrub', 'zh': '山石灌丛', 'latin': 'Karst broadleaf scrub',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.0, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.10, 0.90, 1.06], 'lean': 0.0, 'tint': [0.96, 1.02, 0.95]},
            {'scale': [0.92, 1.08, 0.94], 'lean': 0.0, 'tint': [1.04, 1.00, 0.94]},
        ],
        'near': [
            {'op': 'blob', **sh_leaf, 'r': [1.45, 0.95, 1.35], 'p': [-0.2, 0.65, 0.0], 'yaw': 0.3, 'seed': 19, 'subdiv': 0, 'jitter': 0.16},
            {'op': 'blob', **sh_leaf, 'r': [1.10, 0.80, 1.05], 'p': [0.95, 0.52, 0.40], 'yaw': 1.4, 'seed': 41, 'subdiv': 0, 'jitter': 0.16},
            {'op': 'blob', **sh_leaf, 'r': [0.95, 0.72, 0.95], 'p': [-0.80, 0.48, -0.55], 'yaw': 2.3, 'seed': 67, 'subdiv': 0, 'jitter': 0.16},
        ],
        'mid': [
            {'op': 'blob', **sh_leaf, 'r': [1.50, 0.96, 1.40], 'p': [-0.15, 0.62, 0.0], 'yaw': 0.4, 'seed': 19, 'subdiv': 0, 'jitter': 0.15},
            {'op': 'blob', **sh_leaf, 'r': [1.05, 0.78, 1.00], 'p': [0.85, 0.50, 0.35], 'yaw': 1.5, 'seed': 41, 'subdiv': 0, 'jitter': 0.15},
        ],
        'far': [
            {'op': 'blob', **sh_leaf, 'r': [1.65, 0.98, 1.55], 'p': [0.1, 0.60, 0.0], 'yaw': 0.5, 'seed': 19, 'subdiv': 0, 'jitter': 0.14},
        ],
    }

    # -------------------------------------------------------------------------
    # 6. virens — 黄葛榕/大叶榕 (Ficus virens)
    # Distinct from camphor: high 4.6-5.2m fork on buttressed pale trunk (D=0.96m),
    # thick steep V-shaped ascending primary limbs lifting a wide high crown top;
    # markedly brighter, fresher emerald foliage than camphor!
    # -------------------------------------------------------------------------
    vir_leaf = leaf('virens')
    vir_wood = wood('virensTrunk')
    virens = {
        'id': 6, 'name': 'virens', 'zh': '黄葛榕（大叶榕）', 'latin': 'Ficus virens',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.02, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.08, 0.96, 1.06], 'lean': -0.02, 'tint': [1.05, 1.03, 0.92]},
            {'scale': [0.95, 1.06, 0.95], 'lean': 0.03, 'tint': [0.96, 1.01, 0.96]},
        ],
        'near': [
            # Tall buttressed pale-grey trunk (D=0.96m at base), unbranched up to y=4.6m!
            {'op': 'tube', **vir_wood, 'sides': 8, 'pts': [
                [0.0, -1.5, 0.0, 0.56], [0.0, 0.0, 0.0, 0.48], [0.02, 1.8, 0.0, 0.36],
                [0.04, 3.4, 0.01, 0.31], [0.05, 4.8, 0.02, 0.27],
            ]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[0.52, -1.2, 0.06, 0.22], [0.28, 0.9, 0.04, 0.13], [0.14, 2.2, 0.02, 0.07]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[-0.46, -1.2, 0.28, 0.21], [-0.25, 0.85, 0.16, 0.12], [-0.12, 2.1, 0.08, 0.07]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[-0.14, -1.2, -0.50, 0.21], [-0.08, 0.85, -0.28, 0.12], [-0.04, 2.1, -0.14, 0.07]]},
            # 4 thick steep V-shaped ascending limbs forking at y=4.5m up to y=8.5m inside upper crown
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.05, 4.5, 0.02, 0.22], [1.65, 6.6, 0.75, 0.15], [3.35, 8.4, 1.50, 0.09]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.04, 4.5, 0.02, 0.22], [-1.60, 6.5, 0.85, 0.15], [-3.25, 8.3, 1.65, 0.09]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.06, 4.6, 0.0, 0.21], [0.75, 6.7, -1.65, 0.15], [1.55, 8.5, -3.25, 0.09]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.04, 4.6, 0.0, 0.20], [-1.25, 6.8, -1.35, 0.14], [-2.55, 8.6, -2.65, 0.09]]},
            # High, wide-topped lush umbrella crown (y=6.4m .. 14.0m, broadest near upper third!)
            {'op': 'blob', **vir_leaf, 'r': [3.7, 2.25, 3.4], 'p': [3.3, 8.8, 1.45], 'yaw': 0.5, 'seed': 15, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **vir_leaf, 'r': [3.6, 2.25, 3.4], 'p': [-3.2, 8.7, 1.60], 'yaw': 1.4, 'seed': 27, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **vir_leaf, 'r': [3.5, 2.20, 3.6], 'p': [1.5, 8.9, -3.15], 'yaw': 2.3, 'seed': 45, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **vir_leaf, 'r': [3.5, 2.20, 3.4], 'p': [-2.4, 9.0, -2.55], 'yaw': 0.9, 'seed': 63, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **vir_leaf, 'r': [3.3, 2.10, 3.2], 'p': [0.2, 8.6, 2.85], 'yaw': 1.9, 'seed': 75, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **vir_leaf, 'r': [4.4, 2.55, 4.2], 'p': [0.0, 10.3, 0.0], 'yaw': 1.2, 'seed': 87, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **vir_leaf, 'r': [3.8, 2.25, 3.6], 'p': [1.5, 11.2, -0.7], 'yaw': 2.6, 'seed': 99, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **vir_leaf, 'r': [3.6, 2.15, 3.5], 'p': [-1.1, 11.6, 0.6], 'yaw': 0.3, 'seed': 115, 'subdiv': 1, 'jitter': 0.14},
        ],
        'mid': [
            {'op': 'tube', **vir_wood, 'sides': 6, 'pts': [[0.0, -1.5, 0.0, 0.48], [0.05, 4.8, 0.0, 0.27]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[0.05, 4.5, 0.0, 0.20], [2.6, 8.2, 0.9, 0.10]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[0.04, 4.5, 0.0, 0.20], [-2.5, 8.1, -0.9, 0.10]]},
            {'op': 'blob', **vir_leaf, 'r': [4.3, 2.5, 4.1], 'p': [2.3, 9.0, 0.8], 'yaw': 0.5, 'seed': 15, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **vir_leaf, 'r': [4.2, 2.5, 4.0], 'p': [-2.2, 8.9, -0.8], 'yaw': 1.8, 'seed': 45, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **vir_leaf, 'r': [4.6, 2.7, 4.4], 'p': [0.0, 10.9, 0.1], 'yaw': 1.1, 'seed': 87, 'subdiv': 0, 'jitter': 0.14},
        ],
        'far': [
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.46], [0.05, 7.6, 0.0, 0.20]]},
            {'op': 'blob', **vir_leaf, 'r': [6.2, 3.0, 5.9], 'p': [0.0, 9.4, 0.0], 'yaw': 0.5, 'seed': 15, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **vir_leaf, 'r': [4.6, 2.6, 4.4], 'p': [0.2, 11.4, 0.0], 'yaw': 1.9, 'seed': 87, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 7. bischofia — 秋枫/复羽叶栾树 (Bischofia javanica / Koelreuteria bipinnata)
    # NO brown cap on top! Leaning dark trunk (D=0.72m at base, +X lean toward street),
    # sweeping arched limbs reaching across lane; 7 irregular green blobs + 2 scattered
    # pinkish-brown Koelreuteria seed-pod clusters nestled along outer-upper crown surface (~18%).
    # -------------------------------------------------------------------------
    bis_leaf = leaf('bischofia')
    bis_pod = leaf('bischofiaPod')
    bis_wood = wood('bischofiaTrunk')
    bischofia = {
        'id': 7, 'name': 'bischofia', 'zh': '秋枫/栾树', 'latin': 'Bischofia javanica / Koelreuteria bipinnata',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.09, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.07, 0.96, 1.05], 'lean': 0.12, 'tint': [1.05, 1.00, 0.93]},
            {'scale': [0.95, 1.06, 0.96], 'lean': 0.07, 'tint': [1.09, 0.98, 0.90]},
        ],
        'near': [
            {'op': 'tube', **bis_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.41], [0.0, 0.0, 0.0, 0.36], [0.22, 1.5, 0.04, 0.29],
                [0.52, 3.0, 0.08, 0.23], [1.05, 7.5, 0.10, 0.12],
            ]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.48, 2.8, 0.07, 0.19], [2.25, 4.4, 0.55, 0.13], [4.05, 5.8, 0.95, 0.08]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.46, 2.8, 0.06, 0.18], [-0.85, 4.5, 1.15, 0.13], [-2.05, 6.0, 2.15, 0.08]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.50, 2.9, 0.06, 0.18], [1.15, 4.6, -1.45, 0.13], [2.05, 6.1, -2.65, 0.08]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.72, 4.2, 0.08, 0.15], [2.15, 6.4, -0.45, 0.10], [3.10, 7.9, -0.80, 0.07]]},
            # 7 main green irregular crown blobs (top is pure lush green, NO brown cap!)
            {'op': 'blob', **bis_leaf, 'r': [3.3, 2.15, 2.9], 'p': [3.95, 6.0, 0.95], 'yaw': 0.3, 'seed': 21, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **bis_leaf, 'r': [3.0, 2.10, 2.9], 'p': [-1.95, 6.2, 2.05], 'yaw': 1.5, 'seed': 35, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **bis_leaf, 'r': [3.0, 2.10, 3.0], 'p': [1.95, 6.3, -2.55], 'yaw': 2.4, 'seed': 51, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **bis_leaf, 'r': [2.9, 2.05, 2.8], 'p': [-1.45, 6.8, -1.65], 'yaw': 0.8, 'seed': 65, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **bis_leaf, 'r': [3.6, 2.45, 3.4], 'p': [1.15, 8.1, 0.10], 'yaw': 1.2, 'seed': 79, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **bis_leaf, 'r': [3.2, 2.20, 3.0], 'p': [2.85, 8.4, -0.75], 'yaw': 2.1, 'seed': 91, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **bis_leaf, 'r': [3.0, 2.20, 2.9], 'p': [0.55, 10.1, -0.15], 'yaw': 0.6, 'seed': 105, 'subdiv': 1, 'jitter': 0.14},
            # 2 scattered pinkish-brown panicle pod puffs nestled on lateral crown surface (~18% of blobs)
            {'op': 'blob', **bis_pod, 'r': [1.75, 1.15, 1.65], 'p': [3.65, 7.5, 1.45], 'yaw': 0.7, 'seed': 119, 'subdiv': 1, 'jitter': 0.16},
            {'op': 'blob', **bis_pod, 'r': [1.55, 1.05, 1.50], 'p': [-0.85, 8.6, 1.75], 'yaw': 2.2, 'seed': 133, 'subdiv': 0, 'jitter': 0.16},
        ],
        'mid': [
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.36], [0.85, 5.8, 0.08, 0.15]]},
            {'op': 'blob', **bis_leaf, 'r': [3.8, 2.4, 3.5], 'p': [2.6, 6.4, 0.4], 'yaw': 0.4, 'seed': 21, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **bis_leaf, 'r': [3.5, 2.3, 3.4], 'p': [-1.1, 6.6, 0.2], 'yaw': 1.7, 'seed': 35, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **bis_leaf, 'r': [3.6, 2.5, 3.4], 'p': [1.0, 9.1, -0.2], 'yaw': 1.1, 'seed': 79, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **bis_pod,  'r': [1.6, 1.05, 1.5], 'p': [3.1, 7.6, 1.2], 'yaw': 0.8, 'seed': 119, 'subdiv': 0, 'jitter': 0.15},
        ],
        'far': [
            {'op': 'tube', **bis_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.35], [0.8, 5.8, 0.0, 0.15]]},
            {'op': 'blob', **bis_leaf, 'r': [5.2, 3.1, 4.9], 'p': [1.1, 6.8, 0.0], 'yaw': 0.5, 'seed': 21, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **bis_leaf, 'r': [3.8, 2.6, 3.6], 'p': [0.8, 9.4, 0.0], 'yaw': 1.8, 'seed': 79, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 8. elaeocarpus — 杜英 (Elaeocarpus decipiens)
    # Broadleaf evergreen tree (NOT a Christmas conifer!): upright oblong-ovoid / columnar
    # clustered broadleaf crown with ~2:1 height-to-width ratio (H=11.6m, W=5.8m);
    # straight trunk D=0.62m; sparse crimson senescent leaf tufts <= 6% (< 8% limit).
    # -------------------------------------------------------------------------
    ela_leaf = leaf('elaeocarpus')
    ela_red = leaf('elaeocarpusRed')
    ela_wood = wood('elaeocarpusTrunk')
    elaeocarpus = {
        'id': 8, 'name': 'elaeocarpus', 'zh': '杜英', 'latin': 'Elaeocarpus decipiens',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.95, 1.07, 0.95], 'lean': -0.02, 'tint': [1.04, 0.99, 0.95]},
            {'scale': [1.05, 0.95, 1.05], 'lean': 0.02, 'tint': [0.97, 1.02, 0.96]},
        ],
        'near': [
            {'op': 'tube', **ela_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.35], [0.0, 0.0, 0.0, 0.31], [0.0, 2.2, 0.0, 0.23],
                [0.0, 5.8, 0.0, 0.15], [0.0, 9.2, 0.0, 0.08],
            ]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0.0, 2.2, 0.0, 0.15], [0.95, 3.5, 0.45, 0.08]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0.0, 2.3, 0.0, 0.15], [-0.95, 3.6, 0.50, 0.08]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0.0, 2.4, 0.0, 0.14], [0.15, 3.7, -1.05, 0.08]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0.0, 4.8, 0.0, 0.12], [-0.75, 6.4, -0.75, 0.06]]},
            # 8 tightly overlapping broadleaf blobs forming a 2:1 upright ovoid-columnar crown (W=5.8m, H=11.6m)
            {'op': 'blob', **ela_leaf, 'r': [1.95, 1.55, 1.85], 'p': [0.85, 3.8, 0.40], 'yaw': 0.4, 'seed': 17, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [1.90, 1.55, 1.85], 'p': [-0.85, 3.9, 0.45], 'yaw': 1.5, 'seed': 31, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [1.90, 1.55, 1.90], 'p': [0.10, 4.0, -0.90], 'yaw': 2.4, 'seed': 47, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [2.25, 1.85, 2.15], 'p': [0.55, 5.9, -0.35], 'yaw': 0.9, 'seed': 61, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [2.20, 1.85, 2.15], 'p': [-0.55, 6.1, 0.35], 'yaw': 2.0, 'seed': 73, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [2.05, 1.75, 2.00], 'p': [0.15, 7.9, 0.25], 'yaw': 1.2, 'seed': 89, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [1.85, 1.65, 1.80], 'p': [-0.25, 8.5, -0.30], 'yaw': 2.6, 'seed': 103, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **ela_leaf, 'r': [1.45, 1.55, 1.40], 'p': [0.0, 10.0, 0.0], 'yaw': 0.6, 'seed': 117, 'subdiv': 1, 'jitter': 0.13},
            # 2 small subdiv=0 crimson senescent leaf accents (40 tris / 680 crown tris = 5.9% <= 8%!)
            {'op': 'blob', **ela_red, 'r': [0.68, 0.48, 0.65], 'p': [1.85, 4.5, 0.72], 'yaw': 0.8, 'seed': 131, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **ela_red, 'r': [0.62, 0.45, 0.60], 'p': [-1.45, 7.2, 0.85], 'yaw': 2.1, 'seed': 149, 'subdiv': 0, 'jitter': 0.14},
        ],
        'mid': [
            {'op': 'tube', **ela_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.31], [0.0, 7.5, 0.0, 0.11]]},
            {'op': 'blob', **ela_leaf, 'r': [2.65, 2.2, 2.55], 'p': [0.0, 4.4, 0.0], 'yaw': 0.4, 'seed': 17, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **ela_leaf, 'r': [2.55, 2.2, 2.45], 'p': [0.05, 7.1, -0.05], 'yaw': 1.7, 'seed': 61, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **ela_leaf, 'r': [1.75, 1.9, 1.70], 'p': [0.0, 9.6, 0.0], 'yaw': 0.9, 'seed': 117, 'subdiv': 0, 'jitter': 0.12},
        ],
        'far': [
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.30], [0.0, 7.2, 0.0, 0.12]]},
            {'op': 'blob', **ela_leaf, 'r': [2.75, 2.9, 2.65], 'p': [0.0, 5.1, 0.0], 'yaw': 0.4, 'seed': 17, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **ela_leaf, 'r': [2.10, 2.7, 2.00], 'p': [0.0, 8.8, 0.0], 'yaw': 1.7, 'seed': 61, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 9. ginkgo — 银杏 (Ginkgo biloba)
    # Upright tapered trunk (D=0.66m at base), acute ascending branches tucked inside
    # 8 irregular organic blobs forming a natural ovoid-conical golden-yellow autumn crown.
    # -------------------------------------------------------------------------
    gin_leaf = leaf('ginkgo')
    gin_wood = wood('ginkgoTrunk')
    ginkgo = {
        'id': 9, 'name': 'ginkgo', 'zh': '银杏', 'latin': 'Ginkgo biloba',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.94, 1.08, 0.94], 'lean': -0.02, 'tint': [1.08, 1.01, 0.86]},
            {'scale': [1.06, 0.95, 1.05], 'lean': 0.02, 'tint': [0.89, 1.03, 0.94]},
        ],
        'near': [
            {'op': 'tube', **gin_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.37], [0.0, 0.0, 0.0, 0.33], [0.02, 2.5, 0.0, 0.24],
                [0.03, 6.5, 0.0, 0.14], [0.02, 10.0, 0.0, 0.06],
            ]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.6, 0.0, 0.16], [1.05, 4.4, 0.48, 0.10], [1.75, 5.8, 0.80, 0.06]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.7, 0.0, 0.16], [-1.00, 4.5, 0.55, 0.10], [-1.65, 5.9, 0.90, 0.06]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.8, 0.0, 0.15], [0.22, 4.7, -1.10, 0.10], [0.38, 6.1, -1.75, 0.06]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.03, 4.8, 0.0, 0.12], [-0.78, 6.7, -0.78, 0.08], [-1.25, 8.1, -1.20, 0.05]]},
            {'op': 'blob', **gin_leaf, 'r': [2.05, 1.60, 1.95], 'p': [1.55, 5.5, 0.70], 'yaw': 0.4, 'seed': 14, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **gin_leaf, 'r': [2.00, 1.60, 1.95], 'p': [-1.45, 5.6, 0.80], 'yaw': 1.5, 'seed': 28, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **gin_leaf, 'r': [1.95, 1.55, 2.00], 'p': [0.35, 5.7, -1.55], 'yaw': 2.4, 'seed': 42, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **gin_leaf, 'r': [1.85, 1.50, 1.80], 'p': [-0.95, 5.9, -1.05], 'yaw': 0.9, 'seed': 56, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **gin_leaf, 'r': [2.35, 1.95, 2.25], 'p': [0.15, 7.4, 0.15], 'yaw': 1.2, 'seed': 70, 'subdiv': 1, 'jitter': 0.15},
            {'op': 'blob', **gin_leaf, 'r': [1.95, 1.70, 1.90], 'p': [-0.85, 8.2, -0.75], 'yaw': 2.1, 'seed': 84, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **gin_leaf, 'r': [1.85, 1.65, 1.80], 'p': [0.65, 8.9, -0.25], 'yaw': 0.3, 'seed': 98, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **gin_leaf, 'r': [1.45, 1.75, 1.40], 'p': [0.02, 10.5, 0.0], 'yaw': 1.7, 'seed': 112, 'subdiv': 1, 'jitter': 0.14},
        ],
        'mid': [
            {'op': 'tube', **gin_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.33], [0.02, 8.0, 0.0, 0.11]]},
            {'op': 'blob', **gin_leaf, 'r': [3.0, 2.2, 2.9], 'p': [0.05, 5.8, 0.0], 'yaw': 0.5, 'seed': 14, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **gin_leaf, 'r': [2.4, 2.1, 2.3], 'p': [-0.1, 8.2, 0.0], 'yaw': 1.8, 'seed': 70, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **gin_leaf, 'r': [1.5, 1.8, 1.45], 'p': [0.0, 10.4, 0.0], 'yaw': 0.8, 'seed': 112, 'subdiv': 0, 'jitter': 0.13},
        ],
        'far': [
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.32], [0.02, 7.6, 0.0, 0.12]]},
            {'op': 'blob', **gin_leaf, 'r': [3.1, 2.5, 3.0], 'p': [0.0, 6.0, 0.0], 'yaw': 0.5, 'seed': 14, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'blob', **gin_leaf, 'r': [2.1, 2.5, 2.0], 'p': [0.0, 9.4, 0.0], 'yaw': 1.8, 'seed': 70, 'subdiv': 0, 'jitter': 0.13},
        ],
    }

    # -------------------------------------------------------------------------
    # 10. willow — 垂柳 (Salix babylonica)
    # NO flat umbrella disc, NO wide jellyfish blades!
    # Leaning dark trunk (D=0.58m), arched fountain limbs, small rounded upper crown domes,
    # and 28 slender pendulous willow strands cascading in a fountain arc down to y=1.2-1.9m
    # above ground/water; fresh yellow-green foliage.
    # -------------------------------------------------------------------------
    wil_leaf = leaf('willow')
    wil_wood = wood('willowTrunk')
    willow = {
        'id': 10, 'name': 'willow', 'zh': '垂柳', 'latin': 'Salix babylonica',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.09, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.07, 0.95, 1.06], 'lean': 0.12, 'tint': [1.04, 1.02, 0.93]},
            {'scale': [0.95, 1.06, 0.95], 'lean': 0.06, 'tint': [0.96, 1.01, 0.96]},
        ],
        'near': [
            {'op': 'tube', **wil_wood, 'sides': 7, 'pts': [
                [0.0, -1.5, 0.0, 0.34], [0.0, 0.0, 0.0, 0.29], [0.18, 1.5, 0.05, 0.23], [0.34, 2.8, 0.08, 0.18],
            ]},
            # 5 arched fountain limbs rising to y=5.8-6.6m inside the small rounded upper crown
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.30, 2.5, 0.07, 0.14], [1.15, 4.7, 0.38, 0.09], [1.85, 6.0, 0.62, 0.05]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.30, 2.5, 0.07, 0.14], [-0.80, 4.8, 0.72, 0.09], [-1.45, 6.1, 1.25, 0.05]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.32, 2.6, 0.08, 0.13], [0.48, 4.9, -1.05, 0.085], [0.82, 6.2, -1.75, 0.05]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.32, 2.6, 0.08, 0.13], [-0.72, 4.9, -0.82, 0.085], [-1.30, 6.2, -1.40, 0.05]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.34, 2.7, 0.08, 0.12], [0.35, 5.4, 0.10, 0.08], [0.30, 7.1, 0.08, 0.045]]},
            # Small rounded upper crown (5 compact arched blobs, NOT a flat disc!)
            {'op': 'blob', **wil_leaf, 'r': [1.95, 1.55, 1.85], 'p': [0.30, 7.3, 0.08], 'yaw': 0.4, 'seed': 25, 'subdiv': 1, 'jitter': 0.14},
            {'op': 'blob', **wil_leaf, 'r': [1.65, 1.35, 1.60], 'p': [1.55, 6.4, 0.50], 'yaw': 1.3, 'seed': 39, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **wil_leaf, 'r': [1.65, 1.35, 1.60], 'p': [-1.20, 6.5, 1.00], 'yaw': 2.2, 'seed': 53, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **wil_leaf, 'r': [1.60, 1.35, 1.65], 'p': [0.65, 6.5, -1.45], 'yaw': 0.8, 'seed': 67, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'blob', **wil_leaf, 'r': [1.55, 1.30, 1.55], 'p': [-1.05, 6.5, -1.15], 'yaw': 1.9, 'seed': 81, 'subdiv': 0, 'jitter': 0.14},
            # 28 slender fountain-arched willow strands cascading to 1.25-1.95m above ground/water!
            {'op': 'strands', **wil_leaf, 'origin': [0.30, 6.8, 0.08], 'count': 16, 'innerR': 1.25, 'outerR': 3.85, 'topY': 6.9, 'arch': 0.85, 'botY': 1.42, 'width': 0.21, 'segs': 5, 'phase': 0.0},
            {'op': 'strands', **wil_leaf, 'origin': [0.30, 7.4, 0.08], 'count': 12, 'innerR': 0.65, 'outerR': 2.85, 'topY': 7.5, 'arch': 0.75, 'botY': 1.78, 'width': 0.19, 'segs': 4, 'phase': 0.26},
        ],
        'mid': [
            {'op': 'tube', **wil_wood, 'sides': 5, 'pts': [[0.0, -1.5, 0.0, 0.29], [0.32, 6.2, 0.08, 0.11]]},
            {'op': 'blob', **wil_leaf, 'r': [2.45, 1.85, 2.35], 'p': [0.30, 6.9, 0.08], 'yaw': 0.5, 'seed': 25, 'subdiv': 0, 'jitter': 0.14},
            {'op': 'strands', **wil_leaf, 'origin': [0.30, 6.8, 0.08], 'count': 14, 'innerR': 1.15, 'outerR': 3.75, 'topY': 6.9, 'arch': 0.80, 'botY': 1.48, 'width': 0.26, 'segs': 3, 'phase': 0.0},
        ],
        'far': [
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.0, -1.2, 0.0, 0.28], [0.30, 6.0, 0.08, 0.12]]},
            {'op': 'blob', **wil_leaf, 'r': [2.6, 2.0, 2.5], 'p': [0.30, 6.8, 0.08], 'yaw': 0.5, 'seed': 25, 'subdiv': 0, 'jitter': 0.13},
            {'op': 'strands', **wil_leaf, 'origin': [0.30, 6.7, 0.08], 'count': 10, 'innerR': 1.15, 'outerR': 3.70, 'topY': 6.8, 'arch': 0.75, 'botY': 1.55, 'width': 0.32, 'segs': 2, 'phase': 0.0},
        ],
    }

    return [camphor, banyan, osmanthus, palm, conifer, shrub, virens, bischofia, elaeocarpus, ginkgo, willow]


# =============================================================================
# Deterministic Geometry Evaluators (mirrored 1:1 in web/src/look/trees.ts)
# =============================================================================

_PHI = (1.0 + math.sqrt(5.0)) / 2.0
_ICO_RAW = [
    (-1, _PHI, 0), (1, _PHI, 0), (-1, -_PHI, 0), (1, -_PHI, 0),
    (0, -1, _PHI), (0, 1, _PHI), (0, -1, -_PHI), (0, 1, -_PHI),
    (_PHI, 0, -1), (_PHI, 0, 1), (-_PHI, 0, -1), (-_PHI, 0, 1),
]
_ICO_VERTS = [tuple(c / math.hypot(*v) for c in v) for v in _ICO_RAW]
_ICO_FACES = [
    (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
    (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
    (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
    (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
]


def _subdivide_ico(verts: list[tuple[float, float, float]], faces: list[tuple[int, int, int]]) -> tuple[list, list]:
    v_out = list(verts)
    mid_cache: dict[tuple[int, int], int] = {}

    def mid(i: int, j: int) -> int:
        key = (i, j) if i < j else (j, i)
        if key in mid_cache:
            return mid_cache[key]
        ax, ay, az = v_out[i]
        bx, by, bz = v_out[j]
        mx, my, mz = (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5
        ln = math.hypot(mx, my, mz)
        idx = len(v_out)
        v_out.append((mx / ln, my / ln, mz / ln))
        mid_cache[key] = idx
        return idx

    f_out = []
    for a, b, c in faces:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        f_out.extend([(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)])
    return v_out, f_out


_ICO_1_VERTS, _ICO_1_FACES = _subdivide_ico(_ICO_VERTS, _ICO_FACES)


def _eval_blob(rx: float, ry: float, rz: float, px: float, py: float, pz: float,
               yaw: float, seed: int, subdiv: int, jitter: float) -> list[tuple]:
    verts = _ICO_1_VERTS if subdiv >= 1 else _ICO_VERTS
    faces = _ICO_1_FACES if subdiv >= 1 else _ICO_FACES
    cy, sy = math.cos(yaw), math.sin(yaw)
    pts = []
    for ux, uy, uz in verts:
        d1 = math.sin(seed * 1.73 + ux * 3.17 + uy * 2.63 + uz * 3.53)
        d2 = math.cos(seed * 2.91 - ux * 4.31 + uy * 3.79 - uz * 2.87)
        disp = 1.0 + jitter * (0.62 * d1 + 0.38 * d2)
        lx, ly, lz = ux * rx * disp, uy * ry * disp, uz * rz * disp
        wx = lx * cy + lz * sy + px
        wz = -lx * sy + lz * cy + pz
        pts.append((wx, ly + py, wz))
    return [(pts[a], pts[b], pts[c]) for a, b, c in faces]


def _eval_tube(pts: list[list[float]], sides: int) -> list[tuple]:
    rings = []
    n = len(pts)
    for i, (cx, cy, cz, r) in enumerate(pts):
        p0 = pts[max(0, i - 1)]
        p1 = pts[min(n - 1, i + 1)]
        tx, ty, tz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        tl = math.hypot(tx, ty, tz) or 1.0
        tx, ty, tz = tx / tl, ty / tl, tz / tl
        up = (1.0, 0.0, 0.0) if abs(ty) > 0.92 else (0.0, 1.0, 0.0)
        ux = ty * up[2] - tz * up[1]
        uy = tz * up[0] - tx * up[2]
        uz = tx * up[1] - ty * up[0]
        ul = math.hypot(ux, uy, uz) or 1.0
        ux, uy, uz = ux / ul, uy / ul, uz / ul
        vx = ty * uz - tz * uy
        vy = tz * ux - tx * uz
        vz = tx * uy - ty * ux
        ring = []
        for s in range(sides):
            ang = s / sides * math.tau
            ca, sa = math.cos(ang), math.sin(ang)
            ring.append((cx + r * (ca * ux + sa * vx), cy + r * (ca * uy + sa * vy), cz + r * (ca * uz + sa * vz)))
        rings.append(ring)
    tris = []
    for i in range(n - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(sides):
            sn = (s + 1) % sides
            # Outward-facing winding (r0[s] -> r0[sn] -> r1[sn])
            tris.append((r0[s], r0[sn], r1[sn]))
            tris.append((r0[s], r1[sn], r1[s]))
    return tris


def _eval_bundles(clusters: list[dict]) -> list[tuple]:
    tris = []
    for ci, cl in enumerate(clusters):
        ox, oy, oz = cl['p']
        sp = float(cl['spread'])
        r = float(cl['r'])
        lengths = cl['lengths']
        m = len(lengths)
        for k, ln in enumerate(lengths):
            ang = k / m * math.tau + ci * 0.7
            dx, dz = math.cos(ang) * sp, math.sin(ang) * sp
            sway_x = math.sin(ci * 1.9 + k * 2.3) * 0.10
            sway_z = math.cos(ci * 1.5 + k * 2.7) * 0.10
            pts = [
                [ox + dx * 0.45, oy + 0.15, oz + dz * 0.45, r],
                [ox + dx + sway_x * 0.5, oy - ln * 0.52, oz + dz + sway_z * 0.5, r * 0.68],
                [ox + dx * 1.15 + sway_x, oy - ln, oz + dz * 1.15 + sway_z, r * 0.28],
            ]
            tris.extend(_eval_tube(pts, 3))
    return tris


def _eval_whorl(y: float, r: float, thick: float, lift: float, lobes: int, yaw: float, seed: int) -> list[tuple]:
    tris = []
    for i in range(lobes):
        ang = yaw + i / lobes * math.tau + math.sin(seed + i * 1.7) * 0.08
        cs, sn = math.cos(ang), math.sin(ang)
        rl = r * (0.90 + 0.16 * math.sin(seed * 1.3 + i * 2.5))
        w = rl * 0.44
        # Feathery horizontal-upturned bough pad: inner base at trunk -> wide mid-fan -> upturned feathery tip
        p_base_top = (cs * 0.12, y + thick * 0.52, sn * 0.12)
        p_base_bot = (cs * 0.12, y - thick * 0.28, sn * 0.12)
        p_mid_l = (cs * rl * 0.56 - sn * w, y + lift * 0.35, sn * rl * 0.56 + cs * w)
        p_mid_r = (cs * rl * 0.56 + sn * w, y + lift * 0.35, sn * rl * 0.56 - cs * w)
        p_mid_top = (cs * rl * 0.52, y + thick * 0.42 + lift * 0.35, sn * rl * 0.52)
        p_tip = (cs * rl, y + lift, sn * rl)
        # Upper sunlit facets (outward +Y normals)
        tris.append((p_base_top, p_mid_r, p_mid_top))
        tris.append((p_base_top, p_mid_top, p_mid_l))
        tris.append((p_mid_top, p_mid_r, p_tip))
        tris.append((p_mid_top, p_tip, p_mid_l))
        # Lower shaded facets (outward -Y normals)
        tris.append((p_base_bot, p_mid_l, p_tip))
        tris.append((p_base_bot, p_tip, p_mid_r))
    return tris


def _eval_fronds(origin: list[float], count: int, length: float, width: float,
                 rise: float, droop: float, segs: int, phase: float = 0.0) -> list[tuple]:
    ox, oy, oz = origin
    tris = []
    for i in range(count):
        yaw = phase + i / count * math.tau + (i % 2) * 0.10
        cs, sn = math.cos(yaw), math.sin(yaw)
        v_scale = 0.94 + (i % 3) * 0.05
        L = length * v_scale
        stations = []
        for s in range(segs + 1):
            u = s / segs
            # Smooth rounded palm arch with pronounced downward-hanging leaflet tip (u > 0.65)
            rr = L * (0.88 * math.sin(u * math.pi * 0.58) + 0.12 * u)
            yy = oy + math.sin(u * math.pi * 0.52) * rise - (u ** 2.15) * droop
            # Rounded broad fan silhouette (full across u=0.2..0.8, tapering softly at tip)
            ww = width * math.sin(min(1.0, u * 1.15) * math.pi * 0.88) * (1.0 - 0.25 * u * u) + 0.04
            fold = 0.14 * ww
            stations.append((rr, yy, ww, fold))

        def wp(rr: float, yy: float, lat: float) -> tuple[float, float, float]:
            return (ox + rr * cs - lat * sn, yy, oz + rr * sn + lat * cs)

        for s in range(segs):
            r0, y0, w0, f0 = stations[s]
            r1, y1, w1, f1 = stations[s + 1]
            l0, m0, rt0 = wp(r0, y0 - f0, -w0), wp(r0, y0 + f0 * 0.5, 0.0), wp(r0, y0 - f0, w0)
            l1, m1, rt1 = wp(r1, y1 - f1, -w1), wp(r1, y1 + f1 * 0.5, 0.0), wp(r1, y1 - f1, w1)
            tris.append((l0, m0, m1))
            tris.append((l0, m1, l1))
            tris.append((m0, rt0, rt1))
            tris.append((m0, rt1, m1))
    return tris


def _eval_strands(origin: list[float], count: int, inner_r: float, outer_r: float,
                  top_y: float, arch: float, bot_y: float, width: float, segs: int, phase: float = 0.0) -> list[tuple]:
    ox, _, oz = origin
    tris = []
    for i in range(count):
        yaw = phase + i / count * math.tau + math.sin(i * 2.1) * 0.08
        cs, sn = math.cos(yaw), math.sin(yaw)
        # Varied natural drop height (1.2m - 2.0m above ground/water)
        drop = bot_y + (i % 4) * 0.22
        r_end = outer_r * (0.88 + (i % 3) * 0.08)
        twist = 0.55 if (i % 2 == 0) else -0.55
        ct, st_ang = math.cos(twist), math.sin(twist)
        pts = []
        for s in range(segs + 1):
            u = s / segs
            # Fountain trajectory: rises out in a graceful arch, then hangs vertically to `drop` (1.2-2.0m)
            rr = inner_r + (r_end - inner_r) * (1.0 - (1.0 - u) ** 1.7)
            yy = top_y * (1.0 - u ** 1.45) + drop * (u ** 1.45) + math.sin(u * math.pi) * arch * (1.0 - u * 0.65)
            ww = width * (0.45 + 0.65 * math.sin(u * math.pi * 0.75)) * (1.0 - 0.72 * u) + 0.015
            pts.append((rr, yy, ww))

        def wp(rr: float, yy: float, off: float) -> tuple[float, float, float]:
            # Slight twist off-tangent so slender strands stay visible from side & top views
            rx_d = off * st_ang * 0.35
            tz_d = off * ct
            return (ox + (rr + rx_d) * cs - tz_d * sn, yy, oz + (rr + rx_d) * sn + tz_d * cs)

        for s in range(segs):
            r0, y0, w0 = pts[s]
            r1, y1, w1 = pts[s + 1]
            a0, b0 = wp(r0, y0, -w0), wp(r0, y0, w0)
            a1, b1 = wp(r1, y1, -w1), wp(r1, y1, w1)
            tris.append((a0, b0, b1))
            tris.append((a0, b1, a1))
    return tris


def _eval_part_tris(part: dict) -> tuple[list[tuple], bool]:
    op = part['op']
    if op == 'tube':
        return _eval_tube(part['pts'], part['sides']), True
    if op == 'bundles':
        return _eval_bundles(part['clusters']), True
    if op == 'blob':
        rx, ry, rz = part['r']
        px, py, pz = part['p']
        return _eval_blob(rx, ry, rz, px, py, pz, part['yaw'], part['seed'], part['subdiv'], part.get('jitter', 0.15)), False
    if op == 'whorl':
        return _eval_whorl(part['y'], part['r'], part['thick'], part['lift'], part['lobes'], part['yaw'], part['seed']), False
    if op == 'fronds':
        return _eval_fronds(part['origin'], part['count'], part['length'], part['width'], part['rise'], part['droop'], part['segs'], part.get('phase', 0.0)), False
    if op == 'strands':
        return _eval_strands(part['origin'], part['count'], part['innerR'], part['outerR'], part['topY'], part['arch'], part['botY'], part['width'], part['segs'], part.get('phase', 0.0)), False
    raise ValueError(f'Unknown op: {op}')


def _lerp_color(c0: tuple[float, float, float], c1: tuple[float, float, float], t: float) -> tuple[float, float, float]:
    u = max(0.0, min(1.0, t))
    return (c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u)


def _tri_normal(a: tuple, b: tuple, c: tuple) -> tuple[float, float, float]:
    abx, aby, abz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    acx, acy, acz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx = aby * acz - abz * acy
    ny = abz * acx - abx * acz
    nz = abx * acy - aby * acx
    ln = math.hypot(nx, ny, nz) or 1.0
    return (nx / ln, ny / ln, nz / ln)


def build_lod_arrays(spec: dict, lod: str = 'near', variant_idx: int | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    evaluated = []
    crown_ys = []
    for part in spec[lod]:
        tris, is_wood = _eval_part_tris(part)
        evaluated.append((part, tris, is_wood))
        if not is_wood:
            for a, b, c in tris:
                crown_ys.extend((a[1], b[1], c[1]))
    c_ymin = min(crown_ys) if crown_ys else 0.0
    c_yspan = max(0.5, (max(crown_ys) - c_ymin)) if crown_ys else 1.0

    all_pos, all_col = [], []
    for part, tris, is_wood in evaluated:
        if not tris:
            continue
        lo, mid, hi = hex_rgb(part['dark']), hex_rgb(part['c']), hex_rgb(part['lit'])
        if is_wood:
            ys = [(a[1] + b[1] + c[1]) / 3.0 for a, b, c in tris]
            w_min, w_span = min(ys), max(0.2, max(ys) - min(ys))
            for (a, b, c), ym in zip(tris, ys):
                nx, ny, nz = _tri_normal(a, b, c)
                sun = max(0.0, min(1.0, (-0.45 * nx + 0.35 * ny + 0.55 * nz) * 0.5 + 0.5))
                t = 0.45 * ((ym - w_min) / w_span) + 0.55 * sun
                rgb = _lerp_color(lo, mid, t * 2.0) if t < 0.5 else _lerp_color(mid, hi, (t - 0.5) * 2.0)
                all_pos.extend((a, b, c))
                all_col.extend((rgb, rgb, rgb))
        else:
            # Global crown height + outward normal Y shading: crown underside is 1 stop darker than top,
            # and overlapping blobs blend seamlessly into one continuous organic volume!
            for a, b, c in tris:
                ym = (a[1] + b[1] + c[1]) / 3.0
                _, ny, _ = _tri_normal(a, b, c)
                h_t = max(0.0, min(1.0, (ym - c_ymin) / c_yspan))
                n_t = ny * 0.5 + 0.5
                t = max(0.0, min(1.0, 0.58 * h_t + 0.42 * n_t))
                rgb = _lerp_color(lo, mid, t * 2.0) if t < 0.5 else _lerp_color(mid, hi, (t - 0.5) * 2.0)
                all_pos.extend((a, b, c))
                all_col.extend((rgb, rgb, rgb))

    pos = np.asarray(all_pos, dtype=np.float32)
    col = np.asarray(all_col, dtype=np.float32)
    if variant_idx is not None:
        var = spec['variants'][variant_idx % len(spec['variants'])]
        sx, sy, sz = var['scale']
        pos[:, 0] *= sx
        pos[:, 1] *= sy
        pos[:, 2] *= sz
        lean = float(var['lean'])
        if abs(lean) > 1e-4:
            cl, sl = math.cos(lean), math.sin(lean)
            above = pos[:, 1] > 0.0
            x_new = pos[above, 0] * cl + pos[above, 1] * sl
            y_new = -pos[above, 0] * sl + pos[above, 1] * cl
            pos[above, 0], pos[above, 1] = x_new, y_new
        col = np.clip(col * np.asarray(var['tint'], dtype=np.float32), 0.0, 1.0)

    v0, v1, v2 = pos[0::3], pos[1::3], pos[2::3]
    fn = np.cross(v1 - v0, v2 - v0)
    fl = np.linalg.norm(fn, axis=1, keepdims=True)
    fn = fn / np.maximum(fl, 1e-9)
    nrm = np.repeat(fn, 3, axis=0).astype(np.float32)
    return pos, nrm, col


_SPEC_BY_NAME: dict[str, dict] | None = None


def emit_landmark_tree(
    model,
    species_name: str,
    x: float,
    y: float,
    z: float,
    scale: float = 1.0,
    y_scale: float | None = None,
    yaw: float = 0.0,
    variant_idx: int = 0,
    wood_mat: str = 'wood',
    leaf_mat: str = 'leaf',
    pod_mat: str | None = None,
    collide_trunk: bool = True,
    lean_override: float | None = None,
    clip_local_z: tuple[float, float] | None = None,
) -> None:
    """Emit a reusable multi-LOD procedural tree from `trees.py` into a LandmarkModel."""
    global _SPEC_BY_NAME
    if _SPEC_BY_NAME is None:
        _SPEC_BY_NAME = {s['name']: s for s in build_species_specs()}
    spec = _SPEC_BY_NAME[species_name]
    var = spec['variants'][variant_idx % len(spec['variants'])]
    lod_key = 'near' if getattr(model, 'detail', True) else 'mid'
    sx = scale * var['scale'][0]
    sy = (y_scale if y_scale is not None else scale) * var['scale'][1]
    sz = scale * var['scale'][2]
    # Positive lean tilts +X crown across the road in local +X direction before yaw rotation
    lean = float(lean_override) if lean_override is not None else float(var['lean'])
    cl, sl = math.cos(lean), math.sin(lean)
    cy_v, sy_v = math.cos(yaw), math.sin(yaw)

    buckets: dict[str, tuple[list, list]] = {}

    def add_tri(mat_name: str, wtri: list[tuple[float, float, float]], is_wood_tri: bool = False) -> None:
        if clip_local_z is not None:
            z_lo, z_hi = clip_local_z
            # Pull clipped back-side limbs well inside the foliage boundary so zero wood tips protrude
            if is_wood_tri:
                z_lo_w, z_hi_w = z_lo + 1.15, z_hi - 1.15
                if any(pt[2] < z_lo_w or pt[2] > z_hi_w for pt in wtri):
                    wtri = [(pt[0], pt[1], min(z_hi_w, max(z_lo_w, pt[2]))) for pt in wtri]
            elif any(pt[2] < z_lo or pt[2] > z_hi for pt in wtri):
                wtri = [(pt[0], pt[1], min(z_hi, max(z_lo, pt[2]))) for pt in wtri]
        v_list, f_list = buckets.setdefault(mat_name, ([], []))
        base_idx = len(v_list)
        v_list.extend(wtri)
        f_list.append([base_idx, base_idx + 1, base_idx + 2])

    for part in spec[lod_key]:
        # On wall-adjacent street trees (`clip_local_z`), prune back-facing wall-side limbs (`vx < -0.5`) cleanly
        if clip_local_z is not None and part['op'] == 'tube' and part['pts'][0][1] > 1.0 and part['pts'][-1][0] < -0.5:
            continue
        tris, is_wood = _eval_part_tris(part)
        is_pod = (not is_wood) and part.get('c') in (PALETTE['bischofiaPod']['c'], PALETTE['elaeocarpusRed']['c'])
        mat_name = wood_mat if is_wood else (pod_mat if (is_pod and pod_mat) else leaf_mat)
        for tri in tris:
            wtri = []
            for vx, vy, vz in tri:
                # Keep foot of trunk anchored within [-0.18m, 0m] below local datum so grounding audit passes 0 sink/float
                vy_c = max(-0.18, vy * sy)
                vx_c, vz_c = vx * sx, vz * sz
                if vy <= 0.02:
                    lx, ly = vx_c, vy_c
                else:
                    # Lean pivots smoothly from ground base y=0 so root base never lifts off the ground!
                    lx = vx_c * cl + vy_c * sl
                    ly = -vx_c * sl + vy_c * cl
                wx = lx * cy_v + vz_c * sy_v + x
                wz = -lx * sy_v + vz_c * cy_v + z
                wtri.append((wx, ly + y, wz))
            add_tri(mat_name, wtri, is_wood)

    for mat_name, (v_list, f_list) in buckets.items():
        if f_list:
            model.mesh(v_list, f_list, mat_name, collide=False)
    if collide_trunk:
        # Compact foot collider tucked inside the 0.7m trunk base (never protruding visually beside leaning trunks!)
        model.box(x, y - 0.14, z, 0.30 * scale, 0.55 * scale, 0.30 * scale, wood_mat, True)


def write_specs_json(out_path: Path = OUT_JSON) -> list[dict]:
    specs = build_species_specs()
    payload = {'version': 2, 'species': specs}
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return specs


def main() -> None:
    specs = write_specs_json()
    print(f'Wrote {OUT_JSON} ({OUT_JSON.stat().st_size:,} bytes, {len(specs)} species)')
    for s in specs:
        p0, _, _ = build_lod_arrays(s, 'near')
        p1, _, _ = build_lod_arrays(s, 'mid')
        p2, _, _ = build_lod_arrays(s, 'far')
        w = float(max(p0[:, 0].max() - p0[:, 0].min(), p0[:, 2].max() - p0[:, 2].min()))
        h = float(p0[:, 1].max())
        base_mask = np.abs(p0[:, 1]) < 0.35
        bd = float(max(np.ptp(p0[base_mask, 0]), np.ptp(p0[base_mask, 2]))) if np.any(base_mask) else 0.0
        print(f"  [{s['id']:2d}] {s['name']:12s} ({s['zh']:10s})  H={h:5.1f}m  W={w:5.1f}m  baseD={bd:4.2f}m  tris near={len(p0)//3:3d} mid={len(p1)//3:3d} far={len(p2)//3:2d}")


if __name__ == '__main__':
    main()
