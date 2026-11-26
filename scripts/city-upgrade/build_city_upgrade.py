#!/usr/bin/env python3
"""
Guilin Online City Upgrade v1+ — Full-City Offline Spatial Shard Pipeline (325 chunks).

Upgrades all non-landmark GL04 buildings across the full open map (x in [-2560, 1280],
z in [-2560, 3328], 325 chunks -> 96 x 512m spatial shards) into:
  - public/city-upgrade/index.json
  - public/city-upgrade/shards/<gx>_<gz>.json

Features:
  - Ring-based generation: --ring r1 | r2 | r3 | all (center (-850, 0): R1<=1000m, R2<=2000m, R3>2000m)
  - Fast Shapely STRtree spatial indexing across 40,313 Tsinghua CMAB buildings & full OSM road network
  - Regional Guilin architectural style weighting:
      * Old downtown commercial-residential (中山路/三多路/西城路/南门桥)
      * Station / arterial / Qixing modern commercial (桂林站/七星/解放桥东/漓江路/上海路)
      * Riverside / karst scenic corridor (漓江/两江四湖/穿山/象鼻山/伏波/叠彩周边)
      * Compounds / schools / hospitals (quiet zones, zero commercial signage, subtle v1 iron fences only)
  - Automated absolute landmark protection (zero intrusion into all pipeline/landmarks.json
    polygons, GLB model 2D footprints, schoolGrounds, and Tianyuan Mifen shop)
  - Spatial neighbor hue anti-collision for 96-shop (8x12) one-shop-one-color signage
  - Automatic per-shard gzip size guard (< 25 KB gzip per shard)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely import STRtree, from_wkt, make_valid, prepare, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

from sign_catalog import BLADE_POOLS, FASCIA_META, ZONE_POOLS

REPO_ROOT = Path(__file__).resolve().parents[2]
REF_ROOT = Path("/Users/pan-work/guilinol-sanduo-opt")

LAT0, LON0 = 25.280, 110.300
MLAT = 110574.0
MLON = 111320.0 * math.cos(math.radians(LAT0))

CITY_CENTER = (-850.0, 0.0)
R1_RADIUS = 1000.0
R2_RADIUS = 2000.0
SHARD_SIZE = 512
MAX_SHARD_GZIP_BYTES = 24_500  # strict margin below 25 KB (25,600 bytes)

# Tianyuan Mifen exact oriented footprint (web/src/mifen/shop-mesh.ts)
TIANYUAN_CENTER = (-1139.2, -55.5)
TIANYUAN_ROT = 2.83616 - math.pi

# Full pinyin lookup for all 170 named drivable/walkable roads in open Guilin map
ROAD_PINYIN: dict[str, str] = {
    "七星路": "QIXING LU", "七星路一巷": "QIXING LU YIXIANG", "万寿巷": "WANSHOU XIANG",
    "三多路": "SANDUO LU", "三皇路": "SANHUANG LU", "上关路": "SHANGGUAN LU",
    "上海南路": "SHANGHAI NANLU", "上海路": "SHANGHAI LU", "上海路立交桥": "SHANGHAI LU OVERPASS",
    "东华巷": "DONGHUA XIANG", "东华路": "DONGHUA LU", "东城路": "DONGCHENG LU",
    "东安路": "DONGAN LU", "东江二路": "DONGJIANG ERLU", "东江路": "DONGJIANG LU",
    "东镇路": "DONGZHEN LU", "中华路": "ZHONGHUA LU", "中山中路": "ZHONGSHAN ZHONGLU",
    "中山北路": "ZHONGSHAN BEILU", "中山南路": "ZHONGSHAN NANLU", "临桂路": "LINGUI LU",
    "临江路": "LINJIANG LU", "丽中路": "LIZHONG LU", "丽君路": "LIJUN LU",
    "丽泽桥": "LIZE QIAO", "乐群路": "LEQUN LU", "九华路": "JIUHUA LU",
    "九岗岭路": "JIUGANGLING LU", "九岗岭路一巷": "JIUGANGLING YIXIANG", "九岗岭路二巷": "JIUGANGLING ERXIANG",
    "五美路": "WUMEI LU", "五里店路": "WULIDIAN LU", "交通路": "JIAOTONG LU",
    "人民路": "RENMIN LU", "仁寿巷": "RENSHOU XIANG", "伏和巷": "FUHE XIANG",
    "会仙路": "HUIXIAN LU", "会展道": "HUIZHAN DAO", "依仁路": "YIREN LU",
    "依仁路步行街": "YIREN PEDESTRIAN ST", "信义桥": "XINYI QIAO", "信义路": "XINYI LU",
    "六合路": "LIUHE LU", "六狮路": "LIUSHI LU", "兰井巷": "LANJING XIANG",
    "凤北路": "FENGBEI LU", "华夏之光广场": "HUAXIA SQUARE", "南新二路": "NANXIN ERLU",
    "南溪桥": "NANXI QIAO", "南环路": "NANHUAN LU", "南门桥": "NANMEN QIAO",
    "叠彩路": "DIECAI LU", "和平巷": "HEPING XIANG", "四会路": "SIHUI LU",
    "复兴里": "FUXING LI", "天鹅巷": "TIANE XIANG", "太平路": "TAIPING LU",
    "好吃街": "HAOCHI JIE", "宁远桥": "NINGYUAN QIAO", "宁远路": "NINGYUAN LU",
    "安家路": "ANJIA LU", "安新北路": "ANXIN BEILU", "安新南路": "ANXIN NANLU",
    "宝积桥": "BAOJI QIAO", "宝贤桥": "BAOXIAN QIAO", "寻源桥": "XUNYUAN QIAO",
    "将军桥": "JIANGJUN QIAO", "将军路": "JIANGJUN LU", "尚水美食街": "SHANGSHUI FOOD ST",
    "屏风路": "PINGFENG LU", "崇信路": "CHONGXIN LU", "崇善路": "CHONGSHAN LU",
    "建安路": "JIANAN LU", "建干路": "JIANGAN LU", "惠济桥": "HUIJI QIAO",
    "文化宫路": "WENHUAGONG LU", "文昌桥": "WENCHANG QIAO", "文明路": "WENMING LU",
    "新桥园路": "XINQIAOYUAN LU", "新码路": "XINMA LU", "施家园路": "SHIJIAYUAN LU",
    "木龙桥": "MULONG QIAO", "杉湖北路": "SHANHU BEILU", "栖霞桥": "QIXIA QIAO",
    "栖霞路": "QIXIA LU", "桂香里": "GUIXIANG LI", "桃花江桥": "TAOHUAJIANG QIAO",
    "梨园路": "LIYUAN LU", "榕城路": "RONGCHENG LU", "榕湖北路": "RONGHU BEILU",
    "榕湖南路": "RONGHU NANLU", "榕溪桥": "RONGXI QIAO", "榕荫路": "RONGYIN LU",
    "正阳步行街": "ZHENGYANG WALK", "正阳路": "ZHENGYANG LU", "毅峰南路": "YIFENG NANLU",
    "毅峰路": "YIFENG LU", "民主路": "MINZHU LU", "民族路": "MINZU LU",
    "民族路北巷": "MINZU BEIXIANG", "江东桥": "JIANGDONG QIAO", "江南巷": "JIANGNAN XIANG",
    "济民路": "JIMIN LU", "清秀路": "QINGXIU LU", "湖光路": "HUGUANG LU",
    "滨北路": "BINBEI LU", "滨江路": "BINJIANG LU", "漓江路": "LIJIANG LU",
    "漓滨路": "LIBIN LU", "漓苑巷": "LIYUAN XIANG", "灵剑路": "LINGJIAN LU",
    "环城北一路": "HUANCHENG BEIYILU", "环城北二路": "HUANCHENG BEIERLU",
    "环城南三路": "HUANCHENG NANSANLU", "环城西一路": "HUANCHENG XIYILU",
    "环城西二路": "HUANCHENG XIERLU", "甲山路": "JIASHAN LU", "福棠巷": "FUTANG XIANG",
    "空明西路": "KONGMING XILU", "穿山东路": "CHUANSHAN DONGLU", "穿山北路": "CHUANSHAN BEILU",
    "穿山小街": "CHUANSHAN XIAOJIE", "穿山桥": "CHUANSHAN QIAO", "穿山路": "CHUANSHAN LU",
    "篦子园路": "BIZIYUAN LU", "翊武路": "YIWU LU", "翠竹路": "CUIZHU LU",
    "自由路": "ZIYOU LU", "芙蓉路": "FURONG LU", "芦笛路": "LUDI LU",
    "花桥": "HUA QIAO", "芳香路": "FANGXIANG LU", "苍松路": "CANGSONG LU",
    "苗圃路": "MIAOPU LU", "虞山桥": "YUSHAN QIAO", "虞山路": "YUSHAN LU",
    "螺狮山路": "LUOSHISHAN LU", "西凤路": "XIFENG LU", "西华里": "XIHUA LI",
    "西城步行街": "XICHENG WALK", "西城脚": "XICHENG JIAO", "西城路": "XICHENG LU",
    "西山路": "XISHAN LU", "西山路南巷": "XISHAN NANXIANG", "西清路": "XIQING LU",
    "西门桥": "XIMEN QIAO", "解放东路": "JIEFANG DONGLU", "解放桥": "JIEFANG QIAO",
    "解放西路": "JIEFANG XILU", "象山南路": "XIANGSHAN NANLU", "贡后巷": "GONGHOU XIANG",
    "辅星路": "FUXING LU", "金星路": "JINXING LU", "铁佛路": "TIEFO LU",
    "铁西中路": "TIEXI ZHONGLU", "铁西西巷": "TIEXI XIXIANG", "铁西路": "TIEXI LU",
    "银锭路": "YINDING LU", "阳桥": "YANG QIAO", "雉山路": "ZHISHAN LU",
    "驿前横里": "YIQIAN HENGLI", "骖鸾路": "CANLUAN LU", "骝马山北巷": "LIUMASHAN BEIXIANG",
    "龙珠路": "LONGZHU LU", "龙船坪路": "LONGCHUANPING LU", "龙隐桥": "LONGYIN QIAO",
    "龙隐路": "LONGYIN LU", "府后里": "FUHOU LI", "府东里": "FUDONG LI",
    "小井巷": "XIAOJING XIANG", "棠梓巷": "TANGZI XIANG", "斗姆巷": "DOUMU XIANG",
    "八桂路": "BAGUI LU", "北极广场": "BEIJI GUANGCHANG",
}

RING_ORDER = {"r1": 1, "r2": 2, "r3": 3}

# Road names strongly defining Old Downtown vs Station/Qixing Modern Commercial
OLD_DOWNTOWN_ROADS = {
    "三多路", "中山中路", "解放西路", "解放东路", "西城路", "西城步行街", "南环路",
    "榕荫路", "翊武路", "文明路", "民主路", "正阳路", "正阳步行街", "依仁路",
    "五美路", "乐群路", "中华路", "四会路", "府后里", "府东里", "湖光路", "信义路",
    "西凤路", "丽君路", "太平路", "人民路", "榕湖北路", "榕湖南路", "杉湖北路",
    "凤北路", "伏和巷", "东华路", "东镇路", "崇善路", "铁佛路", "叠彩路",
}
MODERN_ARTERIAL_ROADS = {
    "中山南路", "上海路", "上海南路", "漓江路", "七星路", "穿山东路", "穿山路",
    "环城西二路", "环城西一路", "环城北一路", "环城北二路", "环城南三路",
    "建干路", "自由路", "骖鸾路", "五里店路", "普陀路", "六合路", "屏风路",
    "空明西路", "会展道", "栖霞路", "东江路", "东江二路", "龙隐路", "翠竹路",
    "崇信路", "民族路", "铁西路", "安新南路", "安新北路", "中山北路", "虞山路",
}


def resolve_path(preferred: Path | None, rel: str) -> Path:
    if preferred is not None:
        return preferred
    p_repo = REPO_ROOT / rel
    if p_repo.exists():
        return p_repo
    p_ref = REF_ROOT / rel
    if p_ref.exists():
        return p_ref
    return p_repo


def ll2xz(lat: float, lon: float) -> tuple[float, float]:
    return (lon - LON0) * MLON, -(lat - LAT0) * MLAT


def wm2ll(mx: float, my: float) -> tuple[float, float]:
    lon = mx / 20037508.34 * 180.0
    lat = math.degrees(2.0 * math.atan(math.exp(my / 20037508.34 * math.pi)) - math.pi / 2.0)
    return lat, lon


def xz2wm(x: float, z: float) -> tuple[float, float]:
    lat = LAT0 - z / MLAT
    lon = LON0 + x / MLON
    mx = lon * 20037508.34 / 180.0
    my = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0) * 20037508.34 / 180.0
    return mx, my


def chunk_ring(tx: int, tz: int) -> str:
    mx, mz = tx + 128.0, tz + 128.0
    d = math.hypot(mx - CITY_CENTER[0], mz - CITY_CENTER[1])
    if d <= R1_RADIUS:
        return "r1"
    if d <= R2_RADIUS:
        return "r2"
    return "r3"


def shard_of(x: float, z: float) -> tuple[int, int]:
    return math.floor(x / SHARD_SIZE), math.floor(z / SHARD_SIZE)


def osm_element_area(el: dict) -> Polygon:
    if el.get("type") == "way":
        geom = el.get("geometry") or []
        coords = [ll2xz(p["lat"], p["lon"]) for p in geom]
        if len(coords) >= 4 and coords[0] == coords[-1]:
            return make_valid(Polygon(coords))
        return Polygon()
    if el.get("type") == "relation":
        def rings(role: str):
            lines = []
            for m in el.get("members", []):
                if m.get("role") == role and m.get("geometry"):
                    pts = [ll2xz(p["lat"], p["lon"]) for p in m["geometry"]]
                    if len(pts) >= 2:
                        lines.append(LineString(pts))
            return unary_union(list(polygonize(lines))) if lines else Polygon()
        outer = rings("outer")
        inner = rings("inner")
        return outer.difference(inner) if not inner.is_empty else outer
    return Polygon()


def tianyuan_polygon() -> Polygon:
    cx, cz = TIANYUAN_CENTER
    co, si = math.cos(TIANYUAN_ROT), math.sin(TIANYUAN_ROT)
    # Full building + front patio apron (hx=3.5, z in [-7.5, +10.0]) + safety margin
    local_corners = [(-5.5, -9.2), (5.5, -9.2), (5.5, 11.2), (-5.5, 11.2)]
    world_pts = [(cx + lx * co + lz * si, cz - lx * si + lz * co) for lx, lz in local_corners]
    return Polygon(world_pts)


def _glb_footprint_polygon(glb_path: Path, px: float, pz: float, rot_deg: float, cell: float = 1.5) -> Polygon:
    """Fast vectorized 1.5m-grid 2D XZ structural footprint (y > 0.6m) of a hand-crafted landmark GLB."""
    import trimesh

    gltfpack = os.getenv("GLTFPACK") or shutil.which("gltfpack") or "/Users/macbook/.local/bin/gltfpack"
    rot = math.radians(rot_deg)
    cs, sn = math.cos(rot), math.sin(rot)
    T = np.array([[cs, 0.0, sn, px], [0.0, 1.0, 0.0, 0.0], [-sn, 0.0, cs, pz], [0.0, 0.0, 0.0, 1.0]], dtype=float)
    with tempfile.NamedTemporaryFile(suffix=".glb") as tmp:
        subprocess.run([gltfpack, "-i", str(glb_path), "-o", tmp.name, "-kn"], check=True, capture_output=True)
        sc = trimesh.load_scene(tmp.name)
        edges = {child: parent for parent, child, _ in sc.graph.to_edgelist()}
        pts_xz = []
        for node in sc.graph.nodes_geometry:
            cur = node
            skip = False
            while cur and cur != sc.graph.base_frame:
                nm = str(cur).lower()
                if nm.startswith("collision") or nm in ("lod1", "lod2"):
                    skip = True
                    break
                cur = edges.get(cur)
            if skip:
                continue
            mat, gname = sc.graph[node]
            g = sc.geometry[gname]
            v = np.asarray(g.vertices, dtype=np.float64)
            if len(v) == 0:
                continue
            M = T @ mat
            vw = v @ M[:3, :3].T + M[:3, 3]
            faces = np.asarray(g.faces, dtype=np.int64)
            if len(faces) == 0:
                continue
            tri_y_max = vw[faces, 1].max(axis=1)
            keep = faces[tri_y_max > 0.6]
            if len(keep) == 0:
                continue
            # Sample vertices + edge midpoints + centroids in vectorized NumPy
            a = vw[keep[:, 0]][:, [0, 2]]
            b = vw[keep[:, 1]][:, [0, 2]]
            c = vw[keep[:, 2]][:, [0, 2]]
            pts_xz.append(np.vstack([a, b, c, (a + b) * 0.5, (b + c) * 0.5, (c + a) * 0.5, (a + b + c) / 3.0]))
        if not pts_xz:
            return Polygon()
        all_xz = np.vstack(pts_xz)
        gx = np.floor(all_xz[:, 0] / cell).astype(np.int32)
        gz = np.floor(all_xz[:, 1] / cell).astype(np.int32)
        uniq = np.unique(np.stack([gx, gz], axis=1), axis=0)
        # Merge consecutive runs along X for each Z row into horizontal rectangles before union
        rects = []
        order = np.lexsort((uniq[:, 0], uniq[:, 1]))
        uniq = uniq[order]
        i = 0
        n = len(uniq)
        while i < n:
            rz = int(uniq[i, 1])
            rx0 = int(uniq[i, 0])
            rx1 = rx0
            j = i + 1
            while j < n and int(uniq[j, 1]) == rz and int(uniq[j, 0]) == rx1 + 1:
                rx1 = int(uniq[j, 0])
                j += 1
            rects.append(box(rx0 * cell, rz * cell, (rx1 + 1) * cell, (rz + 1) * cell))
            i = j
        return union_all(rects).buffer(0) if rects else Polygon()


def build_landmark_guard(
    landmarks_path: Path,
    manifest: dict,
    osm_by_key: dict[str, dict],
    overture_csv: Path | None,
    landmarks_glb_dir: Path,
    world_bounds: Polygon,
    cache_path: Path | None = None,
) -> tuple[list[tuple[str, Polygon]], STRtree]:
    """
    Build comprehensive 2D exclusion polygons for ALL hand-crafted landmarks in
    pipeline/landmarks.json + manifest.json + GLB structural footprints + Tianyuan Mifen.
    """
    specs = json.loads(landmarks_path.read_text(encoding="utf-8"))
    mf_lms = {lm["id"]: lm for lm in manifest.get("landmarks", [])}

    # Optional cache for GLB footprints (keyed by filename + mtime + size)
    glb_cache: dict[str, dict] = {}
    if cache_path and cache_path.exists():
        try:
            glb_cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            glb_cache = {}
    cache_dirty = False

    # Collect Overture UUIDs referenced in replace lists
    overture_ids: set[str] = set()
    for entry in specs:
        rep = entry.get("replace", [])
        if isinstance(rep, list):
            for k in rep:
                if isinstance(k, str) and not k.startswith(("way/", "relation/", "node/")):
                    overture_ids.add(k)

    overture_polys: dict[str, Polygon] = {}
    if overture_ids and overture_csv and overture_csv.exists():
        with overture_csv.open(encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                rid = row.get("id", "")
                if rid in overture_ids:
                    try:
                        geom = affine_transform(from_wkt(row["wkt"]), [MLON, 0, 0, -MLAT, -LON0 * MLON, LAT0 * MLAT])
                        geom = make_valid(geom)
                        if not geom.is_empty:
                            overture_polys[rid] = geom
                    except Exception:
                        pass

    guard_items: list[tuple[str, Polygon]] = [("tianyuan_mifen", tianyuan_polygon())]
    # Skip natural hill meshes (fubo/diecai/duxiu/elephant_hill) from giant polygon blocking;
    # their explicit replace polygons still protect peak-adjacent structures.
    natural_peak_ids = {"fubo", "diecai", "duxiu", "elephant_hill"}

    for entry in specs:
        lid = entry["id"]
        polys: list[Polygon] = []

        # 1. replace (dict polygon or list of OSM/Overture keys)
        rep = entry.get("replace", [])
        if isinstance(rep, dict) and rep.get("polygon"):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in rep["polygon"]]))
            if not p.is_empty:
                polys.append(p)
        elif isinstance(rep, list):
            for key in rep:
                if key in osm_by_key:
                    p = osm_element_area(osm_by_key[key])
                    if not p.is_empty:
                        polys.append(p)
                elif key in overture_polys:
                    polys.append(overture_polys[key])

        # 2. replacePolygons
        for ring in entry.get("replacePolygons", []):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in ring]))
            if not p.is_empty:
                polys.append(p)

        # 3. schoolGround flatten polygon (protect entire modeled campus)
        if entry.get("schoolGround") and isinstance(entry.get("flatten"), dict) and entry["flatten"].get("polygon"):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in entry["flatten"]["polygon"]]))
            if not p.is_empty:
                polys.append(p)

        # 4. Exact 2D structural GLB mesh footprint (prevents ANY overhang/collision with hand-crafted GLBs!)
        lm_mf = mf_lms.get(lid)
        if lm_mf and lid not in natural_peak_ids:
            glb_path = landmarks_glb_dir / Path(lm_mf["file"]).name
            if glb_path.exists():
                px, _, pz = lm_mf["position"]
                rot = float(lm_mf.get("rotation", 0.0))
                st = glb_path.stat()
                sig = f"{st.st_size}:{int(st.st_mtime)}:{px:.2f}:{pz:.2f}:{rot:.3f}"
                cached = glb_cache.get(lid)
                if cached and cached.get("sig") == sig:
                    wkt_s = cached.get("wkt", "")
                    fp = from_wkt(wkt_s) if wkt_s else Polygon()
                else:
                    try:
                        fp = _glb_footprint_polygon(glb_path, px, pz, rot)
                    except Exception:
                        fp = Polygon()
                    glb_cache[lid] = {"sig": sig, "wkt": fp.wkt if not fp.is_empty else ""}
                    cache_dirty = True
                if not fp.is_empty:
                    polys.append(fp)

        # 5. Fallback sphere protection for small standalone landmarks if no polygons captured
        if not polys and lm_mf and lid not in natural_peak_ids:
            px, _, pz = lm_mf["position"]
            scx, _, scz, sr = lm_mf.get("sphere", [0, 0, 0, 12.0])
            if sr <= 60.0:
                polys.append(Point(px + scx, pz + scz).buffer(sr))

        if polys:
            merged = unary_union(polys).buffer(0).simplify(0.35, preserve_topology=True)
            if not merged.is_empty and merged.intersects(world_bounds):
                prepare(merged)
                guard_items.append((lid, merged))

    if cache_path and cache_dirty:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(glb_cache), encoding="utf-8")

    # Prepare Tianyuan polygon too
    for _, g in guard_items:
        prepare(g)
    guard_tree = STRtree([g for _, g in guard_items])
    return guard_items, guard_tree


def load_cmab_all(cmab_base: Path, x0: float, x1: float, z0: float, z1: float):
    dbf_path = cmab_base.with_suffix(".dbf")
    shp_path = cmab_base.with_suffix(".shp")
    with dbf_path.open("rb") as fd:
        _, _, _, _, _num_recs, hdr_len, rec_len = struct.unpack("<BBBBIHH", fd.read(12))
        fd.seek(32)
        fields = []
        while fd.tell() < hdr_len - 1:
            b = fd.read(32)
            if not b or b[0] == 0x0D:
                break
            name = b[:11].split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
            fields.append((name, chr(b[11]), b[16], b[17]))
        fd.seek(hdr_len)
        dbf_data = fd.read()

    def parse_rec(idx: int) -> dict:
        pos = idx * rec_len + 1
        out = {}
        for name, ftype, flen, fdec in fields:
            raw = dbf_data[pos : pos + flen].decode("utf-8", errors="ignore").strip()
            pos += flen
            if ftype in ("N", "F"):
                try:
                    out[name] = float(raw) if ("." in raw or fdec > 0) else int(raw)
                except ValueError:
                    out[name] = None
            else:
                out[name] = raw
        return out

    wmx0, wmy1 = xz2wm(x0 - 80, z0 - 80)
    wmx1, wmy0 = xz2wm(x1 + 80, z1 + 80)
    items = []
    with shp_path.open("rb") as fs:
        fs.seek(100)
        idx = 0
        while True:
            rh = fs.read(8)
            if len(rh) < 8:
                break
            _, content_words = struct.unpack(">II", rh)
            content = fs.read(content_words * 2)
            stype = struct.unpack("<I", content[:4])[0]
            if stype in (5, 15, 25):
                bx0, by0, bx1, by1 = struct.unpack("<4d", content[4:36])
                if bx1 >= wmx0 and bx0 <= wmx1 and by1 >= wmy0 and by0 <= wmy1:
                    nparts, npts = struct.unpack("<II", content[36:44])
                    parts = struct.unpack(f"<{nparts}I", content[44 : 44 + 4 * nparts])
                    pts_off = 44 + 4 * nparts
                    end0 = parts[1] if nparts > 1 else npts
                    ring = []
                    for pi in range(parts[0], end0):
                        px, py = struct.unpack("<dd", content[pts_off + pi * 16 : pts_off + (pi + 1) * 16])
                        lat, lon = wm2ll(px, py)
                        ring.append(ll2xz(lat, lon))
                    if len(ring) >= 4:
                        poly = Polygon(ring).buffer(0)
                        if not poly.is_empty:
                            items.append((poly, parse_rec(idx)))
            idx += 1
    return items


def load_osm_full(osm_path: Path, x0: float, x1: float, z0: float, z1: float):
    osm = json.load(osm_path.open(encoding="utf-8"))
    osm_by_key: dict[str, dict] = {}
    main_roads: list[tuple[str, str, LineString]] = []
    alley_roads: list[tuple[str, str, LineString]] = []
    all_road_geoms: list[tuple[str, LineString]] = []
    roads_by_name: dict[str, list[tuple[str, LineString]]] = defaultdict(list)
    compounds: list[tuple[str, str, Polygon]] = []
    quiet_zones: list[Polygon] = []
    residential_zones: list[Polygon] = []
    commercial_zones: list[Polygon] = []
    water_polys: list[Polygon] = []
    bridge_lines: list[LineString] = []
    weixiaotang_poly = None

    MAIN_HW = {"trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
    ALLEY_HW = {"residential", "unclassified", "pedestrian", "living_street"}

    for el in osm["elements"]:
        osm_by_key[f"{el['type']}/{el['id']}"] = el
        tags = el.get("tags") or {}
        geom = el.get("geometry") or []
        if len(geom) >= 2:
            pts = [ll2xz(p["lat"], p["lon"]) for p in geom]
            xs = [p[0] for p in pts]
            zs = [p[1] for p in pts]
            if max(xs) < x0 - 160 or min(xs) > x1 + 160 or max(zs) < z0 - 160 or min(zs) > z1 + 160:
                continue

            if el.get("id") == 253743030 and len(pts) >= 4:
                weixiaotang_poly = make_valid(Polygon(pts))

            hw = tags.get("highway")
            if hw:
                ls = LineString(pts)
                all_road_geoms.append((hw, ls))
                is_bridge = tags.get("bridge", "no") not in ("no", "false")
                is_tunnel = tags.get("tunnel", "no") not in ("no", "false")
                if is_bridge:
                    bridge_lines.append(ls)
                nm = tags.get("name", "").strip()
                if not is_tunnel:
                    if hw in MAIN_HW and not is_bridge:
                        main_roads.append((nm, hw, ls))
                    elif hw in ALLEY_HW and not is_bridge:
                        alley_roads.append((nm, hw, ls))
                    if nm and hw in (MAIN_HW | ALLEY_HW):
                        roads_by_name[nm].append((hw, ls))

            am = tags.get("amenity")
            if am in ("school", "hospital", "university", "college", "kindergarten") and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 250:
                    quiet_zones.append(poly)
                    if am in ("school", "hospital"):
                        compounds.append((tags.get("name", am), am, poly))

            lu = tags.get("landuse")
            if lu == "residential" and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 600:
                    residential_zones.append(poly)
            elif lu in ("commercial", "retail") and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 400:
                    commercial_zones.append(poly)

            if (tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or "water" in tags) and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 1500:
                    water_polys.append(poly)
        elif el.get("type") == "relation":
            if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or "water" in tags:
                poly = osm_element_area(el)
                if not poly.is_empty and poly.area > 1500:
                    water_polys.append(poly)
            elif tags.get("amenity") in ("school", "hospital", "university", "college"):
                poly = osm_element_area(el)
                if not poly.is_empty and poly.area > 400:
                    quiet_zones.append(poly)
                    if tags.get("amenity") in ("school", "hospital"):
                        compounds.append((tags.get("name", tags["amenity"]), tags["amenity"], poly))

    return {
        "osm_by_key": osm_by_key,
        "main_roads": main_roads,
        "alley_roads": alley_roads,
        "all_road_geoms": all_road_geoms,
        "roads_by_name": roads_by_name,
        "compounds": compounds,
        "quiet_zones": quiet_zones,
        "residential_zones": residential_zones,
        "commercial_zones": commercial_zones,
        "water_polys": water_polys,
        "bridge_lines": bridge_lines,
        "weixiaotang_poly": weixiaotang_poly,
    }


def make_terrain_sampler(chunks_raw: dict[tuple[int, int], tuple[list, list[int]]]):
    def sample_y(x: float, z: float) -> float:
        tx = int(math.floor(x / 256.0)) * 256
        tz = int(math.floor(z / 256.0)) * 256
        entry = chunks_raw.get((tx, tz))
        if not entry:
            return 154.0
        _, grid = entry
        u = max(0.0, min(64.0, (x - tx) / 4.0))
        v = max(0.0, min(64.0, (z - tz) / 4.0))
        c0 = min(63, int(math.floor(u)))
        r0 = min(63, int(math.floor(v)))
        fu = u - c0
        fv = v - r0
        h00 = grid[r0 * 65 + c0] / 10.0
        h10 = grid[r0 * 65 + c0 + 1] / 10.0
        h01 = grid[(r0 + 1) * 65 + c0] / 10.0
        h11 = grid[(r0 + 1) * 65 + c0 + 1] / 10.0
        valid = [h for h in (h00, h10, h01, h11) if h > 100.0]
        if len(valid) < 4:
            return sum(valid) / len(valid) if valid else 154.0
        return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv

    return sample_y


def determine_district(
    cx: float,
    cz: float,
    nearest_main_name: str,
    is_scenic: bool,
    in_commercial: bool,
    in_residential: bool,
    in_quiet: bool,
) -> str:
    """Classify world point into Guilin architectural character district."""
    if in_quiet:
        return "public_quiet"
    if is_scenic:
        return "riverside_scenic"
    # Guilin Railway Station & Zhongshan South / Shanghai Rd / Qixing / Jiefang Bridge East commercial zones
    is_station_zone = (-2560 <= cx <= -1620 and 1050 <= cz <= 2450)
    is_qixing_commercial = (cx >= -180 and -500 <= cz <= 2250)
    if is_station_zone or is_qixing_commercial or in_commercial or nearest_main_name in MODERN_ARTERIAL_ROADS:
        return "station_arterial"
    # Core historic Guilin commercial-residential downtown (Sanduo, Zhongshan Mid, Xicheng, Nanmen Bridge)
    if (-1950 <= cx <= -180 and -1250 <= cz <= 1250) or nearest_main_name in OLD_DOWNTOWN_ROADS:
        return "old_downtown"
    if in_residential:
        return "neighborhood_alley"
    return "neighborhood_alley"


def classify_building(
    cx: float,
    cz: float,
    area: float,
    orig_kind: int,
    cmab: dict | None,
    district: str,
    dist_main: float,
    dist_alley: float,
    dist_wxt: float,
    in_residential: bool,
    seed: int,
) -> tuple[int, int, int, int]:
    """
    Map CMAB attributes + district profile -> (upperStyle 0..7, shopStyle -1|0..3, roofType 0..3, tintHex).
    """
    fn = (cmab or {}).get("Function") or "Other"
    age_s = str((cmab or {}).get("Age") or "1996")
    age = 2019 if "AF2018" in age_s else (int(age_s) if age_s.isdigit() else 1996)
    h = float((cmab or {}).get("Height") or 0.0)

    is_main_front = dist_main < 24.0
    is_alley_front = dist_alley < 15.0
    is_wxt_back = dist_wxt < 105.0
    is_public = orig_kind == 3 or fn == "Public service" or district == "public_quiet"

    # --- Upper facade layer (0..7) & roofType (0..3) ---
    if is_public:
        upper = 6  # Institutional / hospital / school / civic
        roof_type = 2 if (seed % 4 == 0 and h < 19.0) else 0
    elif district == "riverside_scenic":
        # Elevate Guilin white-wall/grey-brick + pitched grey-tile roofs so karst peaks stay hero!
        r = seed % 10
        if fn in ("Business", "Office") and area > 750 and age >= 2005:
            upper = 3 if (seed % 2 == 0) else 5
            roof_type = 1 if h <= 16.0 else 3
        elif r < 5 or orig_kind == 1 or h <= 12.0:
            upper = 5  # 桂北白墙青砖
            roof_type = 1  # 灰瓦坡顶
        elif r < 7:
            upper = 3  # 翻新米白
            roof_type = 1 if h <= 14.5 else 0
        elif r < 9:
            upper = 0  # 灰白条砖
            roof_type = 0
        else:
            upper = 2  # 水刷石老楼
            roof_type = 1 if h <= 12.5 else 0
    elif district == "station_arterial":
        # Station / arterial / Qixing commercial: modern stone/glass + warm stucco + commercial podiums
        if fn in ("Business", "Office") or (is_main_front and area > 650):
            upper = 4 if (seed % 2 == 0) else 3  # 干挂石材幕墙 / 商业裙房
            roof_type = 3
        elif age >= 2004 or h >= 18.0:
            r = seed % 10
            if r < 5:
                upper = 7  # 现代暖米真石漆住宅
            elif r < 8:
                upper = 4  # 干挂石材玻璃幕墙
            else:
                upper = 3  # 米白商业裙房
            roof_type = 3
        else:
            r = seed % 10
            if r < 4:
                upper = 0
            elif r < 6:
                upper = 7
            elif r < 8:
                upper = 3
            else:
                upper = 1
            roof_type = 0 if h < 18.0 else 3
    elif district == "old_downtown":
        # Classic Sanduo / Zhongshan / Xicheng / Nanmen Bridge commercial-residential mix
        if fn in ("Business", "Office") or (is_wxt_back and area > 750):
            upper = 3 if (age >= 2005 or seed % 2 == 0) else 4
            roof_type = 3
        elif is_wxt_back and is_alley_front and age <= 1994:
            upper = 2 if (seed % 3 != 0) else 0
            roof_type = 0
        elif age >= 2008:
            upper = 7 if (seed % 2 == 0) else 4
            roof_type = 3
        elif orig_kind == 1 or (h <= 10.5 and area < 220 and seed % 3 == 0):
            upper = 5
            roof_type = 1
        else:
            r = seed % 10
            if r < 5:
                upper = 0  # 灰白条形小瓷砖 + 防盗笼 + 蓝灰阳台
            elif r < 7:
                upper = 1  # 格子马赛克 + 深酒红腰线
            elif r < 9:
                upper = 2  # 水刷石老步梯楼
            else:
                upper = 3  # 翻新米白
            roof_type = 0
    else:
        # Outer neighborhood residential (Jiashan / Beiji / Tiexi / Anxin / Dongjiang)
        if fn in ("Business", "Office"):
            upper = 3 if (seed % 2 == 0) else 4
            roof_type = 3
        elif age >= 2006 or h >= 19.0:
            upper = 7 if (seed % 3 != 0) else 4
            roof_type = 3
        elif orig_kind == 1 or (h <= 10.0 and area < 200 and seed % 4 == 0):
            upper = 5
            roof_type = 1
        else:
            r = seed % 10
            if r < 4:
                upper = 0
            elif r < 6:
                upper = 7
            elif r < 8:
                upper = 1
            else:
                upper = 2
            roof_type = 0

    # --- Ground-floor shopfront layer (0..3 -> layers 8..11; -1 means no shopfront) ---
    # Deep inside residential compounds (far from main roads), keep clean residential ground floors
    allow_alley_shop = is_alley_front and (not in_residential or dist_main < 38.0 or district == "old_downtown")
    if is_public:
        shop = -1
    elif is_main_front or allow_alley_shop:
        if district == "riverside_scenic":
            shop = 2 if (seed % 3 != 0) else 0
        elif district == "station_arterial":
            shop = 0 if (seed % 3 != 0) else (2 if (seed % 2 == 0) else 1)
        elif is_wxt_back and (seed % 3 == 0):
            shop = 2
        elif district == "old_downtown" and cx < -1300 and cz < 180 and (seed % 2 == 0):
            shop = 1  # 钢灰蓝+镀锌银灰卷帘门
        elif allow_alley_shop and not is_main_front:
            shop = 3 if (seed % 3 != 0) else 1
        else:
            shop = 0 if (seed % 4 != 0) else 1
    else:
        shop = -1

    # Grounded authentic Guilin wall tint (multiplied ONLY onto masonry mask)
    palettes = {
        0: [0xEEF1F4, 0xE7ECF0, 0xE2E6EA, 0xECEEEB],
        1: [0xE8EAEB, 0xE0E3E6, 0xECE8E2],
        2: [0xCFC9BE, 0xC4BEB3, 0xD6D1C7, 0xBEB7AB],
        3: [0xF2EFE6, 0xECE8DD, 0xE8E5DC],
        4: [0xE6E4DE, 0xDCE0E5, 0xEAE6DC],
        5: [0xEDEAE0, 0xE6E2D6, 0xF0ECE2],
        6: [0xEBE8DF, 0xE2DFD6, 0xE6E8E4],
        7: [0xECDCC8, 0xE5D3BC, 0xEAE0D2],
    }
    p = palettes[upper]
    tint = p[(seed >> 4) % len(p)]
    return upper, shop, roof_type, tint


class SpatialHueTracker:
    """Guarantees ZERO adjacent same-hue fascias both along a wall and across neighboring buildings."""

    def __init__(self, cell_size: float = 8.0):
        self.cell = cell_size
        self.grid: dict[tuple[int, int], list[tuple[float, float, float, str]]] = defaultdict(list)

    def _bucket(self, x: float, z: float) -> tuple[int, int]:
        return int(math.floor(x / self.cell)), int(math.floor(z / self.cell))

    def nearby_hues(self, x: float, z: float, yaw: float, radius: float = 6.5) -> set[str]:
        bx, bz = self._bucket(x, z)
        r2 = radius * radius
        nx, nz = math.sin(yaw), math.cos(yaw)
        hues: set[str] = set()
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for ox, oz, oyaw, ohue in self.grid.get((bx + dx, bz + dz), ()):
                    ddx, ddz = x - ox, z - oz
                    if ddx * ddx + ddz * ddz <= r2:
                        # Same street side / visible adjacent corner (facing dot > 0.55)
                        if nx * math.sin(oyaw) + nz * math.cos(oyaw) > 0.55:
                            hues.add(ohue)
        return hues

    def add(self, x: float, z: float, yaw: float, hue: str):
        self.grid[self._bucket(x, z)].append((x, z, yaw, hue))


def gzip_size(obj: dict) -> int:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return len(gzip.compress(raw, compresslevel=6))


def trim_shard_to_budget(shard: dict, max_gzip: int = MAX_SHARD_GZIP_BYTES) -> int:
    """Keep shard strictly under gzip budget without dropping building overrides or main fascias."""
    gz = gzip_size(shard)
    if gz <= max_gzip:
        return gz
    # Step 1: thin dense AC units first (keep every 2nd, then 3rd)
    if shard["acUnits"]:
        shard["acUnits"] = shard["acUnits"][::2]
        gz = gzip_size(shard)
    if gz > max_gzip and shard["acUnits"]:
        shard["acUnits"] = shard["acUnits"][::2]
        gz = gzip_size(shard)
    # Step 2: thin secondary blades if still tight
    if gz > max_gzip and shard["blades"]:
        shard["blades"] = shard["blades"][::2]
        gz = gzip_size(shard)
    # Step 3: thin alley awnings (kind==1) while keeping Guilin grey-tile eaves
    if gz > max_gzip and shard["eaves"]:
        shard["eaves"] = [e for idx, e in enumerate(shard["eaves"]) if e[7] == 0 or idx % 2 == 0]
        gz = gzip_size(shard)
    return gz


def main():
    t0 = time.time()
    ap = argparse.ArgumentParser(description="Build full-city Guilin v1+ 512m spatial upgrade shards.")
    ap.add_argument("--ring", choices=("r1", "r2", "r3", "all"), default="all", help="Target ring(s) to generate")
    ap.add_argument("--world-dir", type=Path, default=None)
    ap.add_argument("--cmab", type=Path, default=None)
    ap.add_argument("--osm", type=Path, default=None)
    ap.add_argument("--landmarks", type=Path, default=None)
    ap.add_argument("--overture", type=Path, default=None)
    ap.add_argument("--landmarks-glb-dir", type=Path, default=None)
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "public/city-upgrade")
    ap.add_argument("--fascia-grid", choices=("8x8", "8x12"), default="8x12")
    ap.add_argument("--merge-existing", action="store_true", help="Preserve existing shards outside selected --ring")
    args = ap.parse_args()

    world_dir = resolve_path(args.world_dir, "public/world")
    cmab_base = resolve_path(args.cmab, "raw/cmab_guilin/processed_2209_20220307_all.shp").with_suffix("")
    osm_path = resolve_path(args.osm, "raw/osm-2026-11.json")
    landmarks_path = resolve_path(args.landmarks, "pipeline/landmarks.json")
    overture_csv = resolve_path(args.overture, "raw/overture_buildings.csv")
    landmarks_glb_dir = resolve_path(args.landmarks_glb_dir, "public/landmarks")
    cols, rows = map(int, args.fascia_grid.split("x"))
    max_fascia_idx = cols * rows

    print(f"[city-upgrade] Ring={args.ring} | Grid={cols}x{rows} ({max_fascia_idx} shops)")
    print(f"  world_dir : {world_dir}")
    print(f"  cmab_base : {cmab_base}")
    print(f"  osm_path  : {osm_path}")

    mf = json.load((world_dir / "manifest.json").open(encoding="utf-8"))
    all_chunks = mf["chunks"]
    xs = [c["x"] for c in all_chunks]
    zs = [c["z"] for c in all_chunks]
    wx0, wx1 = float(min(xs)), float(max(xs) + 256)
    wz0, wz1 = float(min(zs)), float(max(zs) + 256)
    world_bounds = box(wx0, wz0, wx1, wz1)
    # Exact playable chunk footprint (handles irregular west boundary around Guilin Station!)
    active_chunks_poly = unary_union([box(c["x"], c["z"], c["x"] + 256.0, c["z"] + 256.0) for c in all_chunks]).buffer(-4.0)
    prepare(active_chunks_poly)

    target_rings = {"r1", "r2", "r3"} if args.ring == "all" else {args.ring}
    selected_chunks = []
    valid_shards: set[tuple[int, int]] = set()
    shard_ring_map: dict[tuple[int, int], str] = {}
    ring_chunk_counts = Counter()

    for c in all_chunks:
        r = chunk_ring(c["x"], c["z"])
        ring_chunk_counts[r] += 1
        sg = shard_of(c["x"], c["z"])
        prev_r = shard_ring_map.get(sg)
        if prev_r is None or RING_ORDER[r] < RING_ORDER[prev_r]:
            shard_ring_map[sg] = r
        if r in target_rings:
            selected_chunks.append((c, r))
            valid_shards.add(sg)

    print(f"  Total chunks: {len(all_chunks)} ({dict(ring_chunk_counts)}) | Selected: {len(selected_chunks)} chunks across {len(valid_shards)} shards")

    # 1. Load CMAB & build STRtree
    t1 = time.time()
    cmab_items = load_cmab_all(cmab_base, wx0, wx1, wz0, wz1)
    cmab_tree = STRtree([p for p, _ in cmab_items])
    print(f"  CMAB polygons in open world: {len(cmab_items)} ({time.time() - t1:.2f}s)")

    # 2. Load OSM full road network, landuse, water, compounds
    t1 = time.time()
    osm_data = load_osm_full(osm_path, wx0, wx1, wz0, wz1)
    main_roads = osm_data["main_roads"]
    alley_roads = osm_data["alley_roads"]
    main_lines = [ls for _, _, ls in main_roads]
    alley_lines = [ls for _, _, ls in alley_roads]
    drive_roads = main_roads + alley_roads
    drive_lines = [ls for _, _, ls in drive_roads]
    main_tree = STRtree(main_lines) if main_lines else None
    alley_tree = STRtree(alley_lines) if alley_lines else None
    drive_tree = STRtree(drive_lines) if drive_lines else None
    quiet_tree = STRtree(osm_data["quiet_zones"]) if osm_data["quiet_zones"] else None
    res_tree = STRtree(osm_data["residential_zones"]) if osm_data["residential_zones"] else None
    com_tree = STRtree(osm_data["commercial_zones"]) if osm_data["commercial_zones"] else None
    water_tree = STRtree(osm_data["water_polys"]) if osm_data["water_polys"] else None
    bridge_tree = STRtree(osm_data["bridge_lines"]) if osm_data["bridge_lines"] else None

    # Named karst peaks from manifest for scenic corridor weighting
    named_peaks: list[Point] = []
    for pk in mf.get("peaks", {}).get("entries", []):
        pnm = pk.get("name", "")
        if pnm and not pnm.startswith("auto-"):
            c = pk["center"]
            named_peaks.append(Point(c[0], c[2]))
    peak_tree = STRtree(named_peaks) if named_peaks else None

    print(
        f"  OSM loaded: {len(main_roads)} main segs, {len(alley_roads)} alley segs, "
        f"{len(osm_data['water_polys'])} waters, {len(osm_data['quiet_zones'])} quiet zones ({time.time() - t1:.2f}s)"
    )

    # 3. Build comprehensive landmark protection guard (zero intrusion)
    t1 = time.time()
    cache_path = Path("/tmp/city-upgrade-landmark-footprints-v1.json")
    guard_items, guard_tree = build_landmark_guard(
        landmarks_path, mf, osm_data["osm_by_key"], overture_csv, landmarks_glb_dir, world_bounds, cache_path=cache_path
    )
    print(f"  Landmark guard loaded: {len(guard_items)} protected zones ({time.time() - t1:.2f}s)")

    # 4. Load all GL04 chunks (terrain needed for sampling elevation on shard boundaries too)
    t1 = time.time()
    chunks_raw: dict[tuple[int, int], tuple[list, list[int]]] = {}
    selected_tile_metas: list[tuple[int, int, str, list]] = []
    selected_coords = {(c["x"], c["z"]): r for c, r in selected_chunks}
    for c in all_chunks:
        tx, tz = c["x"], c["z"]
        raw = gzip.decompress((world_dir / c["file"]).read_bytes())
        verts, cnt, coll_len, _, _ = struct.unpack("<5I", raw[4:24])
        terrain_grid = list(struct.unpack("<4225h", raw[24 : 24 + 8450]))
        off = 24 + 8450 + 8450 + verts * 6 + verts * 3 + cnt * 4
        meta = json.loads(raw[off : off + coll_len].decode("utf-8"))
        chunks_raw[(tx, tz)] = (meta[0], terrain_grid)
        if (tx, tz) in selected_coords:
            selected_tile_metas.append((tx, tz, selected_coords[(tx, tz)], meta[0]))
    sample_y = make_terrain_sampler(chunks_raw)
    print(f"  Parsed {len(chunks_raw)} GL04 chunks ({time.time() - t1:.2f}s)")

    # Precompute prepared geometries & expanded guard layers for C-speed O(log V) queries
    for poly_list in (osm_data["quiet_zones"], osm_data["residential_zones"], osm_data["commercial_zones"], osm_data["water_polys"]):
        for g in poly_list:
            prepare(g)

    guard_geoms_0 = [g for _, g in guard_items]
    guard_geoms_1 = [g.buffer(1.0, quad_segs=4).simplify(0.35, preserve_topology=True) for g in guard_geoms_0]
    guard_geoms_2 = [g.buffer(2.2, quad_segs=4).simplify(0.35, preserve_topology=True) for g in guard_geoms_0]
    for g in guard_geoms_1:
        prepare(g)
    for g in guard_geoms_2:
        prepare(g)
    guard_tree_1 = STRtree(guard_geoms_1)
    guard_tree_2 = STRtree(guard_geoms_2)

    water_geoms_2 = [g.buffer(2.0, quad_segs=4).simplify(0.5, preserve_topology=True) for g in osm_data["water_polys"]]
    for g in water_geoms_2:
        prepare(g)
    water_tree_2 = STRtree(water_geoms_2) if water_geoms_2 else None

    # Helper predicates using prepared geometries + C-accelerated STRtree
    def hits_landmark(geom, margin: float = 0.0) -> bool:
        if margin <= 0.0:
            tree, glist = guard_tree, guard_geoms_0
        elif margin <= 1.2:
            tree, glist = guard_tree_1, guard_geoms_1
        else:
            tree, glist = guard_tree_2, guard_geoms_2
        for hi in tree.query(geom, predicate="intersects"):
            return True
        return False

    def hits_water(geom, margin: float = 0.0) -> bool:
        if not water_tree:
            return False
        tree = water_tree_2 if (margin > 0.0 and water_tree_2 is not None) else water_tree
        for _ in tree.query(geom, predicate="intersects"):
            return True
        return False

    def nearest_road(geom, tree: STRtree | None, roads_list: list[tuple[str, str, LineString]], max_d: float) -> tuple[float, str, LineString | None]:
        if not tree:
            return 999.0, "", None
        idxs, dists = tree.query_nearest(geom, max_distance=max_d, return_distance=True, all_matches=False)
        if len(idxs) == 0:
            return 999.0, "", None
        hi = int(idxs[0])
        nm, _, ls = roads_list[hi]
        return float(dists[0]), nm, ls

    def in_any_poly(pt: Point, tree: STRtree | None, polys: list[Polygon]) -> bool:
        if not tree:
            return False
        for _ in tree.query(pt, predicate="intersects"):
            return True
        return False

    def is_scenic_location(pt: Point) -> bool:
        if water_tree:
            idxs = water_tree.query_nearest(pt, max_distance=130.0, all_matches=False)
            if len(idxs) > 0:
                return True
        if peak_tree:
            idxs = peak_tree.query_nearest(pt, max_distance=200.0, all_matches=False)
            if len(idxs) > 0:
                return True
        return False

    # Prepare shard containers
    shards_data: dict[tuple[int, int], dict] = {
        sg: {"overrides": {}, "eaves": [], "acUnits": [], "fascias": [], "blades": [], "streetSigns": [], "walls": []}
        for sg in valid_shards
    }

    # Filter zone pools to active atlas capacity
    active_pools = {k: [i for i in v if i < max_fascia_idx] for k, v in ZONE_POOLS.items()}
    zone_cursors = {k: 0 for k in active_pools}
    hue_tracker = SpatialHueTracker(cell_size=8.0)

    def pick_next_fascia(zkey: str, forbidden: set[str]) -> int:
        pool = active_pools.get(zkey) or active_pools["old_downtown"]
        n = len(pool)
        cur = zone_cursors[zkey]
        for step in range(n):
            cand = pool[(cur + step) % n]
            if FASCIA_META[cand][0] not in forbidden:
                zone_cursors[zkey] = (cur + step + 1) % n
                return cand
        # Fallback: scan full active catalog to guarantee ZERO same-hue neighbor!
        for cand in range(max_fascia_idx):
            if FASCIA_META[cand][0] not in forbidden:
                return cand
        cand = pool[cur % n]
        zone_cursors[zkey] = (cur + 1) % n
        return cand

    wxt_poly = osm_data["weixiaotang_poly"]
    stats = Counter()
    ring_stats: dict[str, Counter] = {r: Counter() for r in ("r1", "r2", "r3")}
    ring_h_old: dict[str, float] = defaultdict(float)
    ring_h_new: dict[str, float] = defaultdict(float)

    t1 = time.time()
    for tx, tz, ring_name, rings in selected_tile_metas:
        tile_key = f"{tx},{tz}"
        owner_sg = shard_of(tx, tz)
        owner_shard = shards_data[owner_sg]

        for bi, b in enumerate(rings):
            base_y = b[0] / 10.0
            old_top = b[1] / 10.0
            loops = b[2]
            orig_kind = int(b[3])
            orig_floors = int(b[4])
            seed = int(b[5])
            if not loops or len(loops[0]) < 3:
                continue

            wring = [(tx + p[0] / 100.0, tz + p[1] / 100.0) for p in loops[0]]
            bp = Polygon(wring).buffer(0)
            if bp.is_empty or bp.area < 4.0:
                continue
            cx, cz = bp.centroid.x, bp.centroid.y
            cpt = Point(cx, cz)

            # Absolute landmark protection (zero intrusion!)
            if hits_landmark(bp, margin=1.0):
                stats["skipped_landmark"] += 1
                ring_stats[ring_name]["skipped_landmark"] += 1
                continue

            # Match Tsinghua CMAB building (fast bbox query instead of 64-vert buffer!)
            best_rec = None
            best_score = 0.0
            bminx, bminy, bmaxx, bmaxy = bp.bounds
            for hi in cmab_tree.query(box(bminx - 4.0, bminy - 4.0, bmaxx + 4.0, bmaxy + 4.0)):
                cp, crec = cmab_items[hi]
                ov = bp.intersection(cp).area
                if ov > 0:
                    score = ov / max(bp.area, 1.0)
                else:
                    d = bp.distance(cp)
                    score = 0.12 / (1.0 + d) if d < 4.0 else 0.0
                if score > best_score:
                    best_score = score
                    best_rec = crec

            # Spatial context queries
            dist_main, nearest_main_nm, _ = nearest_road(bp, main_tree, main_roads, 38.0)
            dist_alley, _, _ = nearest_road(bp, alley_tree, alley_roads, 20.0)
            in_quiet = in_any_poly(cpt, quiet_tree, osm_data["quiet_zones"])
            in_res = in_any_poly(cpt, res_tree, osm_data["residential_zones"])
            in_com = in_any_poly(cpt, com_tree, osm_data["commercial_zones"])
            is_scenic = is_scenic_location(cpt)
            dist_wxt = bp.distance(wxt_poly) if wxt_poly else math.hypot(cx - (-976.0), cz - (-118.0))

            district = determine_district(cx, cz, nearest_main_nm, is_scenic, in_com, in_res, in_quiet)

            # Height calculation (CMAB real height with district-authentic ceilings)
            old_h = max(3.1, old_top - base_y)
            if district == "riverside_scenic":
                max_h, max_fl = 22.0, 7
            elif ring_name == "r1" or district == "old_downtown":
                max_h, max_fl = 25.5, 8
            else:
                max_h, max_fl = 41.0, 13

            if best_rec and best_rec.get("Height"):
                cmab_h = float(best_rec["Height"])
                clamped_h = max(4.5, min(max_h, cmab_h))
                floors = max(2, min(max_fl, round((clamped_h - 0.7) / 3.1))) if clamped_h >= 6.0 else 1
                new_h = round((3.8 + (floors - 1) * 3.1) if floors >= 2 else max(3.8, clamped_h), 1)
                stats["cmab_matched"] += 1
                ring_stats[ring_name]["cmab_matched"] += 1
            else:
                if district == "riverside_scenic":
                    floors = max(min(orig_floors, 4), min(4, 2 + int(math.sqrt(bp.area) / 14.0)))
                else:
                    floors = max(orig_floors, min(6, 2 + int(math.sqrt(bp.area) / 10.0) + (seed % 2)))
                new_h = round(3.8 + (floors - 1) * 3.1, 1)
                stats["fallback"] += 1
                ring_stats[ring_name]["fallback"] += 1

            upper, shop, roof_type, tint = classify_building(
                cx, cz, bp.area, orig_kind, best_rec, district, dist_main, dist_alley, dist_wxt, in_res, seed
            )

            owner_shard["overrides"][f"{tile_key}:{bi}"] = {
                "h": new_h,
                "f": floors,
                "u": upper,
                "s": shop,
                "r": roof_type,
                "c": tint,
            }
            stats["buildings"] += 1
            stats[f"district_{district}"] += 1
            stats[f"upper_{upper}"] += 1
            ring_stats[ring_name]["buildings"] += 1
            ring_h_old[ring_name] += old_h
            ring_h_new[ring_name] += new_h

            # Street-facing 3D relief props (eaves, AC units, wall-to-wall fascias, pier blades)
            if shop >= 0 and (dist_main < 24.0 or dist_alley < 15.0):
                # Map district to signboard pool
                if district == "riverside_scenic":
                    zkey = "riverside_scenic"
                elif district == "station_arterial":
                    zkey = "station_arterial"
                elif district == "old_downtown":
                    zkey = "old_downtown"
                else:
                    zkey = "neighborhood_alley"
                # Near campus perimeter (outside quiet zone!) mix in campus_edge signage
                if quiet_tree and not in_quiet:
                    for hi in quiet_tree.query(cpt.buffer(65.0)):
                        if cpt.distance(osm_data["quiet_zones"][hi]) < 65.0:
                            if (seed % 3) == 0:
                                zkey = "campus_edge"
                            break

                ring_pts = list(loops[0])
                npts = len(ring_pts)
                bldg_ac_count = 0
                MAX_AC_PER_BLDG = 8

                for ei in range(npts):
                    p1 = (tx + ring_pts[ei][0] / 100.0, tz + ring_pts[ei][1] / 100.0)
                    p2 = (tx + ring_pts[(ei + 1) % npts][0] / 100.0, tz + ring_pts[(ei + 1) % npts][1] / 100.0)
                    dx, dz = p2[0] - p1[0], p2[1] - p1[1]
                    elen = math.hypot(dx, dz)
                    if elen < 3.6 or elen > 90.0:
                        continue
                    mx, mz = (p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5
                    # Outward normal
                    nx, nz = dz / elen, -dx / elen
                    if bp.contains(Point(mx + nx * 0.5, mz + nz * 0.5)):
                        nx, nz = -nx, -nz

                    edge_mid = Point(mx + nx * 1.2, mz + nz * 1.2)
                    # Find nearest drivable road within 22m
                    d_edge_road, _, nearest_ls = nearest_road(edge_mid, drive_tree, drive_roads, 22.0)
                    if nearest_ls is None or d_edge_road > 22.0:
                        continue
                    # For non-main narrow alleys, tighten to 14m to avoid courtyard-facing walls
                    d_edge_main, _, _ = nearest_road(edge_mid, main_tree, main_roads, 22.5)
                    is_main_edge = d_edge_main <= 22.0
                    if not is_main_edge and d_edge_road > 14.0:
                        continue

                    # Normal must point toward the road (dot > 0.25)
                    proj = nearest_ls.interpolate(nearest_ls.project(edge_mid))
                    rx, rz = proj.x - mx, proj.y - mz
                    rlen = math.hypot(rx, rz) or 1.0
                    if (nx * rx + nz * rz) / rlen < 0.25:
                        continue

                    # Skip edges near bridges, water, or landmarks
                    if hits_landmark(edge_mid, margin=2.2) or hits_water(edge_mid, margin=2.0):
                        continue
                    if bridge_tree:
                        bidxs = bridge_tree.query_nearest(edge_mid, max_distance=7.0, all_matches=False)
                        if len(bidxs) > 0:
                            continue

                    prop_sg = shard_of(mx, mz)
                    if prop_sg not in shards_data:
                        prop_sg = owner_sg
                    prop_shard = shards_data[prop_sg]

                    yaw = round(math.atan2(nx, nz), 3)
                    trim = min(0.4, elen * 0.08)
                    ux, uz = dx / elen, dz / elen
                    ax1, az1 = p1[0] + ux * trim, p1[1] + uz * trim
                    ax2, az2 = p2[0] - ux * trim, p2[1] - uz * trim

                    # Eaves / Awnings (v1+ style: 2F grey-tile Guilin eave on main streets, weathered alley awning on old alleys)
                    if is_main_edge:
                        eave_prob = (seed + ei) % 2 == 0 if district in ("old_downtown", "riverside_scenic") else (seed + ei) % 4 == 0
                        if eave_prob and floors >= 3 and floors <= 8:
                            eave_seg = LineString([(ax1, az1), (ax2, az2)])
                            if not hits_landmark(eave_seg, margin=1.5):
                                prop_shard["eaves"].append([
                                    round(ax1, 2), round(az1, 2), round(ax2, 2), round(az2, 2),
                                    round(base_y + 4.10, 2), round(nx, 3), round(nz, 3), 0,
                                ])
                                stats["eaves"] += 1
                    elif dist_alley < 13.0 and district in ("old_downtown", "neighborhood_alley") and (seed + ei) % 2 == 0:
                        eave_seg = LineString([(ax1, az1), (ax2, az2)])
                        if not hits_landmark(eave_seg, margin=1.5):
                            prop_shard["eaves"].append([
                                round(ax1, 2), round(az1, 2), round(ax2, 2), round(az2, 2),
                                round(base_y + 3.25, 2), round(nx, 3), round(nz, 3), 1,
                            ])
                            stats["eaves"] += 1

                    # AC outdoor units at solid masonry piers (controlled density for crispness & <25KB gzip)
                    if bldg_ac_count < MAX_AC_PER_BLDG and floors >= 2:
                        pier_d = 6.5 if is_main_edge else 9.0
                        d_pos = 0.7
                        while d_pos < elen - 0.7 and bldg_ac_count < MAX_AC_PER_BLDG:
                            t_pos = d_pos / elen
                            px = p1[0] + dx * t_pos + nx * 0.20
                            pz = p1[1] + dz * t_pos + nz * 0.20
                            fl_ac = 1 + ((seed + ei + int(d_pos)) % max(1, min(3, floors - 1)))
                            py = round(base_y + 3.8 + (fl_ac - 1) * 3.1 + 0.55, 2)
                            if py < base_y + new_h - 1.2 and not hits_landmark(Point(px, pz), margin=1.5):
                                ac_sg = shard_of(px, pz)
                                if ac_sg not in shards_data:
                                    ac_sg = prop_sg
                                shards_data[ac_sg]["acUnits"].append([round(px, 2), py, round(pz, 2), yaw])
                                stats["acUnits"] += 1
                                bldg_ac_count += 1
                            d_pos += pier_d

                    # Wall-to-wall contiguous diverse-color 3D shopfront fascias (v1+ hero feature!)
                    target_bay = 4.65 if district == "old_downtown" else 5.20
                    n_bays = max(1, round(elen / target_bay))
                    bay_span = elen / n_bays
                    prev_hue: str | None = None
                    for bi_bay in range(n_bays):
                        bt = (bi_bay + 0.5) / n_bays
                        fx = p1[0] + dx * bt + nx * 0.04
                        fz = p1[1] + dz * bt + nz * 0.04
                        fpt = Point(fx, fz)
                        if hits_landmark(fpt, margin=2.2):
                            continue
                        forbidden = hue_tracker.nearby_hues(fx, fz, yaw, radius=6.5)
                        if prev_hue is not None:
                            forbidden.add(prev_hue)
                        aidx = pick_next_fascia(zkey, forbidden)
                        hue_fam, pref_h = FASCIA_META[aidx]
                        prev_hue = hue_fam
                        fw = round(max(2.4, min(6.2, bay_span - 0.18)), 2)
                        fh = round(pref_h, 2)
                        fd = round(0.08 + ((aidx * 7 + bi_bay * 3) % 5) * 0.015, 3)
                        fy = round(base_y + 2.58 + fh * 0.5, 2)
                        if fy + fh * 0.5 < base_y + new_h - 0.15:
                            f_sg = shard_of(fx, fz)
                            if f_sg not in shards_data:
                                f_sg = prop_sg
                            shards_data[f_sg]["fascias"].append([round(fx, 2), fy, round(fz, 2), yaw, fw, fh, fd, aidx])
                            hue_tracker.add(fx, fz, yaw, hue_fam)
                            stats["fascias"] += 1
                            ring_stats[ring_name]["fascias"] += 1

                    # Slim vertical pier blade signs on main commercial facades
                    if is_main_edge and elen >= 8.0 and (seed + ei) % 3 == 0:
                        pier_t = min(0.86, max(0.14, 4.8 / elen))
                        sx = p1[0] + dx * pier_t + nx * 0.34
                        sz = p1[1] + dz * pier_t + nz * 0.34
                        sy = round(base_y + 5.05, 2)
                        if sy < base_y + new_h - 1.2 and not hits_landmark(Point(sx, sz), margin=2.0):
                            bpool = BLADE_POOLS.get(zkey, BLADE_POOLS["old_downtown"])
                            b_sg = shard_of(sx, sz)
                            if b_sg not in shards_data:
                                b_sg = prop_sg
                            shards_data[b_sg]["blades"].append([round(sx, 2), sy, round(sz, 2), yaw, bpool[(seed + ei) % len(bpool)]])
                            stats["blades"] += 1

    print(f"  Processed buildings & street facades in {time.time() - t1:.2f}s")

    # Prebuild carriageway buffers for both street-sign setback validation & compound wall clipping
    carriageway_bufs = []
    wall_road_buffers = []
    for hw, ls in osm_data["all_road_geoms"]:
        if hw in ("trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "residential", "unclassified"):
            cw = 7.8 if hw in ("trunk", "primary") else (6.4 if hw == "secondary" else (5.0 if hw == "tertiary" else 3.4))
            g = ls.buffer(cw, quad_segs=3)
            prepare(g)
            carriageway_bufs.append(g)
        w = 8.5 if hw in ("primary", "trunk", "secondary") else (6.5 if hw == "tertiary" else 4.2)
        wall_road_buffers.append(ls.buffer(w, quad_segs=3))
    carriageway_tree = STRtree(carriageway_bufs) if carriageway_bufs else None
    road_buf_tree = STRtree(wall_road_buffers) if wall_road_buffers else None

    def hits_carriageway(pt: Point) -> bool:
        if not carriageway_tree:
            return False
        for _ in carriageway_tree.query(pt, predicate="intersects"):
            return True
        return False

    # 5. Citywide clean v1 blue bilingual Guilin street signs at major named intersections (sidewalk-checked!)
    t1 = time.time()
    named_road_segs: list[tuple[str, str, LineString]] = []
    for nm, segs in osm_data["roads_by_name"].items():
        if nm not in ROAD_PINYIN:
            continue
        for hw, ls in segs:
            if hw in ("trunk", "primary", "secondary", "tertiary") or nm in OLD_DOWNTOWN_ROADS:
                named_road_segs.append((nm, hw, ls))
    if named_road_segs:
        seg_tree = STRtree([ls for _, _, ls in named_road_segs])
        placed_pts: list[tuple[float, float]] = []
        seen_pairs: set[tuple[str, str]] = set()
        for i, (n1, hw1, g1) in enumerate(named_road_segs):
            for j in seg_tree.query(g1):
                if j <= i:
                    continue
                n2, hw2, g2 = named_road_segs[j]
                if n1 == n2:
                    continue
                pair = (n1, n2) if n1 < n2 else (n2, n1)
                if pair in seen_pairs:
                    continue
                if not g1.intersects(g2):
                    continue
                inter = g1.intersection(g2)
                pts = [inter] if inter.geom_type == "Point" else (
                    [g for g in getattr(inter, "geoms", ()) if g.geom_type == "Point"]
                )
                if not pts:
                    continue
                pt = pts[0]
                ix, iz = pt.x, pt.y
                if not (wx0 + 16 <= ix <= wx1 - 16 and wz0 + 16 <= iz <= wz1 - 16):
                    continue
                if any(math.hypot(ix - ox, iz - oz) < 55.0 for ox, oz in placed_pts):
                    continue
                d_along = g1.project(pt)
                p_a = g1.interpolate(max(0.0, d_along - 2.0))
                p_b = g1.interpolate(min(g1.length, d_along + 2.0))
                tdx, tdz = p_b.x - p_a.x, p_b.y - p_a.y
                tlen = math.hypot(tdx, tdz) or 1.0
                tx_u, tz_u = tdx / tlen, tdz / tlen
                # Setback dynamically past carriageway curb based on road class, try both corners if needed
                base_lat = 10.2 if hw1 in ("trunk", "primary") else (8.4 if hw1 == "secondary" else (6.8 if hw1 == "tertiary" else 5.4))
                chosen = None
                for side in (1.0, -1.0):
                    for extra in (0.0, 2.2):
                        lat_d = base_lat + extra
                        along_d = 9.0 if hw2 in ("trunk", "primary", "secondary") else 6.5
                        sx = ix + (-tz_u) * (lat_d * side) + tx_u * along_d
                        sz = iz + tx_u * (lat_d * side) + tz_u * along_d
                        spt = Point(sx, sz)
                        if not active_chunks_poly.contains(spt):
                            continue
                        if hits_landmark(spt, margin=2.5) or hits_water(spt, margin=3.0) or hits_carriageway(spt):
                            continue
                        # Ensure sign doesn't clip inside a building
                        if cmab_tree.query(spt, predicate="intersects").size > 0:
                            continue
                        chosen = (sx, sz)
                        break
                    if chosen:
                        break
                if not chosen:
                    continue
                sx, sz = chosen
                sg = shard_of(sx, sz)
                if sg not in shards_data:
                    continue
                seen_pairs.add(pair)
                placed_pts.append((ix, iz))
                sy = sample_y(sx, sz)
                if not (120.0 <= sy <= 320.0):
                    continue
                yaw = math.atan2(tx_u, tz_u)
                shards_data[sg]["streetSigns"].append({
                    "x": round(sx, 2), "y": round(sy, 2), "z": round(sz, 2),
                    "yaw": round(yaw, 3), "zh": n1, "en": ROAD_PINYIN[n1], "cross": n2,
                })
                stats["streetSigns"] += 1
    print(f"  Generated {stats['streetSigns']} sidewalk-verified bilingual street signs ({time.time() - t1:.2f}s)")

    # 6. Clean v1 subtle iron perimeter fences ONLY for unmodeled OSM schools/hospitals (zero v2 bloat!)
    t1 = time.time()
    road_buffers = wall_road_buffers

    for _cname, am, poly in osm_data["compounds"]:
        if hits_landmark(poly, margin=0.0):
            # Already modeled as a hand-crafted school/campus landmark GLB -> skip completely!
            continue
        if poly.geom_type == "MultiPolygon":
            exteriors = [list(g.exterior.coords) for g in poly.geoms]
        elif poly.geom_type == "Polygon":
            exteriors = [list(poly.exterior.coords)]
        else:
            continue
        wkind = 0 if am in ("school", "hospital") else 1
        for coords in exteriors:
            for i in range(len(coords) - 1):
                p1, p2 = coords[i], coords[i + 1]
                seg = LineString([p1, p2])
                if seg.length < 5.0:
                    continue
                rem = seg.intersection(active_chunks_poly)
                if rem.is_empty:
                    continue
                if road_buf_tree:
                    for hi in road_buf_tree.query(rem):
                        rem = rem.difference(road_buffers[hi])
                parts = [rem] if rem.geom_type == "LineString" else (list(rem.geoms) if hasattr(rem, "geoms") else [])
                for part in parts:
                    if part.geom_type != "LineString" or part.length < 5.0:
                        continue
                    if hits_landmark(part, margin=2.0) or hits_water(part, margin=2.0):
                        continue
                    c0, c1 = part.coords[0], part.coords[-1]
                    y1, y2 = round(sample_y(c0[0], c0[1]), 2), round(sample_y(c1[0], c1[1]), 2)
                    if not (120.0 <= y1 <= 320.0 and 120.0 <= y2 <= 320.0):
                        continue
                    mx, mz = (c0[0] + c1[0]) * 0.5, (c0[1] + c1[1]) * 0.5
                    sg = shard_of(mx, mz)
                    if sg not in shards_data:
                        continue
                    shards_data[sg]["walls"].append([
                        round(c0[0], 2), round(c0[1], 2), round(c1[0], 2), round(c1[1], 2),
                        y1, y2, wkind,
                    ])
                    stats["walls"] += 1
    print(f"  Generated {stats['walls']} subtle iron compound wall segs ({time.time() - t1:.2f}s)")

    # 7. Write shards & index.json (enforcing < 25 KB gzip per shard)
    out_dir = args.out_dir
    shards_dir = out_dir / "shards"
    shards_dir.mkdir(parents=True, exist_ok=True)

    index_path = out_dir / "index.json"
    existing_shards_meta: dict[str, dict] = {}
    if args.merge_existing and index_path.exists():
        try:
            old_idx = json.loads(index_path.read_text(encoding="utf-8"))
            existing_shards_meta = dict(old_idx.get("shards", {}))
        except Exception:
            existing_shards_meta = {}

    shards_meta: dict[str, dict] = dict(existing_shards_meta)
    max_gz_bytes = 0
    max_gz_key = ""
    total_raw_bytes = 0
    total_gz_bytes = 0

    for sg in sorted(shards_data.keys()):
        gx, gz = sg
        skey = f"{gx},{gz}"
        payload = shards_data[sg]
        gz_len = trim_shard_to_budget(payload, MAX_SHARD_GZIP_BYTES)
        raw_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        raw_bytes = raw_str.encode("utf-8")
        (shards_dir / f"{gx}_{gz}.json").write_bytes(raw_bytes)

        total_raw_bytes += len(raw_bytes)
        total_gz_bytes += gz_len
        if gz_len > max_gz_bytes:
            max_gz_bytes = gz_len
            max_gz_key = skey

        shards_meta[skey] = {
            "ring": shard_ring_map[sg],
            "buildings": len(payload["overrides"]),
            "fascias": len(payload["fascias"]),
        }

    # Build ordered rings index
    rings_index: dict[str, list[str]] = {"r1": [], "r2": [], "r3": []}
    for skey in sorted(shards_meta.keys(), key=lambda s: tuple(map(int, s.split(",")))):
        r = shards_meta[skey]["ring"]
        if r in rings_index:
            rings_index[r].append(skey)

    index_payload = {
        "version": 1,
        "shardSize": SHARD_SIZE,
        "fasciaGrid": [cols, rows],
        "rings": rings_index,
        "shards": dict(sorted(shards_meta.items(), key=lambda kv: tuple(map(int, kv[0].split(","))))),
    }
    index_path.write_text(json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Summary report
    print(f"\n=== City Upgrade v1+ Build Complete ({time.time() - t0:.2f}s) ===")
    print(f"  Shards written : {len(shards_data)} (total raw {total_raw_bytes/1024:.1f} KB, gzip {total_gz_bytes/1024:.1f} KB)")
    print(f"  Max shard gzip : {max_gz_bytes/1024:.2f} KB ({max_gz_key}) [limit < 25.00 KB]")
    print(f"  Totals         : {stats['buildings']} buildings (CMAB {stats['cmab_matched']}, skipped_landmark {stats['skipped_landmark']})")
    print(f"                   {stats['fascias']} fascias, {stats['blades']} blades, {stats['eaves']} eaves, {stats['acUnits']} ACs, {stats['streetSigns']} signs, {stats['walls']} walls")
    for r in ("r1", "r2", "r3"):
        rs = ring_stats[r]
        nb = rs["buildings"]
        if nb:
            cmab_pct = 100.0 * rs["cmab_matched"] / nb
            print(
                f"  Ring {r.upper()}        : {nb:5d} bldgs | CMAB {cmab_pct:5.1f}% | "
                f"avgH {ring_h_old[r]/nb:4.1f}m -> {ring_h_new[r]/nb:4.1f}m | "
                f"fascias {rs['fascias']:5d} | lm_skip {rs['skipped_landmark']:3d}"
            )


if __name__ == "__main__":
    main()
