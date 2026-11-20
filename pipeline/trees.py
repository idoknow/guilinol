"""Procedural low-poly Guilin tree model generator (IDOK-71).

Generates 10 reusable Guilin street/waterfront tree species (+ mountain shrub at
slot 5 for GL04 compatibility), each with:
  - 3 morphological/colour variants (anisotropic scale, trunk lean, hue/value shift)
  - 3 LOD levels:
      * near (lod0): tapered curved trunk, visible primary branches, layered organic
                     foliage clusters, banyan pillar/curtain aerial roots, palm fronds,
                     metasequoia whorls, weeping willow curtains
      * mid  (lod1): simplified trunk + merged crown tiers
      * far  (lod2): orthogonal crossed silhouette planes + overhead canopy cap

Exports `pipeline/tree-specs.json` (shared with `web/src/look/trees.ts`) and can
optionally export `.glb` assets (`--export-glb <dir>`) for inspection/comparison.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import numpy as np
import trimesh


PALETTE = {
    'trunk': 0x4D4236,
    'banyanTrunk': 0x463B30,
    'osmanthusTrunk': 0x686157,
    'palmTrunk': 0x857C6D,
    'palmCrownshaft': 0x4E7436,
    'coniferTrunk': 0x5A3F32,
    'virensTrunk': 0x5C5349,
    'bischofiaTrunk': 0x473D34,
    'elaeocarpusTrunk': 0x52483E,
    'ginkgoTrunk': 0x665D52,
    'willowTrunk': 0x4F4539,
    'canopyDark': 0x1A3320,
    # Species foliage base / sunlit / deep-shade colours (anchored to docs/reference.md)
    'camphor': (0x3B6832, 0x648C40, 0x1B3520),
    'banyan': (0x2D592B, 0x4D7C3A, 0x17301C),
    'osmanthus': (0x2B5429, 0x487538, 0x18311D),
    'palm': (0x527B35, 0x799B4A, 0x2E4E27),
    'conifer': (0x2D5232, 0x58753B, 0x193221),
    'shrub': (0x375F30, 0x56803C, 0x1A3320),
    'virens': (0x3F6E35, 0x6D9644, 0x1F3B22),
    'bischofia': (0x386430, 0x658C3E, 0x1C3620),
    'bischofiaPod': (0x8B6340, 0xB48353, 0x3D4A28),
    'elaeocarpus': (0x2F5C2E, 0x537D3A, 0x19331E),
    'elaeocarpusRed': (0x823E2D, 0xA8553B, 0x3B2920),
    'ginkgo': (0x9AA838, 0xD4BE46, 0x5C6E28),
    'willow': (0x567D38, 0x82A64D, 0x2D4C24),
}


def hex_rgb(value: int) -> tuple[float, float, float]:
    return (((value >> 16) & 255) / 255.0, ((value >> 8) & 255) / 255.0, (value & 255) / 255.0)


def build_species_specs() -> list[dict]:
    p = PALETTE

    def leaf(key: str) -> dict:
        c, lit, dark = p[key]
        return {'c': c, 'lit': lit, 'dark': dark}

    def wood(key: str, dark_mul: float = 0.72) -> dict:
        base = p[key]
        r, g, b = (base >> 16) & 255, (base >> 8) & 255, base & 255
        dark = (int(r * dark_mul) << 16) | (int(g * dark_mul) << 8) | int(b * dark_mul)
        lit = (min(255, int(r * 1.14)) << 16) | (min(255, int(g * 1.14)) << 8) | min(255, int(b * 1.12))
        return {'c': base, 'lit': lit, 'dark': dark}

    # 0. camphor — 香樟 (Cinnamomum camphora): 11.5–13.5 m, curved fissured trunk, 4 spreading main limbs, layered dome
    camphor_leaf = leaf('camphor')
    camphor_wood = wood('trunk')
    camphor = {
        'id': 0,
        'name': 'camphor',
        'zh': '香樟',
        'latin': 'Cinnamomum camphora',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.03, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.08, 0.95, 1.05], 'lean': -0.04, 'tint': [0.96, 1.02, 0.95]},
            {'scale': [0.94, 1.07, 0.96], 'lean': 0.05, 'tint': [1.04, 1.01, 0.93]},
        ],
        'near': [
            {'op': 'tube', **camphor_wood, 'sides': 7, 'pts': [[0, -1.5, 0, 0.34], [0.02, 0.25, 0, 0.31], [0.10, 1.7, 0.04, 0.24], [0.22, 3.2, 0.06, 0.19], [0.30, 4.8, 0.04, 0.13]]},
            {'op': 'tube', **camphor_wood, 'sides': 5, 'pts': [[0.20, 3.0, 0.05, 0.15], [1.25, 4.3, 0.55, 0.11], [2.45, 5.6, 1.05, 0.07]]},
            {'op': 'tube', **camphor_wood, 'sides': 5, 'pts': [[0.18, 2.9, 0.04, 0.15], [-1.15, 4.2, 0.70, 0.11], [-2.25, 5.5, 1.30, 0.07]]},
            {'op': 'tube', **camphor_wood, 'sides': 5, 'pts': [[0.22, 3.1, 0.02, 0.14], [0.45, 4.5, -1.25, 0.10], [0.95, 5.8, -2.35, 0.06]]},
            {'op': 'tube', **camphor_wood, 'sides': 4, 'pts': [[0.26, 4.0, 0.04, 0.12], [-0.75, 5.6, -0.95, 0.08], [-1.45, 6.9, -1.65, 0.05]]},
            {'op': 'tuft', **camphor_leaf, 'r': [3.3, 1.85, 3.1], 'p': [2.3, 6.3, 1.0], 'yaw': 0.4, 'seed': 11, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **camphor_leaf, 'r': [3.2, 1.80, 3.0], 'p': [-2.1, 6.2, 1.2], 'yaw': 1.3, 'seed': 23, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **camphor_leaf, 'r': [3.1, 1.85, 3.2], 'p': [0.8, 6.5, -2.1], 'yaw': 2.1, 'seed': 37, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **camphor_leaf, 'r': [2.8, 1.75, 2.7], 'p': [-1.4, 7.1, -1.5], 'yaw': 2.9, 'seed': 53, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **camphor_leaf, 'r': [3.8, 2.15, 3.6], 'p': [0.3, 8.4, 0.1], 'yaw': 0.8, 'seed': 71, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **camphor_leaf, 'r': [2.6, 1.65, 2.5], 'p': [0.4, 10.2, -0.2], 'yaw': 1.9, 'seed': 89, 'rings': 3, 'segs': 7},
        ],
        'mid': [
            {'op': 'tube', **camphor_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.30], [0.20, 6.4, 0.04, 0.14]]},
            {'op': 'tuft', **camphor_leaf, 'r': [4.6, 2.4, 4.4], 'p': [0.2, 6.7, 0.0], 'yaw': 0.5, 'seed': 11, 'rings': 2, 'segs': 7},
            {'op': 'tuft', **camphor_leaf, 'r': [3.2, 2.0, 3.1], 'p': [0.3, 9.2, -0.1], 'yaw': 1.7, 'seed': 37, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **camphor_leaf, 'trunkColor': p['trunk'], 'trunkTop': 3.4, 'trunkR': 0.28,
             'profile': [[3.2, 2.2], [5.8, 4.7], [8.6, 4.3], [11.3, 1.4]], 'capY': 7.4, 'capR': 4.4},
        ],
    }

    # 1. banyan — 小叶榕/高山榕 (Ficus microcarpa): fluted braided trunk, wide limbs, pillar & curtain aerial roots
    banyan_leaf = leaf('banyan')
    banyan_wood = wood('banyanTrunk')
    banyan = {
        'id': 1,
        'name': 'banyan',
        'zh': '小叶榕',
        'latin': 'Ficus microcarpa',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.02, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.10, 0.94, 1.08], 'lean': -0.03, 'tint': [0.95, 1.01, 0.96]},
            {'scale': [0.93, 1.05, 0.95], 'lean': 0.03, 'tint': [1.03, 1.02, 0.94]},
        ],
        'near': [
            # Fluted main trunk + braided fused root ribs
            {'op': 'tube', **banyan_wood, 'sides': 8, 'pts': [[0, -1.5, 0, 0.46], [0, 0.35, 0, 0.42], [0.05, 1.8, 0.02, 0.33], [0.08, 3.2, 0, 0.25]]},
            {'op': 'tube', **banyan_wood, 'sides': 4, 'pts': [[0.34, -0.8, 0.14, 0.15], [0.26, 1.2, 0.12, 0.11], [0.18, 2.9, 0.08, 0.09]]},
            {'op': 'tube', **banyan_wood, 'sides': 4, 'pts': [[-0.30, -0.8, -0.18, 0.14], [-0.24, 1.3, -0.14, 0.10], [-0.14, 2.8, -0.08, 0.08]]},
            # 4 wide spreading horizontal-ascending limbs (tips tucked cleanly inside lower crown pads)
            {'op': 'tube', **banyan_wood, 'sides': 5, 'pts': [[0.06, 2.5, 0.02, 0.20], [1.9, 4.1, 0.65, 0.14], [3.45, 5.45, 1.15, 0.08]]},
            {'op': 'tube', **banyan_wood, 'sides': 5, 'pts': [[0.02, 2.4, -0.02, 0.20], [-1.85, 4.0, -0.75, 0.14], [-3.35, 5.35, -1.35, 0.08]]},
            {'op': 'tube', **banyan_wood, 'sides': 5, 'pts': [[0.04, 2.6, 0.04, 0.18], [-0.65, 4.2, 1.9, 0.13], [-1.1, 5.5, 3.25, 0.08]]},
            {'op': 'tube', **banyan_wood, 'sides': 5, 'pts': [[0.05, 2.6, -0.04, 0.18], [0.8, 4.3, -1.85, 0.13], [1.35, 5.6, -3.05, 0.08]]},
            # Grounded pillar prop roots near trunk + hanging aerial root curtains (kept >=2.35 m outside trunk zone)
            {'op': 'tube', **banyan_wood, 'sides': 4, 'pts': [[1.15, -0.8, 0.38, 0.10], [1.18, 1.8, 0.40, 0.07], [1.35, 3.7, 0.46, 0.08]]},
            {'op': 'tube', **banyan_wood, 'sides': 4, 'pts': [[-1.08, -0.8, -0.42, 0.09], [-1.12, 1.7, -0.44, 0.065], [-1.30, 3.6, -0.52, 0.08]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[3.1, 5.0, 1.0, 0.065], [3.15, 3.6, 1.04, 0.04], [3.18, 2.45, 1.06, 0.018]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[-2.9, 4.9, -1.2, 0.065], [-2.95, 3.5, -1.24, 0.04], [-2.98, 2.40, -1.26, 0.018]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[-1.0, 5.1, 3.0, 0.06], [-1.04, 3.7, 3.05, 0.038], [-1.06, 2.50, 3.08, 0.016]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[1.3, 5.2, -2.8, 0.06], [1.34, 3.8, -2.84, 0.038], [1.36, 2.55, -2.86, 0.016]]},
            # Layered wide umbrella canopy pads
            {'op': 'tuft', **banyan_leaf, 'r': [4.2, 1.65, 3.8], 'p': [3.6, 6.0, 1.2], 'yaw': 0.3, 'seed': 17, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **banyan_leaf, 'r': [4.1, 1.65, 3.7], 'p': [-3.4, 5.9, -1.4], 'yaw': 1.5, 'seed': 31, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **banyan_leaf, 'r': [3.8, 1.60, 3.9], 'p': [-1.1, 6.1, 3.3], 'yaw': 2.2, 'seed': 47, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **banyan_leaf, 'r': [3.7, 1.60, 3.7], 'p': [1.4, 6.2, -3.1], 'yaw': 0.9, 'seed': 61, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **banyan_leaf, 'r': [5.2, 1.95, 4.9], 'p': [0.0, 7.5, 0.0], 'yaw': 1.1, 'seed': 79, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **banyan_leaf, 'r': [3.5, 1.55, 3.3], 'p': [0.2, 9.1, -0.1], 'yaw': 2.6, 'seed': 97, 'rings': 3, 'segs': 7},
        ],
        'mid': [
            {'op': 'tube', **banyan_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.42], [0.05, 6.2, 0, 0.20]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[1.15, -0.6, 0.38, 0.09], [1.35, 5.8, 0.45, 0.06]]},
            {'op': 'tube', **banyan_wood, 'sides': 3, 'pts': [[-1.08, -0.6, -0.42, 0.09], [-1.30, 5.7, -0.50, 0.06]]},
            {'op': 'tuft', **banyan_leaf, 'r': [6.8, 2.1, 6.4], 'p': [0.0, 6.4, 0.0], 'yaw': 0.4, 'seed': 17, 'rings': 2, 'segs': 8},
            {'op': 'tuft', **banyan_leaf, 'r': [4.2, 1.7, 4.0], 'p': [0.1, 8.4, 0.0], 'yaw': 1.8, 'seed': 79, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **banyan_leaf, 'trunkColor': p['banyanTrunk'], 'trunkTop': 2.8, 'trunkR': 0.45,
             'profile': [[2.6, 3.2], [5.4, 7.0], [7.8, 6.2], [9.8, 2.2]], 'capY': 6.8, 'capR': 6.6},
        ],
    }

    # 2. osmanthus — 桂花 (Osmanthus fragrans, 市树): 5.5–6.8 m, low V-forked grey-brown stems, compact ovoid-round crown
    osm_leaf = leaf('osmanthus')
    osm_wood = wood('osmanthusTrunk')
    osmanthus = {
        'id': 2,
        'name': 'osmanthus',
        'zh': '桂花',
        'latin': 'Osmanthus fragrans',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.06, 0.94, 1.04], 'lean': -0.02, 'tint': [1.04, 1.02, 0.92]},
            {'scale': [0.94, 1.08, 0.95], 'lean': 0.02, 'tint': [0.96, 1.00, 0.97]},
        ],
        'near': [
            {'op': 'tube', **osm_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.19], [0, 0.2, 0, 0.17], [0.02, 1.65, 0, 0.13]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.01, 1.5, 0.0, 0.10], [0.58, 2.55, 0.32, 0.065], [0.95, 3.35, 0.52, 0.04]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.01, 1.5, 0.0, 0.10], [-0.55, 2.50, 0.36, 0.065], [-0.90, 3.30, 0.58, 0.04]]},
            {'op': 'tube', **osm_wood, 'sides': 4, 'pts': [[0.02, 1.55, 0.0, 0.10], [0.06, 2.60, -0.62, 0.065], [0.12, 3.40, -1.00, 0.04]]},
            {'op': 'tuft', **osm_leaf, 'r': [1.75, 1.35, 1.65], 'p': [0.85, 3.6, 0.45], 'yaw': 0.5, 'seed': 13, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **osm_leaf, 'r': [1.70, 1.35, 1.65], 'p': [-0.80, 3.55, 0.50], 'yaw': 1.6, 'seed': 29, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **osm_leaf, 'r': [1.70, 1.35, 1.75], 'p': [0.10, 3.65, -0.85], 'yaw': 2.5, 'seed': 43, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **osm_leaf, 'r': [2.05, 1.65, 1.95], 'p': [0.02, 4.65, 0.02], 'yaw': 1.1, 'seed': 59, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **osm_leaf, 'r': [1.35, 1.15, 1.30], 'p': [0.05, 5.75, -0.04], 'yaw': 2.1, 'seed': 73, 'rings': 3, 'segs': 6},
        ],
        'mid': [
            {'op': 'tube', **osm_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.17], [0.02, 4.0, 0, 0.09]]},
            {'op': 'tuft', **osm_leaf, 'r': [2.35, 2.15, 2.25], 'p': [0.0, 4.2, 0.0], 'yaw': 0.7, 'seed': 13, 'rings': 2, 'segs': 7},
        ],
        'far': [
            {'op': 'cross', **osm_leaf, 'trunkColor': p['osmanthusTrunk'], 'trunkTop': 1.8, 'trunkR': 0.16,
             'profile': [[1.7, 1.1], [3.5, 2.35], [5.1, 2.05], [6.3, 0.75]], 'capY': 4.3, 'capR': 2.2},
        ],
    }

    # 3. palm — 蒲葵/大王椰 (Livistona chinensis / Roystonea regia): ringed trunk, green crownshaft, 10 arched fronds
    palm_leaf = leaf('palm')
    palm_wood = wood('palmTrunk', 0.78)
    palm_shaft = {'c': p['palmCrownshaft'], 'lit': 0x6B9146, 'dark': 0x325024}
    palm = {
        'id': 3,
        'name': 'palm',
        'zh': '蒲葵/大王椰',
        'latin': 'Livistona chinensis / Roystonea regia',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.03, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.95, 1.12, 0.95], 'lean': -0.04, 'tint': [0.97, 1.03, 0.95]},
            {'scale': [1.06, 0.90, 1.06], 'lean': 0.05, 'tint': [1.03, 0.99, 0.93]},
        ],
        'near': [
            {'op': 'tube', **palm_wood, 'sides': 7, 'pts': [[0, -1.5, 0, 0.34], [0, 0.4, 0, 0.31], [0.04, 3.8, 0.02, 0.29], [0.08, 7.2, 0.03, 0.23], [0.10, 8.8, 0.03, 0.20]]},
            {'op': 'tube', **palm_shaft, 'sides': 6, 'pts': [[0.10, 8.75, 0.03, 0.22], [0.11, 9.85, 0.03, 0.18], [0.11, 10.2, 0.03, 0.12]]},
            {'op': 'fronds', **palm_leaf, 'origin': [0.11, 10.0, 0.03], 'count': 10, 'length': 3.35, 'width': 0.72, 'rise': 1.15, 'droop': 2.15, 'segs': 4},
        ],
        'mid': [
            {'op': 'tube', **palm_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.31], [0.10, 9.6, 0.03, 0.19]]},
            {'op': 'fronds', **palm_leaf, 'origin': [0.10, 9.8, 0.03], 'count': 6, 'length': 3.2, 'width': 0.80, 'rise': 1.0, 'droop': 2.0, 'segs': 2},
        ],
        'far': [
            {'op': 'cross', **palm_leaf, 'trunkColor': p['palmTrunk'], 'trunkTop': 8.6, 'trunkR': 0.24,
             'profile': [[8.2, 0.45], [9.4, 2.9], [10.6, 2.6], [11.5, 0.9]], 'capY': 9.8, 'capR': 2.7},
        ],
    }

    # 4. conifer — 水杉 (Metasequoia glyptostroboides): fluted buttress base, straight spire trunk, 5 scalloped whorled tiers
    con_leaf = leaf('conifer')
    con_wood = wood('coniferTrunk')
    conifer = {
        'id': 4,
        'name': 'conifer',
        'zh': '水杉',
        'latin': 'Metasequoia glyptostroboides',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.94, 1.09, 0.94], 'lean': -0.01, 'tint': [1.08, 0.99, 0.90]},
            {'scale': [1.06, 0.95, 1.06], 'lean': 0.01, 'tint': [1.18, 0.96, 0.84]},
        ],
        'near': [
            {'op': 'tube', **con_wood, 'sides': 7, 'pts': [[0, -1.5, 0, 0.40], [0, 0.5, 0, 0.34], [0, 3.0, 0, 0.23], [0, 8.5, 0, 0.14], [0, 13.8, 0, 0.05]]},
            {'op': 'tier', **con_leaf, 'y0': 2.8, 'y1': 6.4, 'r0': 2.55, 'r1': 0.65, 'segs': 8, 'yaw': 0.0, 'scallop': 0.16},
            {'op': 'tier', **con_leaf, 'y0': 5.2, 'y1': 8.8, 'r0': 2.15, 'r1': 0.55, 'segs': 8, 'yaw': 0.39, 'scallop': 0.16},
            {'op': 'tier', **con_leaf, 'y0': 7.6, 'y1': 11.1, 'r0': 1.72, 'r1': 0.42, 'segs': 7, 'yaw': 0.78, 'scallop': 0.15},
            {'op': 'tier', **con_leaf, 'y0': 9.9, 'y1': 13.2, 'r0': 1.25, 'r1': 0.26, 'segs': 7, 'yaw': 1.17, 'scallop': 0.14},
            {'op': 'tier', **con_leaf, 'y0': 12.1, 'y1': 15.2, 'r0': 0.78, 'r1': 0.04, 'segs': 6, 'yaw': 1.55, 'scallop': 0.12},
        ],
        'mid': [
            {'op': 'tube', **con_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.34], [0, 5.0, 0, 0.18]]},
            {'op': 'tier', **con_leaf, 'y0': 2.8, 'y1': 9.6, 'r0': 2.45, 'r1': 0.75, 'segs': 7, 'yaw': 0.0, 'scallop': 0.12},
            {'op': 'tier', **con_leaf, 'y0': 8.2, 'y1': 15.1, 'r0': 1.55, 'r1': 0.05, 'segs': 6, 'yaw': 0.5, 'scallop': 0.10},
        ],
        'far': [
            {'op': 'cross', **con_leaf, 'trunkColor': p['coniferTrunk'], 'trunkTop': 2.8, 'trunkR': 0.24,
             'profile': [[2.8, 2.45], [6.8, 1.95], [11.2, 1.15], [15.1, 0.12]], 'capY': 5.2, 'capR': 2.1},
        ],
    }

    # 5. shrub — 山石灌丛 (Karst scrub & park undergrowth, slot 5 preserved)
    shrub_leaf = leaf('shrub')
    shrub = {
        'id': 5,
        'name': 'shrub',
        'zh': '山石灌丛',
        'latin': 'Karst broadleaf scrub',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.0, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.10, 0.90, 1.06], 'lean': 0.0, 'tint': [0.96, 1.02, 0.95]},
            {'scale': [0.92, 1.08, 0.94], 'lean': 0.0, 'tint': [1.04, 1.00, 0.94]},
        ],
        'near': [
            {'op': 'tuft', **shrub_leaf, 'r': [1.55, 1.05, 1.45], 'p': [-0.2, 0.75, 0.0], 'yaw': 0.3, 'seed': 19, 'rings': 2, 'segs': 7},
            {'op': 'tuft', **shrub_leaf, 'r': [1.15, 0.88, 1.10], 'p': [1.05, 0.58, 0.45], 'yaw': 1.4, 'seed': 41, 'rings': 2, 'segs': 6},
            {'op': 'tuft', **shrub_leaf, 'r': [0.95, 0.78, 0.95], 'p': [-0.85, 0.52, -0.65], 'yaw': 2.3, 'seed': 67, 'rings': 2, 'segs': 6},
        ],
        'mid': [
            {'op': 'tuft', **shrub_leaf, 'r': [1.75, 1.05, 1.65], 'p': [0.15, 0.68, 0.05], 'yaw': 0.5, 'seed': 19, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **shrub_leaf, 'trunkColor': p['trunk'], 'trunkTop': 0.05, 'trunkR': 0.15,
             'profile': [[0.0, 1.55], [0.85, 1.75], [1.65, 0.75]], 'capY': 0.75, 'capR': 1.6},
        ],
    }

    # 6. virens — 黄葛榕/大叶榕 (Ficus virens): buttressed light-grey trunk, tall V-limbs, bright lush umbrella dome
    vir_leaf = leaf('virens')
    vir_wood = wood('virensTrunk')
    virens = {
        'id': 6,
        'name': 'virens',
        'zh': '黄葛榕（大叶榕）',
        'latin': 'Ficus virens',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.02, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.08, 0.96, 1.06], 'lean': -0.02, 'tint': [1.05, 1.03, 0.92]},
            {'scale': [0.94, 1.06, 0.95], 'lean': 0.03, 'tint': [0.95, 1.01, 0.96]},
        ],
        'near': [
            # Buttressed pale grey-brown trunk (no hanging curtain aerial roots, unlike F. microcarpa)
            {'op': 'tube', **vir_wood, 'sides': 8, 'pts': [[0, -1.5, 0, 0.50], [0, 0.35, 0, 0.44], [0.03, 1.8, 0, 0.30], [0.05, 3.5, 0.02, 0.23]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[0.42, -0.8, 0.05, 0.16], [0.22, 0.85, 0.03, 0.08], [0.12, 1.8, 0.02, 0.04]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[-0.36, -0.8, 0.24, 0.15], [-0.19, 0.80, 0.14, 0.08], [-0.10, 1.7, 0.08, 0.04]]},
            {'op': 'tube', **vir_wood, 'sides': 4, 'pts': [[-0.12, -0.8, -0.40, 0.15], [-0.06, 0.82, -0.20, 0.08], [-0.02, 1.75, -0.10, 0.04]]},
            # Tall V-shaped primary limbs (matching IMG_1381 / IMG_1384)
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.04, 3.1, 0.02, 0.18], [1.65, 5.0, 0.80, 0.12], [3.2, 6.6, 1.55, 0.07]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.04, 3.1, 0.02, 0.18], [-1.55, 4.9, 0.90, 0.12], [-3.0, 6.5, 1.70, 0.07]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.05, 3.2, 0.0, 0.17], [0.65, 5.1, -1.65, 0.12], [1.3, 6.7, -3.1, 0.07]]},
            {'op': 'tube', **vir_wood, 'sides': 5, 'pts': [[0.04, 3.3, 0.0, 0.16], [-1.15, 5.3, -1.35, 0.11], [-2.2, 6.9, -2.5, 0.06]]},
            # Lush layered high dome
            {'op': 'tuft', **vir_leaf, 'r': [3.6, 1.80, 3.3], 'p': [2.9, 7.4, 1.4], 'yaw': 0.5, 'seed': 15, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **vir_leaf, 'r': [3.5, 1.80, 3.3], 'p': [-2.8, 7.3, 1.5], 'yaw': 1.4, 'seed': 27, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **vir_leaf, 'r': [3.4, 1.75, 3.5], 'p': [1.2, 7.5, -2.8], 'yaw': 2.3, 'seed': 45, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **vir_leaf, 'r': [3.3, 1.75, 3.2], 'p': [-2.0, 7.6, -2.2], 'yaw': 0.9, 'seed': 63, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **vir_leaf, 'r': [4.5, 2.15, 4.3], 'p': [0.0, 9.2, 0.0], 'yaw': 1.8, 'seed': 81, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **vir_leaf, 'r': [3.0, 1.65, 2.9], 'p': [0.1, 11.1, -0.1], 'yaw': 2.7, 'seed': 99, 'rings': 3, 'segs': 7},
        ],
        'mid': [
            {'op': 'tube', **vir_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.42], [0.04, 7.5, 0, 0.18]]},
            {'op': 'tuft', **vir_leaf, 'r': [5.6, 2.3, 5.4], 'p': [0.0, 7.8, 0.0], 'yaw': 0.6, 'seed': 15, 'rings': 2, 'segs': 8},
            {'op': 'tuft', **vir_leaf, 'r': [3.6, 1.85, 3.5], 'p': [0.1, 10.2, 0.0], 'yaw': 1.9, 'seed': 81, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **vir_leaf, 'trunkColor': p['virensTrunk'], 'trunkTop': 3.6, 'trunkR': 0.34,
             'profile': [[3.4, 2.5], [6.8, 5.8], [9.6, 5.1], [12.3, 1.8]], 'capY': 8.2, 'capR': 5.5},
        ],
    }

    # 7. bischofia — 秋枫/重阳木（兼翊武路栾树拱冠）(Bischofia javanica): slightly leaning trunk, long arching limbs
    bis_leaf = leaf('bischofia')
    bis_pod = leaf('bischofiaPod')
    bis_wood = wood('bischofiaTrunk')
    bischofia = {
        'id': 7,
        'name': 'bischofia',
        'zh': '秋枫',
        'latin': 'Bischofia javanica',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.07, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.07, 0.95, 1.04], 'lean': 0.09, 'tint': [1.06, 0.99, 0.91]},
            {'scale': [0.95, 1.05, 0.96], 'lean': 0.05, 'tint': [1.12, 0.97, 0.88]},
        ],
        'near': [
            # Slightly leaning dark fissured trunk + long arching street-spanning limbs (IMG_1345 / IMG_1346)
            {'op': 'tube', **bis_wood, 'sides': 7, 'pts': [[0, -1.5, 0, 0.31], [0.04, 0.3, 0, 0.27], [0.26, 1.7, 0.05, 0.22], [0.52, 3.0, 0.08, 0.17]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.48, 2.8, 0.07, 0.14], [1.95, 4.1, 0.45, 0.10], [3.55, 5.1, 0.80, 0.06]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.46, 2.8, 0.06, 0.13], [-0.85, 4.3, 0.95, 0.09], [-1.95, 5.5, 1.75, 0.055]]},
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0.50, 2.9, 0.06, 0.13], [0.95, 4.5, -1.35, 0.09], [1.65, 5.7, -2.45, 0.055]]},
            {'op': 'tube', **bis_wood, 'sides': 4, 'pts': [[0.52, 3.0, 0.08, 0.12], [-0.45, 4.9, -0.85, 0.08], [-1.15, 6.4, -1.55, 0.05]]},
            {'op': 'tuft', **bis_leaf, 'r': [3.1, 1.45, 2.7], 'p': [3.2, 5.8, 0.75], 'yaw': 0.3, 'seed': 21, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **bis_leaf, 'r': [2.8, 1.50, 2.7], 'p': [-1.7, 6.2, 1.55], 'yaw': 1.5, 'seed': 35, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **bis_leaf, 'r': [2.8, 1.50, 2.8], 'p': [1.5, 6.3, -2.2], 'yaw': 2.4, 'seed': 51, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **bis_leaf, 'r': [3.4, 1.70, 3.2], 'p': [0.55, 7.6, -0.15], 'yaw': 1.0, 'seed': 69, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **bis_leaf, 'r': [2.4, 1.40, 2.3], 'p': [-0.75, 7.9, -1.1], 'yaw': 2.0, 'seed': 85, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **bis_pod, 'r': [1.95, 1.05, 1.85], 'p': [1.35, 8.8, 0.25], 'yaw': 0.7, 'seed': 93, 'rings': 2, 'segs': 6},
        ],
        'mid': [
            {'op': 'tube', **bis_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.27], [0.68, 6.1, 0.05, 0.12]]},
            {'op': 'tuft', **bis_leaf, 'r': [4.4, 2.0, 4.1], 'p': [0.75, 6.3, 0.0], 'yaw': 0.5, 'seed': 21, 'rings': 2, 'segs': 7},
            {'op': 'tuft', **bis_leaf, 'r': [2.9, 1.55, 2.8], 'p': [0.65, 8.2, -0.1], 'yaw': 1.8, 'seed': 69, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **bis_leaf, 'trunkColor': p['bischofiaTrunk'], 'trunkTop': 3.0, 'trunkR': 0.24,
             'profile': [[2.8, 2.1], [5.5, 4.5], [7.9, 3.9], [9.8, 1.3]], 'capY': 6.7, 'capR': 4.2},
        ],
    }

    # 8. elaeocarpus — 杜英 (Elaeocarpus decipiens): straight trunk, whorled pagoda tiers + crimson senescent leaf tufts
    ela_leaf = leaf('elaeocarpus')
    ela_red = leaf('elaeocarpusRed')
    ela_wood = wood('elaeocarpusTrunk')
    elaeocarpus = {
        'id': 8,
        'name': 'elaeocarpus',
        'zh': '杜英',
        'latin': 'Elaeocarpus decipiens',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.95, 1.08, 0.95], 'lean': -0.02, 'tint': [1.05, 0.98, 0.94]},
            {'scale': [1.06, 0.94, 1.05], 'lean': 0.02, 'tint': [0.97, 1.02, 0.96]},
        ],
        'near': [
            {'op': 'tube', **ela_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.25], [0, 0.3, 0, 0.22], [0, 2.6, 0, 0.16], [0, 6.8, 0, 0.09]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0, 2.4, 0, 0.10], [1.15, 3.3, 0.45, 0.055]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0, 2.5, 0, 0.10], [-1.10, 3.4, 0.55, 0.055]]},
            {'op': 'tube', **ela_wood, 'sides': 4, 'pts': [[0, 2.5, 0, 0.10], [0.15, 3.4, -1.20, 0.055]]},
            {'op': 'tier', **ela_leaf, 'y0': 2.6, 'y1': 5.5, 'r0': 2.85, 'r1': 1.05, 'segs': 8, 'yaw': 0.1, 'scallop': 0.18},
            {'op': 'tier', **ela_leaf, 'y0': 4.6, 'y1': 7.5, 'r0': 2.35, 'r1': 0.80, 'segs': 8, 'yaw': 0.55, 'scallop': 0.17},
            {'op': 'tier', **ela_leaf, 'y0': 6.6, 'y1': 9.3, 'r0': 1.75, 'r1': 0.45, 'segs': 7, 'yaw': 1.05, 'scallop': 0.16},
            {'op': 'tuft', **ela_leaf, 'r': [1.20, 1.25, 1.15], 'p': [0.0, 9.5, 0.0], 'yaw': 0.4, 'seed': 33, 'rings': 2, 'segs': 6},
            # Signature scattered crimson-red senescent foliage puffs ("红叶杜英")
            {'op': 'tuft', **ela_red, 'r': [0.95, 0.62, 0.90], 'p': [1.65, 4.1, 0.75], 'yaw': 0.8, 'seed': 57, 'rings': 2, 'segs': 6},
            {'op': 'tuft', **ela_red, 'r': [0.82, 0.55, 0.80], 'p': [-1.25, 6.0, -0.65], 'yaw': 2.1, 'seed': 77, 'rings': 2, 'segs': 6},
        ],
        'mid': [
            {'op': 'tube', **ela_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.22], [0, 4.2, 0, 0.13]]},
            {'op': 'tier', **ela_leaf, 'y0': 2.6, 'y1': 7.0, 'r0': 2.8, 'r1': 0.95, 'segs': 7, 'yaw': 0.1, 'scallop': 0.14},
            {'op': 'tier', **ela_leaf, 'y0': 6.0, 'y1': 10.3, 'r0': 1.85, 'r1': 0.12, 'segs': 6, 'yaw': 0.6, 'scallop': 0.12},
        ],
        'far': [
            {'op': 'cross', **ela_leaf, 'trunkColor': p['elaeocarpusTrunk'], 'trunkTop': 2.5, 'trunkR': 0.20,
             'profile': [[2.5, 2.75], [5.4, 2.35], [8.1, 1.45], [10.4, 0.25]], 'capY': 4.8, 'capR': 2.5},
        ],
    }

    # 9. ginkgo — 银杏 (Ginkgo biloba): upright trunk, acute ascending branches, golden-yellow autumn ovoid-conical crown
    gin_leaf = leaf('ginkgo')
    gin_wood = wood('ginkgoTrunk')
    ginkgo = {
        'id': 9,
        'name': 'ginkgo',
        'zh': '银杏',
        'latin': 'Ginkgo biloba',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.01, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [0.93, 1.08, 0.94], 'lean': -0.02, 'tint': [1.08, 1.01, 0.86]},
            {'scale': [1.06, 0.95, 1.05], 'lean': 0.02, 'tint': [0.88, 1.03, 0.95]},
        ],
        'near': [
            {'op': 'tube', **gin_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.26], [0, 0.3, 0, 0.23], [0.02, 2.7, 0, 0.17], [0.03, 6.8, 0, 0.10], [0.02, 9.6, 0, 0.05]]},
            # Acute 35-45 deg ascending ginkgo branches (matching 25_IMG_1414.jpg)
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.6, 0, 0.11], [0.95, 4.3, 0.45, 0.07], [1.65, 5.8, 0.80, 0.04]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.8, 0, 0.11], [-0.90, 4.5, 0.55, 0.07], [-1.55, 6.0, 0.95, 0.04]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.02, 2.9, 0, 0.10], [0.20, 4.7, -1.05, 0.065], [0.35, 6.2, -1.75, 0.04]]},
            {'op': 'tube', **gin_wood, 'sides': 4, 'pts': [[0.03, 4.6, 0, 0.09], [-0.75, 6.4, -0.75, 0.055], [-1.25, 7.8, -1.20, 0.035]]},
            {'op': 'tuft', **gin_leaf, 'r': [1.95, 1.50, 1.85], 'p': [1.45, 5.7, 0.70], 'yaw': 0.4, 'seed': 14, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **gin_leaf, 'r': [1.90, 1.50, 1.85], 'p': [-1.40, 5.9, 0.85], 'yaw': 1.5, 'seed': 28, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **gin_leaf, 'r': [1.85, 1.45, 1.90], 'p': [0.30, 6.0, -1.55], 'yaw': 2.4, 'seed': 42, 'rings': 3, 'segs': 7},
            {'op': 'tuft', **gin_leaf, 'r': [2.25, 1.85, 2.15], 'p': [0.05, 7.6, 0.05], 'yaw': 1.1, 'seed': 56, 'rings': 3, 'segs': 8},
            {'op': 'tuft', **gin_leaf, 'r': [1.65, 1.40, 1.60], 'p': [-0.85, 8.1, -0.85], 'yaw': 2.0, 'seed': 70, 'rings': 3, 'segs': 6},
            {'op': 'tuft', **gin_leaf, 'r': [1.55, 1.65, 1.50], 'p': [0.05, 9.7, -0.05], 'yaw': 0.8, 'seed': 84, 'rings': 3, 'segs': 7},
        ],
        'mid': [
            {'op': 'tube', **gin_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.23], [0.02, 6.1, 0, 0.11]]},
            {'op': 'tuft', **gin_leaf, 'r': [2.85, 2.45, 2.75], 'p': [0.0, 6.3, 0.0], 'yaw': 0.5, 'seed': 14, 'rings': 2, 'segs': 7},
            {'op': 'tuft', **gin_leaf, 'r': [1.95, 2.05, 1.90], 'p': [0.02, 9.0, 0.0], 'yaw': 1.7, 'seed': 56, 'rings': 2, 'segs': 6},
        ],
        'far': [
            {'op': 'cross', **gin_leaf, 'trunkColor': p['ginkgoTrunk'], 'trunkTop': 2.7, 'trunkR': 0.20,
             'profile': [[2.6, 1.5], [5.5, 2.85], [8.4, 2.25], [11.1, 0.45]], 'capY': 6.6, 'capR': 2.65},
        ],
    }

    # 10. willow — 垂柳 (Salix babylonica): gently leaning trunk, arched fountain limbs, pendulous weeping curtains
    wil_leaf = leaf('willow')
    wil_wood = wood('willowTrunk')
    willow = {
        'id': 10,
        'name': 'willow',
        'zh': '垂柳',
        'latin': 'Salix babylonica',
        'variants': [
            {'scale': [1.00, 1.00, 1.00], 'lean': 0.08, 'tint': [1.00, 1.00, 1.00]},
            {'scale': [1.07, 0.94, 1.06], 'lean': 0.11, 'tint': [1.04, 1.02, 0.93]},
            {'scale': [0.94, 1.06, 0.95], 'lean': 0.06, 'tint': [0.96, 1.01, 0.96]},
        ],
        'near': [
            {'op': 'tube', **wil_wood, 'sides': 6, 'pts': [[0, -1.5, 0, 0.29], [0.05, 0.3, 0, 0.25], [0.22, 1.8, 0.06, 0.20], [0.35, 2.9, 0.10, 0.15]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.32, 2.6, 0.09, 0.12], [1.35, 4.4, 0.45, 0.08], [2.25, 5.4, 0.75, 0.045]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.32, 2.6, 0.09, 0.12], [-0.95, 4.5, 0.85, 0.08], [-1.85, 5.5, 1.45, 0.045]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.34, 2.7, 0.09, 0.11], [0.55, 4.6, -1.25, 0.075], [0.95, 5.6, -2.10, 0.045]]},
            {'op': 'tube', **wil_wood, 'sides': 4, 'pts': [[0.34, 2.7, 0.09, 0.11], [-0.85, 4.7, -0.95, 0.075], [-1.55, 5.6, -1.70, 0.045]]},
            {'op': 'tuft', **wil_leaf, 'r': [3.3, 1.55, 3.2], 'p': [0.25, 6.4, 0.05], 'yaw': 0.5, 'seed': 25, 'rings': 2, 'segs': 8},
            {'op': 'curtains', **wil_leaf, 'origin': [0.25, 6.3, 0.05], 'count': 12, 'innerR': 1.65, 'outerR': 3.55, 'topY': 6.6, 'botY': 2.15, 'width': 0.62, 'segs': 3},
        ],
        'mid': [
            {'op': 'tube', **wil_wood, 'sides': 5, 'pts': [[0, -1.5, 0, 0.25], [0.26, 6.0, 0.06, 0.12]]},
            {'op': 'tuft', **wil_leaf, 'r': [3.4, 1.6, 3.3], 'p': [0.25, 6.2, 0.05], 'yaw': 0.5, 'seed': 25, 'rings': 2, 'segs': 7},
            {'op': 'curtains', **wil_leaf, 'origin': [0.25, 6.1, 0.05], 'count': 7, 'innerR': 1.8, 'outerR': 3.45, 'topY': 6.3, 'botY': 2.25, 'width': 0.78, 'segs': 2},
        ],
        'far': [
            {'op': 'cross', **wil_leaf, 'trunkColor': p['willowTrunk'], 'trunkTop': 2.2, 'trunkR': 0.22,
             'profile': [[2.1, 3.45], [4.6, 3.65], [6.7, 3.10], [8.2, 1.15]], 'capY': 5.8, 'capR': 3.35},
        ],
    }

    return [camphor, banyan, osmanthus, palm, conifer, shrub, virens, bischofia, elaeocarpus, ginkgo, willow]


# =============================================================================
# Deterministic Geometry Evaluators (mirrored 1:1 in web/src/look/trees.ts)
# =============================================================================

def _lerp_color(c0: tuple[float, float, float], c1: tuple[float, float, float], t: float) -> tuple[float, float, float]:
    u = max(0.0, min(1.0, t))
    return (c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u)


def _shade_part(tris: list[tuple], c_hex: int, lit_hex: int, dark_hex: int) -> tuple[list, list]:
    if not tris:
        return [], []
    ys = [(a[1] + b[1] + c[1]) / 3.0 for a, b, c in tris]
    ymin, ymax = min(ys), max(ys)
    span = max(0.01, ymax - ymin)
    lo, mid, hi = hex_rgb(dark_hex), hex_rgb(c_hex), hex_rgb(lit_hex)
    pos, col = [], []
    for (a, b, c), ym in zip(tris, ys):
        t = (ym - ymin) / span
        rgb = _lerp_color(lo, mid, t * 2.0) if t < 0.5 else _lerp_color(mid, hi, (t - 0.5) * 2.0)
        pos.extend([a, b, c])
        col.extend([rgb, rgb, rgb])
    return pos, col


def _eval_tube(pts: list[list[float]], sides: int) -> list[tuple]:
    rings = []
    up_ref = np.array([0.0, 0.0, 1.0])
    for i, (x, y, z, r) in enumerate(pts):
        p0 = np.array(pts[max(0, i - 1)][:3], dtype=float)
        p1 = np.array(pts[min(len(pts) - 1, i + 1)][:3], dtype=float)
        tang = p1 - p0
        tlen = float(np.linalg.norm(tang))
        tang = tang / tlen if tlen > 1e-6 else np.array([0.0, 1.0, 0.0])
        ref = np.array([1.0, 0.0, 0.0]) if abs(float(np.dot(tang, up_ref))) > 0.92 else up_ref
        u = np.cross(tang, ref)
        u /= max(1e-6, float(np.linalg.norm(u)))
        v = np.cross(tang, u)
        center = np.array([x, y, z], dtype=float)
        ring = []
        for s in range(sides):
            ang = s / sides * math.tau
            pt = center + r * (math.cos(ang) * u + math.sin(ang) * v)
            ring.append((float(pt[0]), float(pt[1]), float(pt[2])))
        rings.append(ring)
    tris = []
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for s in range(sides):
            sn = (s + 1) % sides
            tris.append((r0[s], r0[sn], r1[sn]))
            tris.append((r0[s], r1[sn], r1[s]))
    return tris


def _eval_tuft(rx: float, ry: float, rz: float, px: float, py: float, pz: float,
               yaw: float, seed: int, rings: int, segs: int) -> list[tuple]:
    eff_rings = max(1, rings - 1)
    eff_segs = max(5, segs - 1) if rings >= 3 else segs
    cs, sn = math.cos(yaw), math.sin(yaw)

    def xform(lx: float, ly: float, lz: float) -> tuple[float, float, float]:
        wx = lx * cs + lz * sn + px
        wz = -lx * sn + lz * cs + pz
        return (wx, ly + py, wz)

    top = xform(0.0, ry * 0.98, 0.0)
    bot = xform(0.0, -ry * 0.56, 0.0)
    bands = []
    for r_idx in range(1, eff_rings + 1):
        v = r_idx / (eff_rings + 1)
        phi = (0.5 - v) * math.pi
        sy = math.sin(phi)
        cy = math.cos(phi)
        y_local = ry * (sy * (0.98 if sy >= 0 else 0.58))
        band = []
        for s in range(eff_segs):
            th = s / eff_segs * math.tau
            lobe = 1.0 + 0.13 * math.sin(3.0 * th + seed * 0.7) + 0.08 * math.cos(5.0 * th - seed * 1.3 + r_idx)
            bump_y = 0.07 * ry * math.sin(2.0 * th + seed + r_idx * 1.7)
            band.append(xform(rx * cy * lobe * math.cos(th), y_local + bump_y, rz * cy * lobe * math.sin(th)))
        bands.append(band)

    tris = []
    for s in range(eff_segs):
        sn = (s + 1) % eff_segs
        tris.append((top, bands[0][sn], bands[0][s]))
        tris.append((bands[-1][s], bands[-1][sn], bot))
    for b in range(len(bands) - 1):
        b0, b1 = bands[b], bands[b + 1]
        for s in range(eff_segs):
            sn = (s + 1) % eff_segs
            tris.append((b0[s], b0[sn], b1[sn]))
            tris.append((b0[s], b1[sn], b1[s]))
    return tris


def _eval_tier(y0: float, y1: float, r0: float, r1: float, segs: int, yaw: float, scallop: float) -> list[tuple]:
    n = segs * 2
    bot_ring = []
    top_ring = []
    ymid = y0 + (y1 - y0) * 0.12
    for i in range(n):
        th = yaw + i / n * math.tau
        tip = (i % 2 == 0)
        rad = r0 * (1.0 + scallop if tip else 1.0 - scallop * 0.75)
        by = y0 if tip else ymid
        bot_ring.append((rad * math.cos(th), by, rad * math.sin(th)))
        top_ring.append((r1 * math.cos(th), y1, r1 * math.sin(th)))
    tris = []
    for i in range(n):
        inext = (i + 1) % n
        if r1 < 0.08:
            apex = (0.0, y1, 0.0)
            tris.append((bot_ring[i], apex, bot_ring[inext]))
        else:
            tris.append((bot_ring[i], top_ring[inext], bot_ring[inext]))
            tris.append((bot_ring[i], top_ring[i], top_ring[inext]))
    return tris


def _eval_fronds(origin: list[float], count: int, length: float, width: float,
                 rise: float, droop: float, segs: int) -> list[tuple]:
    ox, oy, oz = origin
    tris = []
    for i in range(count):
        tier_mul = 0.86 if i % 2 else 1.0
        yaw = i / count * math.tau + (i % 2) * 0.18
        cs, sn = math.cos(yaw), math.sin(yaw)
        stations = []
        for s in range(segs + 1):
            u = s / segs
            r = 0.15 + u * length * tier_mul
            y = oy + math.sin(u * 2.05) * rise * tier_mul - (u * u) * droop * (1.15 if i % 2 else 0.92)
            w = width * math.sin(max(0.08, min(0.96, u)) * math.pi) * (1.0 - u * 0.35)
            fold = 0.14 * w
            stations.append((r, y, w, fold))
        for s in range(segs):
            r0, y0, w0, f0 = stations[s]
            r1, y1, w1, f1 = stations[s + 1]

            def wp(rr: float, yy: float, zz: float) -> tuple[float, float, float]:
                return (ox + rr * cs - zz * sn, yy, oz + rr * sn + zz * cs)

            # V-creased leaflet pair along spine
            m0, m1 = wp(r0, y0 + f0, 0.0), wp(r1, y1 + f1, 0.0)
            l0, l1 = wp(r0, y0, -w0), wp(r1, y1, -w1)
            rt0, rt1 = wp(r0, y0, w0), wp(r1, y1, w1)
            tris.append((l0, m1, m0))
            tris.append((l0, l1, m1))
            tris.append((m0, m1, rt1))
            tris.append((m0, rt1, rt0))
    return tris


def _eval_curtains(origin: list[float], count: int, inner_r: float, outer_r: float,
                   top_y: float, bot_y: float, width: float, segs: int) -> list[tuple]:
    ox, _, oz = origin
    tris = []
    for i in range(count):
        yaw = i / count * math.tau + (i % 3) * 0.11
        cs, sn = math.cos(yaw), math.sin(yaw)
        drop = bot_y + (i % 3) * 0.32
        pts = []
        for s in range(segs + 1):
            u = s / segs
            rr = inner_r + (outer_r - inner_r) * math.sin(u * math.pi * 0.62)
            yy = top_y + math.sin(u * 1.2) * 0.35 - (u ** 1.35) * (top_y - drop)
            ww = width * (0.55 + 0.55 * math.sin(u * math.pi)) * (1.0 - 0.55 * u)
            pts.append((rr, yy, ww))
        for s in range(segs):
            r0, y0, w0 = pts[s]
            r1, y1, w1 = pts[s + 1]

            def wp(rr: float, yy: float, tang_off: float) -> tuple[float, float, float]:
                return (ox + rr * cs - tang_off * sn, yy, oz + rr * sn + tang_off * cs)

            a0, b0 = wp(r0, y0, -w0), wp(r0, y0, w0)
            a1, b1 = wp(r1, y1, -w1), wp(r1, y1, w1)
            tris.append((a0, b0, b1))
            tris.append((a0, b1, a1))
    return tris


def _eval_cross(part: dict) -> tuple[list, list]:
    pos, col = [], []
    tt, tr = float(part['trunkTop']), float(part['trunkR'])
    if tt > 4.0:
        trunk_tris = []
        for axis in (0, 1):
            a = (-tr, -0.8, 0.0) if axis == 0 else (0.0, -0.8, -tr)
            b = (tr, -0.8, 0.0) if axis == 0 else (0.0, -0.8, tr)
            c = (tr * 0.7, tt, 0.0) if axis == 0 else (0.0, tt, tr * 0.7)
            d = (-tr * 0.7, tt, 0.0) if axis == 0 else (0.0, tt, -tr * 0.7)
            trunk_tris.extend([(a, b, c), (a, c, d)])
        tc = int(part['trunkColor'])
        t_pos, t_col = _shade_part(trunk_tris, tc, tc, tc)
        pos.extend(t_pos)
        col.extend(t_col)
    prof = part['profile']
    ya, wa = float(prof[0][0]) * 0.85, float(prof[0][1]) * 0.75
    ym, wm = float(prof[1][0]), float(prof[1][1])
    yt, wt = float(prof[-1][0]), float(prof[-1][1])
    crown_tris = []
    for y0, w0, y1, w1 in ((ya, wa, ym, wm), (ym, wm, yt, wt)):
        for axis in (0, 1):
            a = (-w0, y0, 0.0) if axis == 0 else (0.0, y0, -w0)
            b = (w0, y0, 0.0) if axis == 0 else (0.0, y0, w0)
            c = (w1, y1, 0.0) if axis == 0 else (0.0, y1, w1)
            d = (-w1, y1, 0.0) if axis == 0 else (0.0, y1, -w1)
            crown_tris.extend([(a, b, c), (a, c, d)])
    cy, cr = float(part['capY']), float(part['capR'])
    crown_tris.extend([
        ((-cr, cy, 0.0), (0.0, cy + 0.25, cr), (cr, cy, 0.0)),
        ((-cr, cy, 0.0), (cr, cy, 0.0), (0.0, cy + 0.25, -cr)),
    ])
    c_pos, c_col = _shade_part(crown_tris, part['c'], part['lit'], part['dark'])
    pos.extend(c_pos)
    col.extend(c_col)
    return pos, col


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
    collide_trunk: bool = True,
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
    lean = float(var['lean'])
    cl, sl = math.cos(lean), math.sin(lean)
    cy_v, sy_v = math.cos(yaw), math.sin(yaw)

    wood_verts, wood_faces = [], []
    leaf_verts, leaf_faces = [], []
    for part in spec[lod_key]:
        op = part['op']
        if op == 'tube':
            tris = _eval_tube(part['pts'], part['sides'])
        elif op == 'tuft':
            rx, ry, rz = part['r']
            px, py, pz = part['p']
            tris = _eval_tuft(rx, ry, rz, px, py, pz, part['yaw'], part['seed'], part['rings'], part['segs'])
        elif op == 'tier':
            tris = _eval_tier(part['y0'], part['y1'], part['r0'], part['r1'], part['segs'], part['yaw'], part['scallop'])
        elif op == 'fronds':
            tris = _eval_fronds(part['origin'], part['count'], part['length'], part['width'], part['rise'], part['droop'], part['segs'])
        elif op == 'curtains':
            tris = _eval_curtains(part['origin'], part['count'], part['innerR'], part['outerR'], part['topY'], part['botY'], part['width'], part['segs'])
        else:
            continue
        is_wood = (op == 'tube')
        v_list = wood_verts if is_wood else leaf_verts
        f_list = wood_faces if is_wood else leaf_faces
        for tri in tris:
            base_idx = len(v_list)
            for vx, vy, vz in tri:
                vy_c = max(-0.45, vy) * sy
                vx_c, vz_c = vx * sx, vz * sz
                lx = vx_c * cl - vy_c * sl
                ly = vx_c * sl + vy_c * cl
                wx = lx * cy_v + vz_c * sy_v + x
                wz = -lx * sy_v + vz_c * cy_v + z
                v_list.append((wx, ly + y, wz))
            f_list.append([base_idx, base_idx + 1, base_idx + 2])

    if wood_faces:
        model.mesh(wood_verts, wood_faces, wood_mat, collide=False)
        if collide_trunk:
            model.box(x, y, z, 0.42 * scale, 2.6 * scale, 0.42 * scale, wood_mat, True)
    if leaf_faces:
        model.mesh(leaf_verts, leaf_faces, leaf_mat, collide=False)


def build_lod_arrays(spec: dict, lod: str = 'near', variant_idx: int | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    all_pos, all_col = [], []
    for part in spec[lod]:
        op = part['op']
        if op == 'cross':
            p_arr, c_arr = _eval_cross(part)
        else:
            if op == 'tube':
                tris = _eval_tube(part['pts'], part['sides'])
            elif op == 'tuft':
                rx, ry, rz = part['r']
                px, py, pz = part['p']
                tris = _eval_tuft(rx, ry, rz, px, py, pz, part['yaw'], part['seed'], part['rings'], part['segs'])
            elif op == 'tier':
                tris = _eval_tier(part['y0'], part['y1'], part['r0'], part['r1'], part['segs'], part['yaw'], part['scallop'])
            elif op == 'fronds':
                tris = _eval_fronds(part['origin'], part['count'], part['length'], part['width'], part['rise'], part['droop'], part['segs'])
            elif op == 'curtains':
                tris = _eval_curtains(part['origin'], part['count'], part['innerR'], part['outerR'], part['topY'], part['botY'], part['width'], part['segs'])
            else:
                raise ValueError(f'Unknown op: {op}')
            p_arr, c_arr = _shade_part(tris, part['c'], part['lit'], part['dark'])
        all_pos.extend(p_arr)
        all_col.extend(c_arr)

    pos = np.asarray(all_pos, dtype=np.float32)
    col = np.asarray(all_col, dtype=np.float32)

    if variant_idx is not None:
        var = spec['variants'][variant_idx % len(spec['variants'])]
        sx, sy, sz = var['scale']
        pos[:, 0] *= sx
        pos[:, 1] *= sy
        pos[:, 2] *= sz
        lean = float(var['lean'])
        if abs(lean) > 1e-5:
            cs, sn = math.cos(lean), math.sin(lean)
            x_new = pos[:, 0] * cs - pos[:, 1] * sn
            y_new = pos[:, 0] * sn + pos[:, 1] * cs
            pos[:, 0], pos[:, 1] = x_new, y_new
        tr, tg, tb = var['tint']
        col = np.clip(col * np.array([tr, tg, tb], dtype=np.float32), 0.0, 1.0)

    # Flat-shaded per-triangle normals
    tris_v = pos.reshape(-1, 3, 3)
    e1 = tris_v[:, 1] - tris_v[:, 0]
    e2 = tris_v[:, 2] - tris_v[:, 0]
    n = np.cross(e1, e2)
    nlen = np.maximum(1e-6, np.linalg.norm(n, axis=1, keepdims=True))
    n = np.repeat(n / nlen, 3, axis=0).astype(np.float32)
    return pos, n, col


def export_glb_assets(specs: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for spec in specs:
        scene = trimesh.Scene()
        for lod_key, node_name in (('near', 'lod0'), ('mid', 'lod1'), ('far', 'lod2')):
            pos, _, col = build_lod_arrays(spec, lod_key, variant_idx=0)
            rgba = np.column_stack([(col * 255).round().astype(np.uint8), np.full(len(pos), 255, dtype=np.uint8)])
            faces = np.arange(len(pos), dtype=np.int64).reshape(-1, 3)
            mesh = trimesh.Trimesh(vertices=pos, faces=faces, process=False)
            mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=rgba)
            scene.add_geometry(mesh, node_name=node_name, geom_name=f"{spec['name']}_{node_name}")
        scene.export(out_dir / f"{spec['id']:02d}_{spec['name']}.glb")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--specs-out', type=Path, default=Path(__file__).with_name('tree-specs.json'))
    parser.add_argument('--export-glb', type=Path, default=None)
    args = parser.parse_args()

    specs = build_species_specs()
    payload = {'version': 1, 'species': specs}
    args.specs_out.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'Wrote {args.specs_out} ({args.specs_out.stat().st_size:,} bytes, {len(specs)} species)')
    for spec in specs:
        counts = {}
        for lod in ('near', 'mid', 'far'):
            pos, _, _ = build_lod_arrays(spec, lod, variant_idx=0)
            counts[lod] = len(pos) // 3
        pos0, _, _ = build_lod_arrays(spec, 'near', variant_idx=0)
        w = float(max(pos0[:, 0].max() - pos0[:, 0].min(), pos0[:, 2].max() - pos0[:, 2].min()))
        h = float(pos0[:, 1].max())
        print(f"  [{spec['id']:2d}] {spec['name']:12s} ({spec['zh']:8s})  H={h:5.1f}m  W={w:4.1f}m  tris near={counts['near']:3d} mid={counts['mid']:2d} far={counts['far']:2d}")

    if args.export_glb is not None:
        export_glb_assets(specs, args.export_glb)
        print(f'Exported {len(specs)} multi-LOD GLBs to {args.export_glb}')


if __name__ == '__main__':
    main()
