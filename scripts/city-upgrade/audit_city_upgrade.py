#!/usr/bin/env python3
"""
Automated Quality & Integrity Audit for Guilin Online City Upgrade v1+ (full 4,080 open-world chunks / 955 shards).

Verifies hard acceptance gates from IDOK-385, IDOK-409, and IDOK-434 / IDOK-437:
  0. Hard guard against dev_bbox (325-chunk dev subset) unless --allow-dev-world is explicitly passed
  1. Complete non-empty shard coverage across all open-world building chunks (skips pure < 4 m^2 boundary sliver shards)
  2. Per-shard gzip budget strictly < 25 KB (25,600 bytes) & zero empty shard files
  3. ZERO trademark violations in 96-shop fascia & 16-blade catalog
  4. ZERO landmark intrusions (pipeline/landmarks.json + manifest.json + public/landmarks/*.glb + Tianyuan)
  5. ZERO aeroway/quiet-zone commercial signage intrusions & ZERO carriageway sign-pole intrusions
  6. ZERO adjacent same-hue fascias (within 6.0m on same street-facing side across ALL shards)
  7. ZERO out-of-bounds / NaN / Inf / >6.20m wide fascias / unknown v2 junk keys / schema mismatches
  8. Prints full R1 / R2 / R3 / R4 ring statistics (buildings, CMAB coverage, avg height delta, fascias, shard gzip sizes)
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

from shapely import STRtree, is_valid, prepare
from shapely.geometry import LineString, Point, Polygon, box

from build_city_upgrade import (
    SHARD_SIZE,
    build_landmark_guard,
    chunk_ring,
    load_cmab_all,
    load_osm_full,
    resolve_path,
    shard_in_sector,
    shard_of,
)
from sign_catalog import BLADE_SPECS, FASCIA_META, check_trademark_compliance

REPO_ROOT = Path(__file__).resolve().parents[2]
ALLOWED_SHARD_KEYS = {"overrides", "eaves", "acUnits", "fascias", "blades", "streetSigns", "walls"}
RINGS = ("r1", "r2", "r3", "r4")


def is_finite_nums(vals) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals)


def main():
    ap = argparse.ArgumentParser(description="Audit full 4,080-chunk / 512m shards of City Upgrade v1+.")
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "public/city-upgrade")
    ap.add_argument("--world-dir", type=Path, default=None)
    ap.add_argument("--cmab", type=Path, default=None)
    ap.add_argument("--osm", type=Path, default=None)
    ap.add_argument("--landmarks", type=Path, default=None)
    ap.add_argument("--overture", type=Path, default=None)
    ap.add_argument("--landmarks-glb-dir", type=Path, default=None)
    ap.add_argument(
        "--sector",
        choices=("west", "north", "east", "ne", "south", "es", "edge", "all"),
        default="all",
        help="Optional sector subset to audit (default: all)",
    )
    ap.add_argument("--allow-dev-world", action="store_true", help="Allow auditing against 325-chunk dev_bbox world")
    ap.add_argument("--json-report", type=Path, default=None)
    args = ap.parse_args()

    out_dir = args.out_dir
    world_dir = resolve_path(args.world_dir, "public/world")
    cmab_base = resolve_path(args.cmab, "raw/cmab_guilin/processed_2209_20220307_all.shp").with_suffix("")
    osm_path = resolve_path(args.osm, "raw/osm-2026-11.json")
    landmarks_path = resolve_path(args.landmarks, "pipeline/landmarks.json")
    overture_csv = resolve_path(args.overture, "raw/overture_buildings.csv")
    landmarks_glb_dir = resolve_path(args.landmarks_glb_dir, "public/landmarks")

    errors: list[str] = []

    # Gate 0: Hard guard against 325-chunk dev_bbox world subset
    mf = json.load((world_dir / "manifest.json").open(encoding="utf-8"))
    if mf.get("dev_bbox") is not None and not args.allow_dev_world:
        print(
            f"[audit_city_upgrade] ERROR: {world_dir / 'manifest.json'} contains dev_bbox={mf.get('dev_bbox')} "
            f"(325-chunk dev subset, not full 4,080 world).\n"
            f"  Pass --world-dir /Users/pan-work/guilinol/public/world or --allow-dev-world to override.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    # Gate 1: Trademark & catalog balance compliance
    tm_issues = check_trademark_compliance()
    if tm_issues:
        errors.extend(tm_issues)

    # Gate 2: Atlas files & index exist
    for fname in ("shop-fascias.webp", "shop-fascias-emit.webp", "shop-blades.webp", "index.json"):
        if not (out_dir / fname).exists():
            errors.append(f"Missing required asset: {out_dir / fname}")
    if errors:
        print("AUDIT FAILED (pre-flight):\n  " + "\n  ".join(errors))
        sys.exit(1)

    index_data = json.loads((out_dir / "index.json").read_text(encoding="utf-8"))
    cols, rows = index_data["fasciaGrid"]
    max_fascia = cols * rows
    max_blade = len(BLADE_SPECS)

    all_chunks = mf["chunks"]
    xs = [c["x"] for c in all_chunks]
    zs = [c["z"] for c in all_chunks]
    wx0, wx1 = float(min(xs)), float(max(xs) + 256)
    wz0, wz1 = float(min(zs)), float(max(zs) + 256)
    world_bounds = box(wx0, wz0, wx1, wz1)

    # Load OSM & Landmark Guard across full open world (or sector bounds)
    selected_chunks = []
    for c in all_chunks:
        gx, gz = shard_of(c["x"], c["z"])
        if shard_in_sector(gx, gz, args.sector):
            selected_chunks.append(c)

    if not selected_chunks:
        print(f"AUDIT FAILED: no chunks matched sector={args.sector}")
        sys.exit(1)

    sxs = [c["x"] for c in selected_chunks]
    szs = [c["z"] for c in selected_chunks]
    qx0, qx1 = float(min(sxs)) - 300.0, float(max(sxs) + 256) + 300.0
    qz0, qz1 = float(min(szs)) - 300.0, float(max(szs) + 256) + 300.0
    guard_bounds = box(qx0 - 200.0, qz0 - 200.0, qx1 + 200.0, qz1 + 200.0) if args.sector != "all" else world_bounds

    osm_data = load_osm_full(osm_path, qx0, qx1, qz0, qz1)
    cache_path = Path("/tmp/city-upgrade-landmark-footprints-v1.json")
    guard_items, guard_tree = build_landmark_guard(
        landmarks_path, mf, osm_data["osm_by_key"], overture_csv, landmarks_glb_dir, guard_bounds, cache_path=cache_path
    )
    cmab_items = load_cmab_all(cmab_base, qx0, qx1, qz0, qz1)
    cmab_tree = STRtree([p for p, _ in cmab_items])

    for g in osm_data["quiet_zones"]:
        prepare(g)
    quiet_tree = STRtree(osm_data["quiet_zones"]) if osm_data["quiet_zones"] else None
    for g in osm_data["aeroway_zones"]:
        prepare(g)
    aero_tree = STRtree(osm_data["aeroway_zones"]) if osm_data["aeroway_zones"] else None

    carriageway_bufs = []
    for hw, ls in osm_data["all_road_geoms"]:
        if hw in (
            "trunk", "primary", "secondary", "tertiary",
            "trunk_link", "primary_link", "secondary_link", "tertiary_link",
            "residential", "unclassified",
        ):
            cw = 7.2 if hw in ("trunk", "primary") else (5.8 if hw == "secondary" else (4.6 if hw == "tertiary" else 3.0))
            g = ls.buffer(cw, quad_segs=3)
            prepare(g)
            carriageway_bufs.append(g)
    carriageway_tree = STRtree(carriageway_bufs) if carriageway_bufs else None

    prop_guard_polys = []
    for _lid, g in guard_items:
        bg = g.buffer(0.48, quad_segs=2)
        prepare(bg)
        prop_guard_polys.append(bg)
    prop_guard_tree = STRtree(prop_guard_polys) if prop_guard_polys else None

    def hits_landmark(geom, prop_margin: bool = False) -> str | None:
        tree = prop_guard_tree if (prop_margin and prop_guard_tree is not None) else guard_tree
        for hi in tree.query(geom, predicate="intersects"):
            return guard_items[int(hi)][0]
        return None

    def hits_any(tree: STRtree | None, geom) -> bool:
        if not tree:
            return False
        for _ in tree.query(geom, predicate="intersects"):
            return True
        return False

    # Inspect all selected GL04 chunks to determine exact expected non-empty shards (>=4m^2 non-landmark building)
    raw_building_shards: set[str] = set()
    expected_shards: set[str] = set()
    sliver_only_shards: set[str] = set()
    chunk_ring_by_tile: dict[str, str] = {}
    chunk_file_by_tile: dict[str, str] = {}
    gl04_street_cache: dict[str, tuple[list[Polygon], list[Polygon], list[LineString]]] = {}
    tile_buildings: dict[str, list[tuple[Polygon, float]]] = {}
    bldg_chunks_count = 0
    raw_bldg_count = 0

    def hits_gl04_road_or_fence(wx: float, wz: float) -> str | None:
        tx = int(math.floor(wx / 256.0)) * 256
        tz = int(math.floor(wz / 256.0)) * 256
        tkey = f"{tx},{tz}"
        fname = chunk_file_by_tile.get(tkey)
        if not fname:
            return None
        if tkey not in gl04_street_cache:
            raw = gzip.decompress((world_dir / fname).read_bytes())
            v, cnt, col_len, _, _ = struct.unpack("<5I", raw[4:24])
            off = 24 + 16900 + v * 9 + cnt * 4
            streets = json.loads(raw[off : off + col_len].decode("utf-8"))[1]
            drivable_polys: list[Polygon] = []
            safe_polys: list[Polygon] = []
            fence_segs: list[LineString] = []
            for rec in streets[0]:
                k = rec[0]
                if k in (0, 1, 2, 4, 5, 6) and len(rec) >= 2 and len(rec[1]) >= 3:
                    p = Polygon(rec[1], rec[2:] if len(rec) > 2 else None)
                    if not is_valid(p):
                        p = p.buffer(0)
                    if p.is_empty:
                        continue
                    if k in (0, 2, 5):
                        drivable_polys.append(p)
                    else:
                        safe_polys.append(p)
            decor = streets[9] if len(streets) > 9 and streets[9] else []
            for drec in decor:
                if drec[0] in (0, 1, 2, 5, 6, 7, 8) and len(drec) >= 5:
                    rx, rz, ang, rlen = drec[1] / 10.0, drec[2] / 10.0, -drec[3] / 100.0, drec[4] / 10.0
                    ax, az = rx - 0.5 * rlen * math.cos(ang), rz + 0.5 * rlen * math.sin(ang)
                    bx, bz = rx + 0.5 * rlen * math.cos(ang), rz - 0.5 * rlen * math.sin(ang)
                    fence_segs.append(LineString([(ax, az), (bx, bz)]))
            gl04_street_cache[tkey] = (drivable_polys, safe_polys, fence_segs)
        drivable_polys, safe_polys, fence_segs = gl04_street_cache[tkey]
        lx, lz = wx - tx, wz - tz
        pt_cm = Point(lx * 100.0, lz * 100.0)
        on_safe = any(sp.contains(pt_cm) for sp in safe_polys)
        if not on_safe and any(dp.contains(pt_cm) for dp in drivable_polys):
            return "gl04_carriageway_or_cycleway"
        pt_m = Point(lx, lz)
        if any(seg.distance(pt_m) < 0.28 for seg in fence_segs):
            return "gl04_street_fence"
        return None

    for c in selected_chunks:
        tx, tz = c["x"], c["z"]
        gx, gz = shard_of(tx, tz)
        skey = f"{gx},{gz}"
        tkey = f"{tx},{tz}"
        chunk_ring_by_tile[tkey] = chunk_ring(tx, tz)
        chunk_file_by_tile[tkey] = c["file"]

        raw = gzip.decompress((world_dir / c["file"]).read_bytes())
        verts, cnt, coll_len, _, _ = struct.unpack("<5I", raw[4:24])
        off = 24 + 8450 + 8450 + verts * 6 + verts * 3 + cnt * 4
        meta = json.loads(raw[off : off + coll_len].decode("utf-8"))
        bldgs = meta[0]
        if not bldgs:
            continue
        bldg_chunks_count += 1
        raw_bldg_count += len(bldgs)
        raw_building_shards.add(skey)

        b_list: list[tuple[Polygon, float]] = []
        has_substantial = False
        for b in bldgs:
            base_y = b[0] / 10.0
            old_h = max(3.1, b[1] / 10.0 - base_y)
            loops = b[2]
            if loops and len(loops[0]) >= 3:
                poly = Polygon([(tx + p[0] / 100.0, tz + p[1] / 100.0) for p in loops[0]])
                if not is_valid(poly):
                    poly = poly.buffer(0)
            else:
                poly = Polygon()
            b_list.append((poly, old_h))
            if not poly.is_empty and poly.area >= 4.0 and hits_landmark(poly) is None:
                has_substantial = True
        tile_buildings[tkey] = b_list
        if has_substantial:
            expected_shards.add(skey)

    sliver_only_shards = raw_building_shards - expected_shards

    # Select shards in index matching sector
    indexed_sector_shards: dict[str, dict] = {}
    for skey, smeta in sorted(index_data["shards"].items()):
        gx, gz = map(int, skey.split(","))
        if shard_in_sector(gx, gz, args.sector):
            indexed_sector_shards[skey] = smeta

    missing_shards = sorted(expected_shards - set(indexed_sector_shards.keys()))
    if missing_shards:
        errors.append(f"Missing {len(missing_shards)} substantial building shards in index.json: {missing_shards[:12]}")

    # Audit every shard in sector
    gzip_sizes: list[tuple[int, str]] = []
    landmark_intrusions: list[str] = []
    quiet_intrusions: list[str] = []
    aero_intrusions: list[str] = []
    roadway_intrusions: list[str] = []
    wide_fascias: list[str] = []
    coord_errors: list[str] = []
    schema_errors: list[str] = []
    all_fascias: list[tuple[float, float, float, str, str]] = []
    max_fw = 0.0

    ring_totals = {
        r: {
            "chunks": 0, "bldgChunks": 0, "buildings": 0, "cmab": 0,
            "old_h": 0.0, "new_h": 0.0, "fascias": 0, "blades": 0,
            "eaves": 0, "acUnits": 0, "streetSigns": 0, "walls": 0,
        }
        for r in RINGS
    }
    for tkey, r in chunk_ring_by_tile.items():
        ring_totals[r]["chunks"] += 1
        if tkey in tile_buildings:
            ring_totals[r]["bldgChunks"] += 1

    for skey, smeta in sorted(indexed_sector_shards.items()):
        gx, gz = map(int, skey.split(","))
        spath = out_dir / "shards" / f"{gx}_{gz}.json"
        if not spath.exists():
            errors.append(f"Shard file missing: {spath}")
            continue
        raw_bytes = spath.read_bytes()
        gz_len = len(gzip.compress(raw_bytes, compresslevel=6))
        gzip_sizes.append((gz_len, skey))
        if gz_len >= 25_600:
            errors.append(f"Shard {skey} gzip size {gz_len/1024:.2f} KB >= 25 KB limit")

        data = json.loads(raw_bytes.decode("utf-8"))
        unknown_keys = set(data.keys()) - ALLOWED_SHARD_KEYS
        if unknown_keys:
            schema_errors.append(f"Shard {skey}: forbidden/unknown keys {sorted(unknown_keys)}")
        if not any(data.get(k) for k in ALLOWED_SHARD_KEYS):
            schema_errors.append(f"Shard {skey}: empty shard file written to disk")

        sx0, sx1 = gx * SHARD_SIZE, (gx + 1) * SHARD_SIZE
        sz0, sz1 = gz * SHARD_SIZE, (gz + 1) * SHARD_SIZE

        # Check overrides
        overrides = data.get("overrides", {})
        if len(overrides) != smeta.get("buildings"):
            schema_errors.append(f"Shard {skey}: index buildings={smeta.get('buildings')} != actual {len(overrides)}")

        for bkey, ov in overrides.items():
            tkey, bidx_s = bkey.split(":")
            bidx = int(bidx_s)
            tx, tz = map(int, tkey.split(","))
            if shard_of(tx, tz) != (gx, gz):
                schema_errors.append(f"Shard {skey}: override {bkey} placed in wrong shard")
            if not (0 <= ov["u"] <= 7 and -1 <= ov["s"] <= 3 and 0 <= ov["r"] <= 3 and 3.0 <= ov["h"] <= 60.0 and 1 <= ov["f"] <= 20):
                schema_errors.append(f"Shard {skey}: invalid override values on {bkey}: {ov}")
            if tkey not in tile_buildings or bidx >= len(tile_buildings[tkey]):
                schema_errors.append(f"Shard {skey}: override {bkey} not found in manifest tile")
                continue
            r = chunk_ring_by_tile[tkey]
            bp, old_h = tile_buildings[tkey][bidx]
            lm_hit = hits_landmark(bp)
            if lm_hit:
                landmark_intrusions.append(f"override {bkey} hits landmark {lm_hit}")
            if ov["s"] >= 0 and hits_any(aero_tree, bp):
                aero_intrusions.append(f"override {bkey} has shop style inside aeroway")
            ring_totals[r]["buildings"] += 1
            ring_totals[r]["old_h"] += old_h
            ring_totals[r]["new_h"] += ov["h"]
            matched = False
            bminx, bminy, bmaxx, bmaxy = bp.bounds
            for hi in cmab_tree.query(box(bminx - 4.0, bminy - 4.0, bmaxx + 4.0, bmaxy + 4.0)):
                cp, crec = cmab_items[int(hi)]
                if crec.get("Height") and (bp.intersects(cp) or bp.distance(cp) < 4.0):
                    matched = True
                    break
            if matched:
                ring_totals[r]["cmab"] += 1

        # Check fascias
        fascias = data.get("fascias", [])
        if len(fascias) != smeta.get("fascias"):
            schema_errors.append(f"Shard {skey}: index fascias={smeta.get('fascias')} != actual {len(fascias)}")
        for f in fascias:
            if len(f) != 8 or not is_finite_nums(f):
                coord_errors.append(f"Invalid fascia in {skey}: {f}")
                continue
            fx, fy, fz, yaw, fw, fh, fd, aidx = f
            max_fw = max(max_fw, fw)
            if fw > 6.21:
                wide_fascias.append(f"fascia in {skey} ({fx},{fz}) fw={fw:.2f}m > 6.20m")
            if not (sx0 - 16 <= fx <= sx1 + 16 and sz0 - 16 <= fz <= sz1 + 16 and wx0 <= fx <= wx1 and wz0 <= fz <= wz1):
                coord_errors.append(f"Out-of-bounds fascia in {skey}: ({fx},{fz})")
            if not (0 <= aidx < max_fascia and 0.06 <= fd <= 0.16 and 0.85 <= fh <= 1.30):
                schema_errors.append(f"Out-of-spec fascia in {skey}: {f}")
            fpt = Point(fx, fz)
            lm_hit = hits_landmark(fpt, prop_margin=True)
            if lm_hit:
                landmark_intrusions.append(f"fascia ({fx},{fz}) in {skey} hits landmark {lm_hit}")
            if hits_any(aero_tree, fpt):
                aero_intrusions.append(f"fascia ({fx},{fz}) in {skey} inside aeroway")
            if hits_any(quiet_tree, fpt):
                quiet_intrusions.append(f"fascia ({fx},{fz}) in {skey} inside quiet zone")
            hue = FASCIA_META[int(aidx)][0]
            all_fascias.append((fx, fz, yaw, hue, skey))
            r = chunk_ring(int(math.floor(fx / 256.0)) * 256, int(math.floor(fz / 256.0)) * 256)
            ring_totals[r]["fascias"] += 1

        # Check blades
        for bl in data.get("blades", []):
            if len(bl) != 5 or not is_finite_nums(bl):
                coord_errors.append(f"Invalid blade in {skey}: {bl}")
                continue
            bx, by, bz, _yaw, bidx = bl
            if not (wx0 <= bx <= wx1 and wz0 <= bz <= wz1 and 0 <= bidx < max_blade):
                coord_errors.append(f"Out-of-bounds blade in {skey}: {bl}")
            bpt = Point(bx, bz)
            lm_hit = hits_landmark(bpt, prop_margin=True)
            if lm_hit:
                landmark_intrusions.append(f"blade ({bx},{bz}) in {skey} hits landmark {lm_hit}")
            if hits_any(aero_tree, bpt):
                aero_intrusions.append(f"blade ({bx},{bz}) in {skey} inside aeroway")
            if hits_any(quiet_tree, bpt):
                quiet_intrusions.append(f"blade ({bx},{bz}) in {skey} inside quiet zone")
            r = chunk_ring(int(math.floor(bx / 256.0)) * 256, int(math.floor(bz / 256.0)) * 256)
            ring_totals[r]["blades"] += 1

        # Check eaves
        for ev in data.get("eaves", []):
            if len(ev) != 8 or not is_finite_nums(ev):
                coord_errors.append(f"Invalid eave in {skey}: {ev}")
                continue
            x1, z1, x2, z2, y, nx, nz, kind = ev
            if not (wx0 <= x1 <= wx1 and wz0 <= z1 <= wz1 and wx0 <= x2 <= wx1 and wz0 <= z2 <= wz1 and kind in (0, 1)):
                coord_errors.append(f"Out-of-bounds eave in {skey}: {ev}")
            lm_hit = hits_landmark(LineString([(x1, z1), (x2, z2)]), prop_margin=True)
            if lm_hit:
                landmark_intrusions.append(f"eave ({x1},{z1})-({x2},{z2}) in {skey} hits landmark {lm_hit}")
            mx, mz = (x1 + x2) * 0.5, (z1 + z2) * 0.5
            r = chunk_ring(int(math.floor(mx / 256.0)) * 256, int(math.floor(mz / 256.0)) * 256)
            ring_totals[r]["eaves"] += 1

        # Check AC units
        for ac in data.get("acUnits", []):
            if len(ac) != 4 or not is_finite_nums(ac):
                coord_errors.append(f"Invalid acUnit in {skey}: {ac}")
                continue
            ax, ay, az, _yaw = ac
            if not (wx0 <= ax <= wx1 and wz0 <= az <= wz1):
                coord_errors.append(f"Out-of-bounds acUnit in {skey}: {ac}")
            apt = Point(ax, az)
            lm_hit = hits_landmark(apt, prop_margin=True)
            if lm_hit:
                landmark_intrusions.append(f"acUnit ({ax},{az}) in {skey} hits landmark {lm_hit}")
            if hits_any(aero_tree, apt):
                aero_intrusions.append(f"acUnit ({ax},{az}) in {skey} inside aeroway")
            r = chunk_ring(int(math.floor(ax / 256.0)) * 256, int(math.floor(az / 256.0)) * 256)
            ring_totals[r]["acUnits"] += 1

        # Check streetSigns
        for ss in data.get("streetSigns", []):
            if not is_finite_nums([ss["x"], ss["y"], ss["z"], ss["yaw"]]) or not ss.get("zh") or not ss.get("en"):
                coord_errors.append(f"Invalid streetSign in {skey}: {ss}")
                continue
            if not (wx0 <= ss["x"] <= wx1 and wz0 <= ss["z"] <= wz1 and 100.0 <= ss["y"] <= 420.0):
                coord_errors.append(f"Out-of-bounds streetSign in {skey}: {ss}")
            spt = Point(ss["x"], ss["z"])
            lm_hit = hits_landmark(spt)
            if lm_hit:
                landmark_intrusions.append(f"streetSign {ss['zh']} ({ss['x']},{ss['z']}) hits landmark {lm_hit}")
            if carriageway_tree and len(carriageway_tree.query(spt, predicate="intersects")) > 0:
                roadway_intrusions.append(f"streetSign {ss['zh']} ({ss['x']},{ss['z']}) in {skey} inside OSM carriageway")
            else:
                gl04_hit = hits_gl04_road_or_fence(ss["x"], ss["z"])
                if gl04_hit:
                    roadway_intrusions.append(f"streetSign {ss['zh']} ({ss['x']},{ss['z']}) in {skey} inside {gl04_hit}")
            if hits_any(aero_tree, spt):
                aero_intrusions.append(f"streetSign {ss['zh']} ({ss['x']},{ss['z']}) in {skey} inside aeroway")
            r = chunk_ring(int(math.floor(ss["x"] / 256.0)) * 256, int(math.floor(ss["z"] / 256.0)) * 256)
            ring_totals[r]["streetSigns"] += 1

        # Check walls
        for wl in data.get("walls", []):
            if len(wl) != 7 or not is_finite_nums(wl):
                coord_errors.append(f"Invalid wall in {skey}: {wl}")
                continue
            x1, z1, x2, z2, y1, y2, kind = wl
            if not (wx0 <= x1 <= wx1 and wz0 <= z1 <= wz1 and wx0 <= x2 <= wx1 and wz0 <= z2 <= wz1 and 100.0 <= y1 <= 420.0 and 100.0 <= y2 <= 420.0):
                coord_errors.append(f"Out-of-bounds wall in {skey}: {wl}")
            lm_hit = hits_landmark(LineString([(x1, z1), (x2, z2)]))
            if lm_hit:
                landmark_intrusions.append(f"wall in {skey} hits landmark {lm_hit}")
            mx, mz = (x1 + x2) * 0.5, (z1 + z2) * 0.5
            r = chunk_ring(int(math.floor(mx / 256.0)) * 256, int(math.floor(mz / 256.0)) * 256)
            ring_totals[r]["walls"] += 1

    # Gate 6: Adjacent same-hue fascia check across ALL audited shards (spatial grid 8m, radius 6.0m, facing dot > 0.65)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for idx, (fx, fz, _yaw, _hue, _sk) in enumerate(all_fascias):
        grid[(int(math.floor(fx / 8.0)), int(math.floor(fz / 8.0)))].append(idx)
    same_hue_pairs = 0
    same_hue_samples: list[str] = []
    for i, (x1, z1, yaw1, hue1, sk1) in enumerate(all_fascias):
        bx, bz = int(math.floor(x1 / 8.0)), int(math.floor(z1 / 8.0))
        nx1, nz1 = math.sin(yaw1), math.cos(yaw1)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for j in grid.get((bx + dx, bz + dz), ()):
                    if j <= i:
                        continue
                    x2, z2, yaw2, hue2, sk2 = all_fascias[j]
                    if hue1 != hue2:
                        continue
                    d = math.hypot(x2 - x1, z2 - z1)
                    if d <= 6.0 and (nx1 * math.sin(yaw2) + nz1 * math.cos(yaw2)) > 0.65:
                        same_hue_pairs += 1
                        if len(same_hue_samples) < 8:
                            same_hue_samples.append(f"{sk1}({x1},{z1}) vs {sk2}({x2},{z2}) hue={hue1} d={d:.2f}m")

    gzip_sizes.sort(reverse=True)
    max_gz, max_gz_sk = gzip_sizes[0] if gzip_sizes else (0, "")
    avg_gz = sum(g for g, _ in gzip_sizes) / max(len(gzip_sizes), 1)
    total_gz = sum(g for g, _ in gzip_sizes)

    report = {
        "ok": not (
            errors
            or landmark_intrusions
            or quiet_intrusions
            or aero_intrusions
            or roadway_intrusions
            or wide_fascias
            or coord_errors
            or schema_errors
            or same_hue_pairs > 0
        ),
        "sector": args.sector,
        "fasciaGrid": [cols, rows],
        "shardsAudited": len(gzip_sizes),
        "shardsExpectedNonEmpty": len(expected_shards),
        "shardsRawWithBuildings": len(raw_building_shards),
        "shardsSliverSkipped": sorted(sliver_only_shards),
        "chunksTotal": len(selected_chunks),
        "buildingChunksTotal": bldg_chunks_count,
        "rawBuildingsTotal": raw_bldg_count,
        "maxFasciaWidthM": round(max_fw, 2),
        "gzipKB": {
            "max": round(max_gz / 1024.0, 2),
            "maxShard": max_gz_sk,
            "avg": round(avg_gz / 1024.0, 2),
            "total": round(total_gz / 1024.0, 1),
            "top5": [[sk, round(g / 1024.0, 2)] for g, sk in gzip_sizes[:5]],
        },
        "checks": {
            "trademarkViolations": len(tm_issues),
            "landmarkIntrusions": len(landmark_intrusions),
            "quietZoneIntrusions": len(quiet_intrusions),
            "aerowayIntrusions": len(aero_intrusions),
            "roadwaySignIntrusions": len(roadway_intrusions),
            "adjacentSameHuePairs": same_hue_pairs,
            "wideFasciasGt620": len(wide_fascias),
            "coordOrNaNErrors": len(coord_errors),
            "schemaErrors": len(schema_errors),
        },
        "rings": {},
    }

    print(f"=== City Upgrade v1+ Full-City Audit Report (sector={args.sector}) ===")
    print(
        f"  Shards audited        : {len(gzip_sizes)} / {len(expected_shards)} substantial non-empty "
        f"(raw w/ bldgs: {len(raw_building_shards)}, sliver-only skipped: {len(sliver_only_shards)}, "
        f"{len(selected_chunks)} chunks / {bldg_chunks_count} bldg chunks / {raw_bldg_count} raw bldgs)"
    )
    print(f"  Fascia atlas grid     : {cols} x {rows} = {max_fascia} unique compliant shops (+ {max_blade} blades) | max_fw={max_fw:.2f}m")
    print(f"  Shard gzip volume     : max {max_gz/1024:.2f} KB ({max_gz_sk}), avg {avg_gz/1024:.2f} KB, total {total_gz/1024:.1f} KB [limit < 25.00 KB]")
    print(f"  Trademark violations  : {len(tm_issues)}")
    print(f"  Landmark intrusions   : {len(landmark_intrusions)}")
    print(f"  Quiet-zone signage    : {len(quiet_intrusions)}")
    print(f"  Aeroway intrusions    : {len(aero_intrusions)}")
    print(f"  Roadway sign poles    : {len(roadway_intrusions)}")
    print(f"  Adjacent same-hue     : {same_hue_pairs}")
    print(f"  Wide fascias (>6.2m)  : {len(wide_fascias)}")
    print(f"  Out-of-bounds / NaN   : {len(coord_errors)}")
    print(f"  Schema / v2-junk errs : {len(schema_errors)}")
    print("\n  Ring Breakdown:")
    for r in RINGS:
        rt = ring_totals[r]
        if rt["chunks"] == 0 and rt["buildings"] == 0:
            continue
        nb = max(1, rt["buildings"])
        cmab_pct = 100.0 * rt["cmab"] / nb
        old_avg = rt["old_h"] / nb
        new_avg = rt["new_h"] / nb
        report["rings"][r] = {
            "chunks": rt["chunks"],
            "bldgChunks": rt["bldgChunks"],
            "buildings": rt["buildings"],
            "cmabMatched": rt["cmab"],
            "cmabMatchPct": round(cmab_pct, 1),
            "avgOldH": round(old_avg, 2),
            "avgNewH": round(new_avg, 2),
            "fascias": rt["fascias"],
            "blades": rt["blades"],
            "eaves": rt["eaves"],
            "acUnits": rt["acUnits"],
            "streetSigns": rt["streetSigns"],
            "walls": rt["walls"],
        }
        print(
            f"    {r.upper()} ({rt['chunks']:4d} chunks / {rt['bldgChunks']:4d} bldg): {rt['buildings']:5d} bldgs | CMAB {cmab_pct:5.1f}% | "
            f"avgH {old_avg:4.1f}m -> {new_avg:4.1f}m | fascias {rt['fascias']:5d} | "
            f"eaves {rt['eaves']:4d} | ACs {rt['acUnits']:5d} | signs {rt['streetSigns']:3d} | walls {rt['walls']:3d}"
        )

    if args.json_report:
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if not report["ok"]:
        print("\nAUDIT FAILED:")
        for label, lst in [
            ("errors", errors),
            ("landmark_intrusions", landmark_intrusions[:12]),
            ("quiet_intrusions", quiet_intrusions[:12]),
            ("aero_intrusions", aero_intrusions[:12]),
            ("roadway_intrusions", roadway_intrusions[:12]),
            ("wide_fascias", wide_fascias[:12]),
            ("same_hue_samples", same_hue_samples),
            ("coord_errors", coord_errors[:12]),
            ("schema_errors", schema_errors[:12]),
        ]:
            if lst:
                print(f"  [{label}]:")
                for item in lst:
                    print(f"    - {item}")
        sys.exit(1)

    print("\nAUDIT PASSED: ALL GATES GREEN (0 trademark, 0 landmark, 0 quiet/aero, 0 roadway, 0 adjacent same-hue, <=6.2m fascia, 0 OOB/NaN/schema, all shards < 25 KB gzip)!")


if __name__ == "__main__":
    main()
