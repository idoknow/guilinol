"""Guilin Station survey and local DEM conditioning in the project metre grid."""

import json
import math
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
from shapely import (
    distance as distance_to,
    intersects_xy,
    points as grid_points,
    union_all,
)
from shapely.geometry import LineString, Polygon, box

from common import GRID, ll2xz, load_osm
from features import area, points
from road_grading import eval_bspline_grid

ROOT = Path(__file__).resolve().parents[1]
ANCHOR = (110.278235, 25.263846)
CENTER = ll2xz(*reversed(ANCHOR))


def footprints():
    features = json.loads((ROOT / "docs/layout/guilin-station.geojson").read_text())[
        "features"
    ]
    return {
        f["properties"]["id"]: Polygon(
            [ll2xz(lat, lon) for lon, lat in f["geometry"]["coordinates"][0]]
        )
        for f in features
    }


def grade_station(
    terrain, underlay, water, left, top, carriageways, sidewalks, road_ctrl
):
    """Filter dry ground; taper into existing rail beds, streets and the outer ring."""
    radius = 580
    east, south = CENTER
    start = np.maximum(
        0, np.floor((np.array(CENTER) - radius - [left, top]) / GRID)
    ).astype(int)
    stop = np.minimum(
        terrain.shape[::-1],
        np.ceil((np.array(CENTER) + radius - [left, top]) / GRID) + 1,
    ).astype(int)
    if np.any(stop <= start):
        return
    x = left + GRID * np.arange(start[0], stop[0])
    z = top + GRID * np.arange(start[1], stop[1])[:, None]
    window = np.s_[start[1] : stop[1], start[0] : stop[0]]
    extent = box(x[0], z[0, 0], x[-1], z[-1, 0])
    from station_roads import half_width
    from traffic import MOTOR

    corridors = [carriageways.intersection(extent), sidewalks.intersection(extent)]
    for way in load_osm():
        tags = way.get("tags", {})
        if way["type"] != "way":
            continue
        rail = tags.get("railway") == "rail"
        motor = tags.get("highway", "").removesuffix("_link") in MOTOR
        if not (rail or motor):
            continue
        coords = points(way)
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if line.intersects(extent):
            corridors.append(line.buffer(9 if rail else half_width(way)))
    # Traffic and collision interpolate across the coarser chunk-edge stencil.
    protected = union_all(corridors).buffer(32)
    locked = intersects_xy(protected, x, z) | (water[window] != -32768)
    distance = distance_transform_edt(~locked) * GRID
    weight = np.clip(distance / 18, 0, 1) * np.clip(
        (radius - np.hypot(x - east, z - south)) / 80, 0, 1
    )
    weight = weight**2 * (3 - 2 * weight)
    # Apply the same delta to both grids, preserving all existing grade separations.
    base = underlay[window].astype(float)
    delta = np.rint(
        (gaussian_filter(base, sigma=4.5, mode="nearest") - base) * weight
    ).astype("i2")
    # The railway release has a raised street spline at the forecourt. Bring
    # the bare ground up to its underside so the queue lane has a walkable edge.
    survey = footprints()
    forecourt = union_all([survey["plaza"], survey["taxi"]]).convex_hull.buffer(9)
    xx, zz = np.broadcast_arrays(x, z)
    apron_weight = np.clip(1 - distance_to(grid_points(xx, zz), forecourt) / 22, 0, 1)
    apron_weight = apron_weight**2 * (3 - 2 * apron_weight)
    road_surface = eval_bspline_grid(road_ctrl, left, top, xx, zz)
    extra = np.maximum(0, 10 * (road_surface - 0.04) - (base + delta))
    delta += np.rint(extra * apron_weight * (water[window] == -32768)).astype("i2")
    terrain[window] += delta
    underlay[window] += delta


def station_paving(plazas, bounds):
    survey = footprints()
    if not survey["plaza"].intersects(bounds):
        return plazas, [], [], Polygon()
    ref = next(
        (area(e) for e in load_osm() if e["type"] == "way" and e["id"] == 1056261582),
        None,
    )
    # The old plaza stays in the grade solver. Only its render mesh is replaced.
    other = [p for p in plazas if ref is None or not p.equals(ref)]
    planting = union_all([survey["planter-north"], survey["planter-south"]])
    # The retired hall outline and the open-sided bus shelter must not clip
    # the continuous sidewalk, bike lane or tactile strips passing beneath them.
    former_shells = {e["id"]: area(e) for e in load_osm()
                     if e["type"] == "way" and e["id"] in (819178841, 1017598916)}
    solid = union_all([survey[k] for k in ("wall", "north-wing", "south-wing")])
    open_ground = union_all(list(former_shells.values())).buffer(0.05).difference(solid)
    walk = [survey["plaza"].difference(planting)]
    if 1017598916 in former_shells:
        walk.append(former_shells[1017598916].buffer(1.15, join_style="mitre"))
    return other, walk, [survey["taxi"]], open_ground


def mark_station_tiles(chunks):
    """Material coordinates on the existing square and native platform triangles."""
    plaza = footprints()["plaza"]
    edges = []
    for way in load_osm():
        if way["type"] == "way" and way["id"] in range(376029417, 376029421):
            ring = list(area(way).exterior.coords)
            edges.extend(LineString([a, b]) for a, b in zip(ring, ring[1:])
                         if abs(b[1] - a[1]) > 2 * abs(b[0] - a[0]))
    bounds = union_all([plaza, *edges]).bounds
    for chunk in chunks:
        x, z = chunk["x"], chunk["z"]
        if x + 256 < bounds[0] or z + 256 < bounds[1] or x > bounds[2] or z > bounds[3]:
            continue
        tile = box(x, z, x + 256, z + 256)
        def local(ring):
            return [[round(px - x, 3), round(pz - z, 3)] for px, pz in ring]
        materials = {}
        if plaza.intersects(tile):
            materials["plaza"] = local(plaza.exterior.coords)
        nearby = [local(edge.coords) for edge in edges if edge.distance(tile) < 8]
        if nearby:
            materials["platformEdges"] = nearby
        if materials:
            chunk["stationPaving"] = materials


def canopy_stations(length, spacing):
    half = length / 2 - 12
    return np.linspace(-half, half, math.ceil(2 * half / spacing) + 1)


def platform_walking_area(way):
    platform = area(way)
    if way["id"] not in range(376029417, 376029421):
        return platform
    coords = np.asarray(platform.exterior.coords)
    edges = np.diff(coords, axis=0)
    lengths = np.linalg.norm(edges, axis=1)
    i = lengths.argmax()
    axis = edges[i] / lengths[i]
    side = np.array([-axis[1], axis[0]])
    mid = np.asarray(platform.centroid.coords[0])
    style = json.loads((ROOT / "pipeline/railway-style.json").read_text())["station"]
    def plinth(center, width):
        return Polygon([center + (dx * axis + dz * side) * width / 2
                        for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    holes = [plinth(mid + axis * t, style["columnPlinth"])
             for t in canopy_stations(lengths[i], style["columnSpacing"])]
    overlap = platform.intersection(footprints()["crossing"])
    if not overlap.is_empty:
        holes.append(plinth(np.asarray(overlap.centroid.coords[0]), style["bridgePlinth"]))
    return platform.difference(union_all(holes))
