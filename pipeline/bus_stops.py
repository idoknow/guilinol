"""生成「桂林OL」公交站外挂数据 public/street-furniture/bus-stops.json。

用途：
    读取已烘焙的世界块（.glc + manifest.json）和 OSM Overpass 快照 JSON，
    以 .glc 内置公交站点为主表，匹配站名、计算路缘站牌位与朝向，并按几何与
    道路等级规则判定候车亭放置，输出紧凑 JSON 供客户端外挂加载。

输入：
    --world   世界块目录（含 manifest.json 与 *.glc，格式标识需为 GL04；同名 *.trees 的行道树算候车亭障碍）
    --osm     OSM Overpass `out body geom` JSON 快照

输出：
    --out     公交站外挂 JSON（只写此文件，不修改任何现有产物）
    --report  可选，统计报告 JSON（stdout 始终打印可读报告）

注意：
    世界重烘焙后要重跑本脚本，以保持站点坐标、路缘朝向与 manifest.terrainSha256 同步。
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import struct
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
from shapely import LineString, MultiPolygon, Point, Polygon, STRtree, box, points
from shapely.errors import GEOSException
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, unary_union

# 经纬度到世界米（+X 向东，+Z 向南）的投影常量
ORIGIN_LAT: float = 25.280
ORIGIN_LON: float = 110.300
METERS_PER_DEG_LAT: float = 110574.0
METERS_PER_DEG_LON: float = 111320.0 * math.cos(math.radians(ORIGIN_LAT))

# .glc 二进制格式常量
GLC_MAGIC: bytes = b"GL04"
GLC_HEADER_SIZE: int = 24
GLC_GRID_BYTES: int = 65 * 65 * 2 * 2

# .glc 道路面类别
CARRIAGEWAY_KINDS: frozenset[int] = frozenset({0, 5})
WALKABLE_KINDS: frozenset[int] = frozenset({1, 4, 6})

# OSM 机动车道分类
_ROAD_BASE_CLASSES: tuple[str, ...] = (
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
)
ROAD_HIGHWAY_CLASSES: frozenset[str] = frozenset(
    cls for base in _ROAD_BASE_CLASSES for cls in (base, f"{base}_link")
)
_SHELTER_BASE_CLASSES: tuple[str, ...] = (
    "trunk",
    "primary",
    "secondary",
    "tertiary",
)
SHELTER_HIGHWAY_CLASSES: frozenset[str] = frozenset(
    cls for base in _SHELTER_BASE_CLASSES for cls in (base, f"{base}_link")
)
_CLASS_PRIORITY: tuple[str, ...] = (
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "unclassified_link",
    "residential_link",
    "living_street_link",
)

# 匹配、朝向与候车亭几何参数（单位：米 / 度）
MATCH_MAX_DIST_M: float = 15.0
LOCAL_UNION_RADIUS_M: float = 60.0
FAR_THRESHOLD_M: float = 8.0
CENTRELINE_SEARCH_RADIUS_M: float = 25.0
CENTRELINE_TANGENT_DELTAS_M: tuple[float, ...] = (3.0, 1.5, 0.5, 0.1)
CENTRELINE_SNAP_MAX_RAD: float = math.radians(35.0)
POLE_SETBACK_M: float = 0.6
EN_MAX_CHARS: int = 36

SHELTER_LENGTH_M: float = 4.2
SHELTER_DEPTH_M: float = 1.5
SHELTER_FRONT_SETBACK_M: float = 1.0
SHELTER_TANGENT_OFFSET_M: float = 2.6
SHELTER_ROAD_MARGIN_M: float = 0.2
SHELTER_BLDG_MARGIN_M: float = 0.3
SHELTER_WALKABLE_MIN_RATIO: float = 0.85
SHELTER_OBSTACLE_MARGIN_M: float = 0.4
# 行道树：树心到候车亭轮廓至少这么远（树池约 1 m 见方，亭不压树池）。
SHELTER_TREE_CLEARANCE_M: float = 0.6
# 街边摆设（.glc st[9] decor 与 st[7] beds）占位半径、半宽与偏移（单位：米）。
CLUTTER_RAIL_KINDS: frozenset[int] = frozenset({1, 2, 5, 6, 7, 8})
CLUTTER_EBIKE_OFFSETS_M: tuple[float, ...] = (-1.25, 0.0, 1.25)
CLUTTER_EBIKE_RADIUS_M: float = 0.9
CLUTTER_RAIL_HALF_WIDTH_M: float = 0.6
CLUTTER_SIGN_RADIUS_M: float = 0.8
CLUTTER_BOLLARD_RADIUS_M: float = 0.4
CLUTTER_BED_RADIUS_M: float = 0.7
TREE_RECORD_BYTES: int = 12
SHELTER_GAP_M: float = 1.0

YawSource = Literal["centreline", "kerb", "none"]
VETO_KEYS: tuple[str, ...] = ("a", "b", "c", "d", "e", "f", "g", "t", "u")


@dataclass(frozen=True, slots=True)
class WorldData:
    """全城 .glc 提取的几何与空间索引（坐标均为世界米）。"""

    chunk_count: int
    terrain_sha256: str
    stops: list[tuple[float, float]]
    carriageways: list[Polygon]
    carriageway_tree: STRtree
    walkables: list[Polygon]
    walkable_tree: STRtree
    buildings: list[Polygon]
    building_tree: STRtree
    pole_obstacles: list[Point]
    trees: list[Point]
    tree_index: STRtree
    pole_obstacle_tree: STRtree
    clutter: list[BaseGeometry]
    clutter_index: STRtree


@dataclass(frozen=True, slots=True)
class OsmStop:
    """OSM highway=bus_stop 节点（坐标已转为世界米）。"""

    osm_id: int
    x: float
    z: float
    name: str
    en: str
    shelter: str


@dataclass(frozen=True, slots=True)
class OsmData:
    """OSM 站点与机动车道中心线及空间索引。"""

    stops: list[OsmStop]
    road_lines: list[LineString]
    road_classes: list[str]
    road_tree: STRtree


@dataclass(frozen=True, slots=True)
class Orientation:
    """单站路缘吸附、朝向与站牌位置计算结果。"""

    far: bool
    pole_x: float
    pole_z: float
    kerb_x: float | None
    kerb_z: float | None
    nx: float
    nz: float
    tx: float
    tz: float
    yaw: float
    yaw_source: YawSource
    cls: str
    road_union: Polygon | MultiPolygon


@dataclass(frozen=True, slots=True)
class ShelterDecision:
    """单站候车亭判定结果。"""

    shelter: int
    side: int
    rect: Polygon | None
    in_building: bool
    vetoes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _OrientedStop:
    """用于排序与后续候车亭判定的中间站点记录。"""

    orig_idx: int
    orig_x: float
    orig_z: float
    out_x: float
    out_z: float
    out_yaw: float
    orientation: Orientation
    osm_stop: OsmStop | None


def _clean_float(value: float, digits: int) -> float:
    rounded = round(float(value), digits)
    return 0.0 if rounded == 0.0 else rounded


def _latlon_to_world(lat: float, lon: float) -> tuple[float, float]:
    x = (lon - ORIGIN_LON) * METERS_PER_DEG_LON
    z = -(lat - ORIGIN_LAT) * METERS_PER_DEG_LAT
    return (x, z)


def _extract_polygons(geom: BaseGeometry) -> list[Polygon]:
    """从任意 Shapely 几何中提取有效非空 Polygon 列表。"""
    if geom.is_empty:
        return []
    gtype = geom.geom_type
    if gtype == "Polygon":
        assert isinstance(geom, Polygon)
        return [geom] if geom.area > 1e-9 else []
    if gtype in ("MultiPolygon", "GeometryCollection"):
        out: list[Polygon] = []
        for part in geom.geoms:
            out.extend(_extract_polygons(part))
        return out
    return []


def _rings_to_polygons(
    outer_cm: Sequence[Sequence[float]],
    holes_cm: Sequence[Sequence[Sequence[float]]],
    ox: float,
    oz: float,
) -> list[Polygon]:
    """将块局部厘米环转为世界米有效 Polygon（无效时用 buffer(0) 修复）。"""
    if len(outer_cm) < 3:
        return []
    outer_m = [(ox + pt[0] * 0.01, oz + pt[1] * 0.01) for pt in outer_cm]
    holes_m = [
        [(ox + pt[0] * 0.01, oz + pt[1] * 0.01) for pt in hole]
        for hole in holes_cm
        if len(hole) >= 3
    ]
    try:
        poly: BaseGeometry = Polygon(outer_m, holes_m) if holes_m else Polygon(outer_m)
        if not poly.is_valid:
            poly = poly.buffer(0)
        polys = _extract_polygons(poly)
        if polys:
            return polys
    except (GEOSException, ValueError):
        pass

    # 若带洞构造失败，退化为仅用外环尝试修复
    if holes_m:
        try:
            poly = Polygon(outer_m)
            if not poly.is_valid:
                poly = poly.buffer(0)
            return _extract_polygons(poly)
        except (GEOSException, ValueError):
            return []
    return []


def _safe_polygon_union(polys: Sequence[Polygon]) -> Polygon | MultiPolygon:
    """对多边形列表做安全并集，返回 Polygon 或 MultiPolygon（空时返回空 Polygon）。"""
    if not polys:
        return Polygon()
    if len(polys) == 1:
        return polys[0]
    try:
        merged: BaseGeometry = unary_union(polys)
    except GEOSException:
        repaired: list[Polygon] = []
        for poly in polys:
            try:
                repaired.extend(_extract_polygons(poly.buffer(0)))
            except GEOSException:
                continue
        if not repaired:
            return Polygon()
        try:
            merged = unary_union(repaired)
        except GEOSException:
            return Polygon()
    if not merged.is_valid:
        try:
            merged = merged.buffer(0)
        except GEOSException:
            return Polygon()
    extracted = _extract_polygons(merged)
    if not extracted:
        return Polygon()
    if len(extracted) == 1:
        return extracted[0]
    return MultiPolygon(extracted)


def _local_union(
    center: Point,
    polys: Sequence[Polygon],
    tree: STRtree,
    radius_m: float = LOCAL_UNION_RADIUS_M,
) -> Polygon | MultiPolygon:
    """查询 center 周围 radius_m 内的多边形并做局部 unary_union。"""
    if not polys:
        return Polygon()
    cx, cz = center.x, center.y
    idxs = tree.query(box(cx - radius_m, cz - radius_m, cx + radius_m, cz + radius_m))
    if len(idxs) == 0:
        return Polygon()
    nearby: list[Polygon] = []
    for idx in idxs:
        poly = polys[int(idx)]
        if poly.distance(center) <= radius_m:
            nearby.append(poly)
    return _safe_polygon_union(nearby)


def read_world(world_dir: Path) -> WorldData:
    """读取世界目录的 manifest.json 与全部 .glc 块并构建 STRtree 空间索引。"""
    if not world_dir.is_dir():
        raise FileNotFoundError(f"World directory not found: {world_dir}")
    manifest_path = world_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    chunks = manifest.get("chunks")
    if not isinstance(chunks, list):
        raise ValueError(f"Invalid manifest chunks list: {manifest_path}")
    terrain_sha256 = str(manifest.get("terrainSha256") or "")

    stops: list[tuple[float, float]] = []
    carriageways: list[Polygon] = []
    walkables: list[Polygon] = []
    buildings: list[Polygon] = []
    obstacle_coords: list[tuple[float, float]] = []
    tree_coords: list[tuple[float, float]] = []
    clutter: list[BaseGeometry] = []

    for entry in chunks:
        rel_file = entry.get("file")
        if not isinstance(rel_file, str):
            raise ValueError(f"Invalid chunk entry in manifest: {entry!r}")
        chunk_path = world_dir / rel_file
        if not chunk_path.is_file():
            raise FileNotFoundError(f"Chunk file not found: {chunk_path}")

        ox = float(entry["x"])
        oz = float(entry["z"])

        try:
            raw = gzip.decompress(chunk_path.read_bytes())
        except OSError as exc:
            raise ValueError(f"Failed to decompress chunk {chunk_path}: {exc}") from exc

        if len(raw) < GLC_HEADER_SIZE or raw[:4] != GLC_MAGIC:
            magic = raw[:4] if len(raw) >= 4 else raw
            raise ValueError(
                f"Invalid .glc format magic in {chunk_path}: expected {GLC_MAGIC!r}, got {magic!r}"
            )

        v_cnt, i_cnt, c_len, _p_len, _b_cnt = struct.unpack_from("<5I", raw, 4)
        off = GLC_HEADER_SIZE + GLC_GRID_BYTES + v_cnt * 6 + v_cnt * 3 + i_cnt * 4
        if off + c_len > len(raw):
            raise ValueError(
                f"Truncated .glc collision JSON in {chunk_path}: need {off + c_len}, got {len(raw)}"
            )

        collision = json.loads(raw[off : off + c_len])
        if not isinstance(collision, list) or len(collision) < 2:
            raise ValueError(f"Unexpected collision JSON structure in {chunk_path}")

        chunk_buildings = collision[0] or []
        for bldg in chunk_buildings:
            if not isinstance(bldg, list) or len(bldg) < 3:
                continue
            rings = bldg[2]
            if not rings:
                continue
            buildings.extend(_rings_to_polygons(rings[0], rings[1:], ox, oz))

        st = collision[1] or []
        if len(st) > 0 and st[0]:
            for road_item in st[0]:
                if not isinstance(road_item, list) or len(road_item) < 2:
                    continue
                kind = road_item[0]
                if kind in CARRIAGEWAY_KINDS:
                    carriageways.extend(
                        _rings_to_polygons(road_item[1], road_item[2:], ox, oz)
                    )
                elif kind in WALKABLE_KINDS:
                    walkables.extend(
                        _rings_to_polygons(road_item[1], road_item[2:], ox, oz)
                    )

        # st[1]=路灯，st[3]=信号灯杆，st[4]=公交站（均为块局部分米）
        if len(st) > 1 and st[1]:
            for pt in st[1]:
                obstacle_coords.append((ox + pt[0] * 0.1, oz + pt[1] * 0.1))
        if len(st) > 3 and st[3]:
            for pt in st[3]:
                obstacle_coords.append((ox + pt[0] * 0.1, oz + pt[1] * 0.1))
        if len(st) > 4 and st[4]:
            for pt in st[4]:
                stops.append((ox + pt[0] * 0.1, oz + pt[1] * 0.1))

        # st[7]=花坛，st[9]=街边摆设（均为块局部分米）
        if len(st) > 7 and st[7]:
            for bed in st[7]:
                if not isinstance(bed, list) or len(bed) < 2:
                    continue
                clutter.append(
                    Point(ox + bed[0] * 0.1, oz + bed[1] * 0.1).buffer(
                        CLUTTER_BED_RADIUS_M, 8
                    )
                )
        if len(st) > 9 and st[9]:
            for item in st[9]:
                if not isinstance(item, list) or len(item) < 3:
                    continue
                kind = item[0]
                x = ox + item[1] * 0.1
                z = oz + item[2] * 0.1
                if kind == 3:
                    if len(item) < 4:
                        continue
                    h = item[3] * 0.01
                    ch, sh = math.cos(h), math.sin(h)
                    for along in CLUTTER_EBIKE_OFFSETS_M:
                        clutter.append(
                            Point(x + along * ch, z + along * sh).buffer(
                                CLUTTER_EBIKE_RADIUS_M, 8
                            )
                        )
                elif kind in CLUTTER_RAIL_KINDS:
                    if len(item) < 5:
                        continue
                    h = item[3] * 0.01
                    half = item[4] * 0.05
                    if half > 1e-6:
                        dx = half * math.cos(h)
                        dz = half * math.sin(h)
                        clutter.append(
                            LineString([(x - dx, z - dz), (x + dx, z + dz)]).buffer(
                                CLUTTER_RAIL_HALF_WIDTH_M, cap_style="flat"
                            )
                        )
                    else:
                        clutter.append(
                            Point(x, z).buffer(CLUTTER_RAIL_HALF_WIDTH_M, 8)
                        )
                elif kind == 4:
                    clutter.append(Point(x, z).buffer(CLUTTER_SIGN_RADIUS_M, 8))
                elif kind == 11:
                    clutter.append(Point(x, z).buffer(CLUTTER_BOLLARD_RADIUS_M, 8))

        # 同名 .trees：每棵树 12 字节，开头是块局部厘米的 x、z（uint16 小端），同 web/src/forest.ts readTrees。
        trees_path = chunk_path.with_suffix(".trees")
        if trees_path.is_file():
            try:
                tree_raw = gzip.decompress(trees_path.read_bytes())
            except OSError as exc:
                raise ValueError(f"Failed to decompress {trees_path}: {exc}") from exc
            if len(tree_raw) % TREE_RECORD_BYTES:
                raise ValueError(f"Invalid vegetation payload in {trees_path}")
            for i in range(0, len(tree_raw), TREE_RECORD_BYTES):
                tx, tz = struct.unpack_from("<HH", tree_raw, i)
                tree_coords.append((ox + tx * 0.01, oz + tz * 0.01))

    pole_obstacles: list[Point] = (
        list(points(np.asarray(obstacle_coords, dtype=np.float64))) if obstacle_coords else []
    )
    trees: list[Point] = (
        list(points(np.asarray(tree_coords, dtype=np.float64))) if tree_coords else []
    )

    return WorldData(
        chunk_count=len(chunks),
        terrain_sha256=terrain_sha256,
        stops=stops,
        carriageways=carriageways,
        carriageway_tree=STRtree(carriageways),
        walkables=walkables,
        walkable_tree=STRtree(walkables),
        buildings=buildings,
        building_tree=STRtree(buildings),
        pole_obstacles=pole_obstacles,
        pole_obstacle_tree=STRtree(pole_obstacles),
        trees=trees,
        tree_index=STRtree(trees),
        clutter=clutter,
        clutter_index=STRtree(clutter),
    )


_LINE_LIST = r"[0-9Kk路,，、 ]+"


def _clean_name(raw: str) -> str:
    """站名只留站名：去掉 OSM 里混写的线路号（「象山公园 16,23」）；纯线路号不算站名。"""
    name = re.sub(rf"\s+{_LINE_LIST}$", "", raw.strip())
    return "" if re.fullmatch(_LINE_LIST, name) else name


def _clean_en(raw: str) -> str:
    """英文名只留站名：去掉序号「(N° 1)」和线路说明；纯线路号、带价格的揽客文字、过长的不要。"""
    en = re.sub(r"\s*\(N°\s*\d+\)", "", raw.strip())
    en = re.sub(r"[,.]?\s*lines?\s*:.*$", "", en, flags=re.IGNORECASE).strip()
    if not en or re.fullmatch(_LINE_LIST, en) or "$" in en or len(en) > EN_MAX_CHARS:
        return ""
    return en


def read_osm(osm_path: Path) -> OsmData:
    """读取 OSM Overpass 快照 JSON，提取公交站节点与机动车道中心线。"""
    if not osm_path.is_file():
        raise FileNotFoundError(f"OSM snapshot not found: {osm_path}")

    data = json.loads(osm_path.read_text(encoding="utf-8"))
    elements = data.get("elements")
    if not isinstance(elements, list):
        raise ValueError(f"Invalid OSM JSON (missing elements list): {osm_path}")

    osm_stops: list[OsmStop] = []
    road_lines: list[LineString] = []
    road_classes: list[str] = []

    for el in elements:
        if not isinstance(el, dict):
            continue
        el_type = el.get("type")
        tags = el.get("tags")
        if not isinstance(tags, dict):
            continue
        hw = tags.get("highway")

        if el_type == "node" and hw == "bus_stop":
            lat = el.get("lat")
            lon = el.get("lon")
            if lat is None or lon is None:
                continue
            x, z = _latlon_to_world(float(lat), float(lon))
            name = _clean_name(str(tags.get("name:zh") or tags.get("name") or ""))
            en = _clean_en(str(tags.get("name:en") or "")) if name else ""
            shelter = str(tags.get("shelter") or "").strip().lower()
            osm_stops.append(
                OsmStop(
                    osm_id=int(el.get("id", 0)),
                    x=x,
                    z=z,
                    name=name,
                    en=en,
                    shelter=shelter,
                )
            )
        elif el_type == "way" and isinstance(hw, str) and hw in ROAD_HIGHWAY_CLASSES:
            geom = el.get("geometry")
            if not isinstance(geom, list) or len(geom) < 2:
                continue
            coords = [
                _latlon_to_world(float(pt["lat"]), float(pt["lon"]))
                for pt in geom
                if "lat" in pt and "lon" in pt
            ]
            if len(coords) < 2:
                continue
            line = LineString(coords)
            if line.is_empty or line.length <= 1e-6:
                continue
            road_lines.append(line)
            road_classes.append(hw)

    return OsmData(
        stops=osm_stops,
        road_lines=road_lines,
        road_classes=road_classes,
        road_tree=STRtree(road_lines),
    )


def match(
    world_stops: Sequence[tuple[float, float]],
    osm_stops: Sequence[OsmStop],
    max_dist: float = MATCH_MAX_DIST_M,
) -> tuple[dict[int, OsmStop], int]:
    """按距离升序贪心一对一匹配 .glc 站点与 OSM 站点（上限 max_dist 米）。

    返回 (world_idx -> OsmStop 的匹配字典, 未匹配上的 OSM 节点数)。
    """
    if not world_stops or not osm_stops:
        return ({}, len(osm_stops))

    osm_xy = np.array([(s.x, s.z) for s in osm_stops], dtype=np.float64)
    osm_tree = STRtree(points(osm_xy))

    candidates: list[tuple[float, int, int]] = []
    for wi, (wx, wz) in enumerate(world_stops):
        idxs = osm_tree.query(
            box(wx - max_dist, wz - max_dist, wx + max_dist, wz + max_dist)
        )
        if len(idxs) == 0:
            continue
        dists = np.hypot(osm_xy[idxs, 0] - wx, osm_xy[idxs, 1] - wz)
        for idx, dist in zip(idxs, dists):
            d = float(dist)
            if d <= max_dist:
                candidates.append((d, wi, int(idx)))

    candidates.sort(key=lambda item: (item[0], item[1], item[2]))

    matched: dict[int, OsmStop] = {}
    used_osm: set[int] = set()
    for _dist, wi, oi in candidates:
        if wi in matched or oi in used_osm:
            continue
        matched[wi] = osm_stops[oi]
        used_osm.add(oi)

    unmatched_osm_count = len(osm_stops) - len(used_osm)
    return (matched, unmatched_osm_count)


def _line_tangent_at(line: LineString, s: float) -> tuple[float, float] | None:
    """用最近点前后各 3 m（退化时自适应缩短）求折线切向单位向量。"""
    total_len = line.length
    if total_len <= 1e-6:
        return None
    is_closed = line.is_ring
    for delta in CENTRELINE_TANGENT_DELTAS_M:
        try:
            if is_closed and total_len > 2.0 * delta + 1e-3:
                p0 = line.interpolate((s - delta) % total_len)
                p1 = line.interpolate((s + delta) % total_len)
            else:
                p0 = line.interpolate(max(0.0, s - delta))
                p1 = line.interpolate(min(total_len, s + delta))
        except GEOSException:
            continue
        dx = p1.x - p0.x
        dz = p1.y - p0.y
        norm = math.hypot(dx, dz)
        if norm > 1e-6:
            return (dx / norm, dz / norm)
    return None


def _nearest_centreline(
    stop_pt: Point,
    osm: OsmData,
    max_dist: float = CENTRELINE_SEARCH_RADIUS_M,
) -> tuple[LineString, str, Point, tuple[float, float] | None] | None:
    """在 max_dist 米内查找最近 OSM 机动车道中心线及最近点处切线。"""
    if not osm.road_lines:
        return None
    px, pz = stop_pt.x, stop_pt.y
    idxs = osm.road_tree.query(
        box(px - max_dist, pz - max_dist, px + max_dist, pz + max_dist)
    )
    if len(idxs) == 0:
        return None

    best_idx = -1
    best_dist = math.inf
    for idx in idxs:
        i = int(idx)
        try:
            d = osm.road_lines[i].distance(stop_pt)
        except GEOSException:
            continue
        if d <= max_dist and (d < best_dist or (d == best_dist and i < best_idx)):
            best_dist = d
            best_idx = i

    if best_idx < 0:
        return None

    line = osm.road_lines[best_idx]
    cls = osm.road_classes[best_idx]
    try:
        s = float(line.project(stop_pt))
        c_pt = line.interpolate(s)
    except GEOSException:
        return (line, cls, stop_pt, None)

    tangent = _line_tangent_at(line, s)
    return (line, cls, c_pt, tangent)


def _orient_normal_from_tangent(
    tangent: tuple[float, float],
    ref_x: float,
    ref_z: float,
) -> tuple[float, float]:
    """从切线的两个法向中选取与参考向量同侧的单位法向。"""
    tx, tz = tangent
    n1x, n1z = -tz, tx
    if n1x * ref_x + n1z * ref_z >= 0.0:
        return (n1x, n1z)
    return (tz, -tx)


def orient(stop_pt: Point, world: WorldData, osm: OsmData) -> Orientation:
    """计算单站路缘点、朝向（含中心线校正）及站牌位置。"""
    px, pz = stop_pt.x, stop_pt.y
    road_union = _local_union(
        stop_pt, world.carriageways, world.carriageway_tree, LOCAL_UNION_RADIUS_M
    )
    centreline = _nearest_centreline(stop_pt, osm, CENTRELINE_SEARCH_RADIUS_M)
    cls = centreline[1] if centreline is not None else ""

    try:
        dist_to_road = math.inf if road_union.is_empty else road_union.distance(stop_pt)
    except GEOSException:
        dist_to_road = math.inf

    if road_union.is_empty or dist_to_road > FAR_THRESHOLD_M:
        if centreline is not None and centreline[3] is not None:
            c_pt = centreline[2]
            nx, nz = _orient_normal_from_tangent(
                centreline[3], c_pt.x - px, c_pt.y - pz
            )
            yaw = math.atan2(nx, nz)
            yaw_source: YawSource = "centreline"
        else:
            nx, nz = 0.0, 1.0
            yaw = 0.0
            yaw_source = "none"
        return Orientation(
            far=True,
            pole_x=px,
            pole_z=pz,
            kerb_x=None,
            kerb_z=None,
            nx=nx,
            nz=nz,
            tx=nz,
            tz=-nx,
            yaw=yaw,
            yaw_source=yaw_source,
            cls=cls,
            road_union=road_union,
        )

    # 非 far 站：取车行道边界最近点 q，并推导指向车道的单位法向 n
    try:
        kerb_pt = nearest_points(stop_pt, road_union.boundary)[1]
        in_road = road_union.contains(stop_pt)
    except GEOSException:
        return Orientation(
            far=True,
            pole_x=px,
            pole_z=pz,
            kerb_x=None,
            kerb_z=None,
            nx=0.0,
            nz=1.0,
            tx=1.0,
            tz=0.0,
            yaw=0.0,
            yaw_source="none",
            cls=cls,
            road_union=road_union,
        )

    qx, qz = kerb_pt.x, kerb_pt.y
    dx, dz = qx - px, qz - pz
    d_pq = math.hypot(dx, dz)

    n_kerb: tuple[float, float] | None
    if d_pq > 1e-6:
        if in_road:
            # p 在车行道内时，p->q 指向路外，反转为 q->p 指向车道内
            n_kerb = (-dx / d_pq, -dz / d_pq)
        else:
            n_kerb = (dx / d_pq, dz / d_pq)
    else:
        n_kerb = None

    tangent = centreline[3] if centreline is not None else None
    if n_kerb is not None:
        nkx, nkz = n_kerb
        if tangent is not None:
            ncx, ncz = _orient_normal_from_tangent(tangent, nkx, nkz)
            dot = max(-1.0, min(1.0, ncx * nkx + ncz * nkz))
            if math.acos(dot) <= CENTRELINE_SNAP_MAX_RAD:
                nx, nz = ncx, ncz
                yaw_source = "centreline"
            else:
                nx, nz = nkx, nkz
                yaw_source = "kerb"
        else:
            nx, nz = nkx, nkz
            yaw_source = "kerb"
    else:
        # p 与 q 重合，用中心线法向兜底
        if centreline is not None and tangent is not None:
            c_pt = centreline[2]
            t_x, t_z = tangent
            cand1 = (-t_z, t_x)
            cand2 = (t_z, -t_x)
            # 优先探测哪一侧落入车行道内部；再以中心线方向作兜底
            probe_step = 0.25
            in1 = road_union.contains(
                Point(qx + cand1[0] * probe_step, qz + cand1[1] * probe_step)
            )
            in2 = road_union.contains(
                Point(qx + cand2[0] * probe_step, qz + cand2[1] * probe_step)
            )
            if in1 and not in2:
                nx, nz = cand1
            elif in2 and not in1:
                nx, nz = cand2
            else:
                nx, nz = _orient_normal_from_tangent(tangent, c_pt.x - qx, c_pt.y - qz)
            yaw_source = "centreline"
        else:
            nx, nz = 0.0, 1.0
            yaw_source = "none"

    yaw = 0.0 if yaw_source == "none" else math.atan2(nx, nz)
    tx, tz = nz, -nx
    pole_x = qx - nx * POLE_SETBACK_M
    pole_z = qz - nz * POLE_SETBACK_M

    return Orientation(
        far=False,
        pole_x=pole_x,
        pole_z=pole_z,
        kerb_x=qx,
        kerb_z=qz,
        nx=nx,
        nz=nz,
        tx=tx,
        tz=tz,
        yaw=yaw,
        yaw_source=yaw_source,
        cls=cls,
        road_union=road_union,
    )


def _point_in_buildings(pt: Point, world: WorldData) -> bool:
    if not world.buildings:
        return False
    try:
        return len(world.building_tree.query(pt, predicate="intersects")) > 0
    except GEOSException:
        return False


def _shelter_rect(orient_info: Orientation, side: int) -> Polygon:
    """构造候选候车亭占地矩形（沿 t 长 4.2m，沿 -n 进深 1.5m，靠车道边在 q-n·1.0）。"""
    assert orient_info.kerb_x is not None and orient_info.kerb_z is not None
    qx, qz = orient_info.kerb_x, orient_info.kerb_z
    nx, nz = orient_info.nx, orient_info.nz
    tx, tz = orient_info.tx, orient_info.tz

    half_len = SHELTER_LENGTH_M * 0.5
    u0 = side * SHELTER_TANGENT_OFFSET_M - half_len
    u1 = side * SHELTER_TANGENT_OFFSET_M + half_len
    v0 = -SHELTER_FRONT_SETBACK_M
    v1 = -(SHELTER_FRONT_SETBACK_M + SHELTER_DEPTH_M)

    corners = [
        (qx + u0 * tx + v0 * nx, qz + u0 * tz + v0 * nz),
        (qx + u1 * tx + v0 * nx, qz + u1 * tz + v0 * nz),
        (qx + u1 * tx + v1 * nx, qz + u1 * tz + v1 * nz),
        (qx + u0 * tx + v1 * nx, qz + u0 * tz + v1 * nz),
    ]
    return Polygon(corners)


def _rect_hits_buildings(rect: Polygon, world: WorldData, margin: float) -> bool:
    if not world.buildings:
        return False
    minx, minz, maxx, maxz = rect.bounds
    pad = margin + 1e-3
    idxs = world.building_tree.query(box(minx - pad, minz - pad, maxx + pad, maxz + pad))
    for idx in idxs:
        if rect.distance(world.buildings[int(idx)]) <= margin:
            return True
    return False


def _rect_near_points(
    rect: Polygon, pts: Sequence[Point], index: STRtree, margin: float
) -> bool:
    if not pts:
        return False
    minx, minz, maxx, maxz = rect.bounds
    pad = margin + 1e-3
    for idx in index.query(box(minx - pad, minz - pad, maxx + pad, maxz + pad)):
        if rect.distance(pts[int(idx)]) <= margin:
            return True
    return False


def _rect_hits_obstacles(rect: Polygon, world: WorldData, margin: float) -> bool:
    return _rect_near_points(rect, world.pole_obstacles, world.pole_obstacle_tree, margin)


def _rect_hits_trees(rect: Polygon, world: WorldData, margin: float) -> bool:
    return _rect_near_points(rect, world.trees, world.tree_index, margin)


def _rect_hits_clutter(rect: Polygon, world: WorldData) -> bool:
    if not world.clutter:
        return False
    for idx in world.clutter_index.query(rect):
        if rect.intersects(world.clutter[int(idx)]):
            return True
    return False


def _rect_hits_shelters(
    rect: Polygon, placed_shelters: Sequence[Polygon], margin: float
) -> bool:
    if not placed_shelters:
        return False
    minx, minz, maxx, maxz = rect.bounds
    for prev in placed_shelters:
        pminx, pminz, pmaxx, pmaxz = prev.bounds
        if (
            pmaxx + margin < minx
            or pminx - margin > maxx
            or pmaxz + margin < minz
            or pminz - margin > maxz
        ):
            continue
        if rect.distance(prev) <= margin:
            return True
    return False


def _eval_shelter_geometry(
    rect: Polygon,
    in_building: bool,
    road_union: Polygon | MultiPolygon,
    walkable_union: Polygon | MultiPolygon,
    world: WorldData,
    placed_shelters: Sequence[Polygon],
) -> set[str]:
    """评估单侧候选矩形的几何约束 c-g、t 与 u（行道树、街边摆设），返回未通过的条件集合。"""
    failed: set[str] = set()
    try:
        if not road_union.is_empty and rect.distance(road_union) <= SHELTER_ROAD_MARGIN_M:
            failed.add("c")
    except GEOSException:
        failed.add("c")

    try:
        if in_building or _rect_hits_buildings(rect, world, SHELTER_BLDG_MARGIN_M):
            failed.add("d")
    except GEOSException:
        failed.add("d")

    try:
        if walkable_union.is_empty or rect.area <= 0.0:
            failed.add("e")
        else:
            ratio = rect.intersection(walkable_union).area / rect.area
            if ratio < SHELTER_WALKABLE_MIN_RATIO:
                failed.add("e")
    except GEOSException:
        failed.add("e")

    try:
        if _rect_hits_obstacles(rect, world, SHELTER_OBSTACLE_MARGIN_M):
            failed.add("f")
    except GEOSException:
        failed.add("f")

    try:
        if _rect_hits_trees(rect, world, SHELTER_TREE_CLEARANCE_M):
            failed.add("t")
    except GEOSException:
        failed.add("t")

    try:
        if _rect_hits_clutter(rect, world):
            failed.add("u")
    except GEOSException:
        failed.add("u")

    try:
        if _rect_hits_shelters(rect, placed_shelters, SHELTER_GAP_M):
            failed.add("g")
    except GEOSException:
        failed.add("g")

    return failed


def shelter_for(
    stop_pt: Point,
    orient_info: Orientation,
    osm_stop: OsmStop | None,
    world: WorldData,
    placed_shelters: Sequence[Polygon],
) -> ShelterDecision:
    """判定单站是否放置候车亭（依次尝试沿 t 偏移 +2.6 m、-2.6 m）。"""
    pole_pt = Point(orient_info.pole_x, orient_info.pole_z)
    in_building = _point_in_buildings(stop_pt, world) or _point_in_buildings(
        pole_pt, world
    )

    if orient_info.far or orient_info.kerb_x is None or orient_info.kerb_z is None:
        return ShelterDecision(
            shelter=0,
            side=0,
            rect=None,
            in_building=in_building,
            vetoes=(),
        )

    fail_a = osm_stop is not None and osm_stop.shelter == "no"
    has_osm_yes = osm_stop is not None and osm_stop.shelter == "yes"
    fail_b = not (has_osm_yes or orient_info.cls in SHELTER_HIGHWAY_CLASSES)

    walkable_union = _local_union(
        stop_pt, world.walkables, world.walkable_tree, LOCAL_UNION_RADIUS_M
    )

    rect_plus = _shelter_rect(orient_info, +1)
    geom_fails_plus = _eval_shelter_geometry(
        rect_plus,
        in_building,
        orient_info.road_union,
        walkable_union,
        world,
        placed_shelters,
    )
    if not fail_a and not fail_b and not geom_fails_plus:
        return ShelterDecision(
            shelter=1,
            side=1,
            rect=rect_plus,
            in_building=in_building,
            vetoes=(),
        )

    rect_minus = _shelter_rect(orient_info, -1)
    geom_fails_minus = _eval_shelter_geometry(
        rect_minus,
        in_building,
        orient_info.road_union,
        walkable_union,
        world,
        placed_shelters,
    )
    if not fail_a and not fail_b and not geom_fails_minus:
        return ShelterDecision(
            shelter=1,
            side=-1,
            rect=rect_minus,
            in_building=in_building,
            vetoes=(),
        )

    vetoes: set[str] = set()
    if fail_a:
        vetoes.add("a")
    if fail_b:
        vetoes.add("b")
    if geom_fails_plus and geom_fails_minus:
        common = geom_fails_plus & geom_fails_minus
        vetoes.update(common if common else (geom_fails_plus | geom_fails_minus))

    return ShelterDecision(
        shelter=0,
        side=0,
        rect=None,
        in_building=in_building,
        vetoes=tuple(sorted(vetoes)),
    )


def _find_non_gb2312_chars(names: Iterable[str]) -> list[str]:
    bad: set[str] = set()
    for name in names:
        for ch in name:
            try:
                ch.encode("gb2312")
            except UnicodeEncodeError:
                bad.add(ch)
    return sorted(bad)


def _select_samples_shelter_1(
    records: Sequence[dict[str, Any]], count: int = 5
) -> list[dict[str, Any]]:
    """尽量按不同 cls 挑选 count 个 shelter=1 的站点（优先有站名）。"""
    eligible = [r for r in records if r["shelter"] == 1]
    if not eligible:
        return []

    by_cls: dict[str, list[dict[str, Any]]] = {}
    for rec in eligible:
        by_cls.setdefault(rec["cls"] or "none", []).append(rec)
    for items in by_cls.values():
        items.sort(key=lambda r: (r["name"] == "", r["z"], r["x"]))

    priority_index = {c: i for i, c in enumerate(_CLASS_PRIORITY)}
    ordered_classes = sorted(
        by_cls.keys(), key=lambda c: (priority_index.get(c, 999), c)
    )

    picked: list[dict[str, Any]] = []
    cursors = {c: 0 for c in ordered_classes}
    while len(picked) < count:
        progressed = False
        for cls in ordered_classes:
            idx = cursors[cls]
            items = by_cls[cls]
            if idx < len(items):
                rec = items[idx]
                cursors[cls] = idx + 1
                picked.append(
                    {
                        "x": rec["x"],
                        "z": rec["z"],
                        "name": rec["name"],
                        "cls": rec["cls"] or "none",
                    }
                )
                progressed = True
                if len(picked) >= count:
                    break
        if not progressed:
            break
    return picked


def _select_samples_shelter_0(
    records: Sequence[dict[str, Any]], count: int = 3
) -> list[dict[str, Any]]:
    """挑选 count 个 shelter=0 的代表站点（优先有站名且覆盖不同否决原因）。"""
    eligible = [r for r in records if r["shelter"] == 0]
    if not eligible:
        return []

    ranked = sorted(eligible, key=lambda r: (r["name"] == "", r["z"], r["x"]))
    picked: list[dict[str, Any]] = []
    seen_reasons: set[str] = set()
    used_ids: set[int] = set()

    for idx, rec in enumerate(ranked):
        reason_key = "far" if rec["far"] else (",".join(rec["vetoes"]) or "other")
        if reason_key in seen_reasons:
            continue
        seen_reasons.add(reason_key)
        used_ids.add(idx)
        picked.append(
            {
                "x": rec["x"],
                "z": rec["z"],
                "name": rec["name"],
                "cls": rec["cls"] or "none",
            }
        )
        if len(picked) >= count:
            return picked

    for idx, rec in enumerate(ranked):
        if idx in used_ids:
            continue
        picked.append(
            {
                "x": rec["x"],
                "z": rec["z"],
                "name": rec["name"],
                "cls": rec["cls"] or "none",
            }
        )
        if len(picked) >= count:
            break
    return picked


def _print_report(report: dict[str, Any]) -> None:
    print("=== Bus Stops Pipeline Report ===")
    print(f"Chunks:            {report['chunks']}")
    print(f"Trees:             {report['trees']}")
    print(f"Clutter:           {report['clutter']}")
    print(f"GLC stops:         {report['glc_stops']}")
    print(f"OSM stops:         {report['osm_stops']}")
    print(f"Matched:           {report['matched']}")
    print(f"Written:           {report['written']}")
    print(f"Named:             {report['named']}")
    print(f"Unmatched OSM:     {report['unmatched_osm']}")
    print(f"Far (>8m / empty): {report['far']}")
    print(f"In building:       {report['in_building']}")

    ys = report["yaw_sources"]
    print(
        f"Yaw sources:       centreline={ys['centreline']}, "
        f"kerb={ys['kerb']}, none={ys['none']}"
    )

    sh = report["shelter"]
    print(f"Shelter:           1={sh['1']}, 0={sh['0']}")
    vetoes = report["shelter_vetoes"]
    veto_str = ", ".join(f"{k}={vetoes[k]}" for k in VETO_KEYS)
    print(f"Shelter vetoes:    {veto_str}")

    bad_chars = report["non_gb2312_chars"]
    print(
        f"Non-GB2312 chars:  {''.join(bad_chars) if bad_chars else '(none)'} "
        f"({len(bad_chars)})"
    )

    cls_dist = report["cls_distribution"]
    cls_str = ", ".join(f"{k}={v}" for k, v in cls_dist.items())
    print(f"Highway cls:       {cls_str or '(none)'}")

    print("Samples (shelter=1):")
    for s in report["samples_shelter_1"]:
        print(f"  x={s['x']:.2f}, z={s['z']:.2f}, name={s['name']!r}, cls={s['cls']}")

    print("Samples (shelter=0):")
    for s in report["samples_shelter_0"]:
        print(f"  x={s['x']:.2f}, z={s['z']:.2f}, name={s['name']!r}, cls={s['cls']}")


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="生成桂林OL公交站外挂数据 public/street-furniture/bus-stops.json"
    )
    parser.add_argument("--world", type=Path, required=True, help="世界块目录（含 manifest.json）")
    parser.add_argument("--osm", type=Path, required=True, help="OSM Overpass 快照 JSON 路径")
    parser.add_argument("--out", type=Path, required=True, help="输出 bus-stops.json 路径")
    parser.add_argument("--report", type=Path, default=None, help="可选，输出统计报告 JSON 路径")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)

    try:
        world = read_world(args.world)
        osm = read_osm(args.osm)
    except (FileNotFoundError, ValueError, json.JSONDecodeError, KeyError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    matched_map, unmatched_osm_count = match(world.stops, osm.stops, MATCH_MAX_DIST_M)

    oriented_stops: list[_OrientedStop] = []
    for idx, (px, pz) in enumerate(world.stops):
        orient_info = orient(Point(px, pz), world, osm)
        out_x = _clean_float(orient_info.pole_x, 2)
        out_z = _clean_float(orient_info.pole_z, 2)
        out_yaw = _clean_float(orient_info.yaw, 3)
        oriented_stops.append(
            _OrientedStop(
                orig_idx=idx,
                orig_x=px,
                orig_z=pz,
                out_x=out_x,
                out_z=out_z,
                out_yaw=out_yaw,
                orientation=orient_info,
                osm_stop=matched_map.get(idx),
            )
        )

    # 按输出顺序 (round(z), round(x)) 排序，再以精确坐标和原序号打破平局保证可复现
    oriented_stops.sort(
        key=lambda item: (
            round(item.out_z),
            round(item.out_x),
            item.out_z,
            item.out_x,
            item.orig_idx,
        )
    )

    placed_shelters: list[Polygon] = []
    output_rows: list[list[Any]] = []
    report_records: list[dict[str, Any]] = []

    yaw_source_counts: Counter[str] = Counter()
    cls_counts: Counter[str] = Counter()
    veto_counts: Counter[str] = Counter()
    far_count = 0
    in_building_count = 0
    shelter_1_count = 0
    shelter_0_count = 0
    named_count = 0

    for item in oriented_stops:
        decision = shelter_for(
            Point(item.orig_x, item.orig_z),
            item.orientation,
            item.osm_stop,
            world,
            placed_shelters,
        )
        if decision.shelter == 1 and decision.rect is not None:
            placed_shelters.append(decision.rect)
            shelter_1_count += 1
        else:
            shelter_0_count += 1

        if item.orientation.far:
            far_count += 1
        if decision.in_building:
            in_building_count += 1

        yaw_source_counts[item.orientation.yaw_source] += 1
        cls_counts[item.orientation.cls or "none"] += 1
        for key in decision.vetoes:
            veto_counts[key] += 1

        # 落在建筑里、或 8 m 内找不到车道的站点不输出：那里立牌只会穿模或对着空地。
        if item.orientation.far or decision.in_building:
            continue

        name = item.osm_stop.name if item.osm_stop is not None else ""
        en = item.osm_stop.en if item.osm_stop is not None else ""
        if name:
            named_count += 1

        output_rows.append(
            [
                item.out_x,
                item.out_z,
                item.out_yaw,
                decision.shelter,
                decision.side,
                name,
                en,
            ]
        )
        report_records.append(
            {
                "x": item.out_x,
                "z": item.out_z,
                "name": name,
                "cls": item.orientation.cls,
                "shelter": decision.shelter,
                "far": item.orientation.far,
                "vetoes": decision.vetoes,
            }
        )

    payload = {
        "version": 1,
        "osm": args.osm.stem,
        "world": world.terrain_sha256[:12],
        "license": "© OpenStreetMap contributors, ODbL-1.0",
        "stops": output_rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    cls_distribution = dict(
        sorted(cls_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    )
    report: dict[str, Any] = {
        "chunks": world.chunk_count,
        "trees": len(world.trees),
        "clutter": len(world.clutter),
        "glc_stops": len(world.stops),
        "osm_stops": len(osm.stops),
        "matched": len(matched_map),
        "written": len(output_rows),
        "named": named_count,
        "unmatched_osm": unmatched_osm_count,
        "far": far_count,
        "in_building": in_building_count,
        "yaw_sources": {
            "centreline": yaw_source_counts["centreline"],
            "kerb": yaw_source_counts["kerb"],
            "none": yaw_source_counts["none"],
        },
        "shelter": {
            "1": shelter_1_count,
            "0": shelter_0_count,
        },
        "shelter_vetoes": {k: veto_counts[k] for k in VETO_KEYS},
        "non_gb2312_chars": _find_non_gb2312_chars(r["name"] for r in report_records),
        "cls_distribution": cls_distribution,
        "samples_shelter_1": _select_samples_shelter_1(report_records, 5),
        "samples_shelter_0": _select_samples_shelter_0(report_records, 3),
    }

    _print_report(report)
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
