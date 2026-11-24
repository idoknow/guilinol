"""Guilin Station survey and local DEM conditioning in the project metre grid."""

import json
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter
from shapely import intersects_xy, union_all
from shapely.geometry import LineString, Polygon, box

from common import GRID, ll2xz, load_osm
from features import area, points

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


def grade_station(terrain, underlay, water, left, top, carriageways, sidewalks):
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
    rails = []
    for way in load_osm():
        if way.get("tags", {}).get("railway") == "rail" and way["type"] == "way":
            line = LineString(points(way))
            if line.intersects(extent):
                rails.append(line.buffer(9))
    protected = union_all(
        [carriageways.intersection(extent), sidewalks.intersection(extent), *rails]
    )
    locked = intersects_xy(protected.buffer(10), x, z) | (water[window] != -32768)
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
    terrain[window] += delta
    underlay[window] += delta


def station_paving(plazas, bounds):
    survey = footprints()
    if not survey["plaza"].intersects(bounds):
        return plazas, [], []
    ref = next(
        (area(e) for e in load_osm() if e["type"] == "way" and e["id"] == 1056261582),
        None,
    )
    # The old plaza stays in the grade solver. Only its render mesh is replaced.
    other = [p for p in plazas if ref is None or not p.equals(ref)]
    return other, [survey["plaza"]], [survey["taxi"]]
