"""Classify finished non-rail faces intersecting the full rail survey strip.

Run from the repository root. JSON contains one entry per failing chord and
category, signed crossing-pavement errors, and the spans of shared crossings.
"""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

import numpy as np
from shapely import LineString, MultiPoint, Point, Polygon, STRtree, union_all
from shapely import get_coordinates

from check_dingjiang_rail_clearance import (
    BRIDGES,
    coupled_road_crossings,
    encoded_track,
)
from check_rail_overbridges import check as check_overbridges
from common import load_osm
from features import points
from station_roads import half_width

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 0.05
# OSM axis geometry uses metre coordinates; emitted pavement / deck XY uses cm.
XY_TOLERANCE = 0.008


def geometry(vertices):
    return MultiPoint([(v[0], v[1]) for v in vertices]).convex_hull


def excess_polygon(vertices, limit):
    out = []
    for a, b in zip(vertices, vertices[1:] + vertices[:1]):
        u, v = a[3] - limit, b[3] - limit
        if u >= 0:
            out.append(a)
        if (u < 0) != (v < 0):
            out.append([lo + (hi - lo) * u / (u - v) for lo, hi in zip(a, b)])
    return geometry(out)


def run(world, faces):
    manifest = json.loads((world / "manifest.json").read_bytes())
    tiles = {(t["x"], t["z"]): t for t in manifest["chunks"]}
    ways = {
        w["id"]: w
        for w in load_osm()
        if w["type"] == "way" and len(w.get("geometry", [])) >= 2
    }
    platforms = []
    for w in ways.values():
        tags = w.get("tags", {})
        if "platform" not in (tags.get("railway"), tags.get("public_transport")):
            continue
        xy = points(w)
        if xy[0] == xy[-1] and len(xy) > 3:
            platforms.append(Polygon(xy).buffer(0))
        else:
            platforms.append(LineString(xy).buffer(float(tags.get("width", "1")) / 2))
    platform = union_all(platforms).buffer(XY_TOLERANCE)
    design = json.loads(
        (ROOT / "pipeline/rail-audits/05-guilinbei-bridges.json").read_bytes()
    )
    checked = check_overbridges(world, design)
    if any(r["minimumM"] < r["targetM"] for r in checked):
        raise ValueError("Overbridge clearance failed")
    first = coupled_road_crossings(world)
    if any(r["minimumM"] < r["targetM"] - 1e-7 for r in first):
        raise ValueError("First-section deck clearance failed")
    widths = {d["way"]: d["halfWidthM"] for d in design["roadDecks"]}
    widths.update({r["road"]: 5 for r in first if r["road"] in BRIDGES})
    decks = {
        wid: LineString(points(ways[wid])).buffer(width + 0.02, cap_style="flat")
        for wid, width in widths.items()
    }
    floors = defaultdict(list)
    for t in manifest["tunnels"]:
        a, b = t["portals"]
        floors[t["way"]].append(
            (LineString([(a[0], a[2]), (b[0], b[2])]), t["halfWidth"])
        )
    cross = defaultdict(list)
    records = json.loads((ROOT / "docs/railway-crossings.json").read_bytes())
    for r in records:
        if r["type"] == "level":
            cross[r["rail"]].append(r["road"])
    levelroads = {w for roads in cross.values() for w in roads}
    crossing_parts = {}
    lines_by_id = {}
    for w in levelroads:
        axis = lines_by_id[w] = LineString(points(ways[w]))
        native_width = half_width(ways[w]) + 1
        if floors[w]:
            # A way may have a graded approach kilometres from its level crossing.
            # Retain the native pavement on every ungraded part of that same way.
            profiles = union_all([a for a, _ in floors[w]])
            native = axis.difference(profiles.buffer(XY_TOLERANCE, cap_style="flat"))
            graded_band = union_all([a.buffer(b + 1, cap_style="flat") for a, b in floors[w]])
            native_band = native.buffer(native_width, cap_style="flat").difference(graded_band)
            crossing_parts[w] = [(graded_band, True), (native_band, False)]
        else:
            crossing_parts[w] = [(axis.buffer(native_width), False)]
    style = json.loads((ROOT / "pipeline/railway-style.json").read_bytes())
    strip_width = style["ballastHalfWidth"] + 2
    parts_by_rail = defaultdict(list)
    for rail, roads in cross.items():
        track = LineString(points(ways[rail]))
        for road in roads:
            for band, graded in crossing_parts[road]:
                if floors[road]:
                    # The same road may run parallel to this rail further away.
                    # Use only the connected track interval containing the level crossing.
                    crossing = track.intersection(lines_by_id[road])
                    clipped = track.intersection(band)
                    connected = [part for part in getattr(clipped, "geoms", [clipped])
                                 if not part.is_empty and part.distance(crossing) < XY_TOLERANCE]
                    band = band.intersection(union_all(connected).buffer(strip_width, cap_style="square"))
                if not band.is_empty:
                    parts_by_rail[rail].append((road, band, graded))
    axes = []
    road_ids = []
    widths = []
    for wid, w in ways.items():
        tags = w.get("tags", {})
        if (
            not tags.get("highway")
            or tags.get("bridge") == "yes"
            or tags.get("tunnel") == "yes"
            or tags.get("indoor") == "yes"
        ):
            continue
        if floors.get(wid):
            for axis, width in floors[wid]:
                axes.append(axis)
                road_ids.append(wid)
                widths.append(width)
        for a, b in zip(points(w), points(w)[1:]):
            if a == b:
                continue
            axes.append(LineString([a, b]))
            road_ids.append(wid)
            widths.append(half_width(w))
    maxwidth = max(widths) + XY_TOLERANCE
    tree = STRtree(axes)
    cache = {}
    summary = defaultdict(dict)
    registered = defaultdict(set)
    b_count = defaultdict(int)
    from rail_sections import designs
    panel_roads = {wid for design in designs() for wid in design.get("panelRoads", [])}
    steel_bands = {}
    covered_heads = defaultdict(dict)

    def add(section, category, i, row, error, role, pos, road=None):
        entry = summary[section].setdefault(category, {})
        if i not in entry or error > entry[i]["excessOverLimit"]:
            entry[i] = dict(
                rail=row[0],
                chord=row[1:],
                excessOverLimit=round(error, 7),
                unit="m/m" if category in ("C_transition", "C_longitudinal") else "m",
                role=role,
                xz=pos,
                road=road,
            )

    for line in faces:
        sec, i, row, role, owner, vertices, gradient = json.loads(line)
        w, x, z, h, bx, bz, bh, _ = row
        if role in ("visible-carriageway", "paving-0") and max(v[3] for v in vertices) >= -.02:
            roads = panel_roads.intersection(cross.get(w, []))
            if roads:
                key = (sec, i)
                if key not in steel_bands:
                    axis = LineString([(x,z),(bx,bz)])
                    heads = []
                    for sign in (-1,1):
                        offset = sign * (style["gauge"] + style["headWidth"]) / 2
                        head = axis.offset_curve(offset).buffer(style["headWidth"]/2, cap_style="flat")
                        for road, band, _ in parts_by_rail[w]:
                            if road not in roads:
                                continue
                            footprint = head.intersection(band)
                            if not footprint.is_empty:
                                heads.append((road,sign,footprint))
                    steel_bands[key] = heads
                # Include coplanar asphalt and surfaces within the crossing's
                # 2 cm fit tolerance, as well as faces projecting above the head.
                if steel_bands[key]:
                    near_top = excess_polygon(vertices, -.02)
                    for road,side,head in steel_bands[key]:
                        hit = head.intersection(near_top)
                        if hit.area > 1e-7:
                            key = (w,side)
                            if key not in covered_heads[road] or hit.area > covered_heads[road][key]["area"]:
                                pos = hit.representative_point()
                                covered_heads[road][key] = dict(rail=w,side=side,role=role,owner=owner,area=hit.area,x=pos.x,z=pos.y)
        if role == "visible-carriageway":
            continue
        if i not in cache:
            axis = LineString([(x, z), (bx, bz)])
            band = axis.buffer(3.7, cap_style="flat")
            direction = np.array([bx - x, bz - z]) / axis.length
            parallel = []
            for j in tree.query(band, predicate="dwithin", distance=maxwidth):
                other = axes[j]
                u = np.subtract(other.coords[-1], other.coords[0]) / other.length
                if abs(u @ direction) < 0.96:
                    continue
                if other.distance(band) > widths[j] + XY_TOLERANCE:
                    continue
                parallel.append(
                    (
                        road_ids[j],
                        other.buffer(widths[j] + XY_TOLERANCE, cap_style="flat"),
                    )
                )
            cache[i] = parallel
        high = max(vertices, key=lambda v: v[3])
        if role == "deck":
            footprint = geometry(vertices)
            if min(v[3] for v in vertices) > 0 and any(
                d.covers(footprint) for d in decks.values()
            ):
                b_count[sec] += 1
                continue
        if role in ("paving-0", "graded-floor"):
            footprint = geometry(vertices)
            if footprint.area < 1e-10 or gradient is None:
                # The chord's cap can touch the edge of an otherwise valid face.
                # Resolve its values on the sampled edge by linear interpolation.
                plane = None
            else:
                plane = np.asarray(gradient)

            def samples(part):
                loc = get_coordinates(part)
                arr = np.asarray(vertices)
                if plane is None:
                    arr = np.asarray(vertices)
                    v = arr[:, :2] - arr[0, :2]
                    far = np.argmax(np.sum(v * v, axis=1))
                    span = v[far] @ v[far]
                    elev = (
                        arr[0, 2]
                        + ((loc - arr[0, :2]) @ v[far])
                        * (arr[far, 2] - arr[0, 2])
                        / span
                        if span > 1e-12
                        else np.full(len(loc), arr[:, 2].max())
                    )
                else:
                    elev = arr[0, 2] + (loc - arr[0, :2]) @ plane
                along = (loc[:, 0] - x) * (bx - x) + (loc[:, 1] - z) * (bz - z)
                signed = elev - h - along * (bh - h) / ((bx - x) ** 2 + (bz - z) ** 2)
                return loc, signed

            remaining = footprint
            for road, band, graded in parts_by_rail.get(w, ()):
                if owner not in (None, road):
                    continue
                part = remaining.intersection(band)
                if part.is_empty:
                    continue
                registered[sec].add(road)
                loc, gap = samples(part)
                # At stacked roads a lower sheet is not the crossing surface.
                # The signed finished floor is continuous across the road width.
                # Still test all protruding native paving against the upper limit.
                owns_grade = owner == road or not graded
                error = (
                    np.maximum(gap - 0.05, -0.02 - gap) if owns_grade else gap - 0.05
                )
                k = error.argmax()
                if error[k] > 1e-7:
                    add(
                        sec, "C_pavement", i, row, error[k], role, loc[k].tolist(), road
                    )
                if plane is not None and owns_grade:
                    rail = np.array([bx - x, bz - z])
                    rail /= np.linalg.norm(rail)
                    at = Point(loc[0])
                    axis = lines_by_id[road]
                    sta = axis.project(at)
                    tangent = np.subtract(
                        axis.interpolate(min(axis.length, sta + 0.05)).coords[0],
                        axis.interpolate(max(0, sta - 0.05)).coords[0],
                    )
                    for category, vec, limit in [
                        ("C_transition", rail, 0.025),
                        ("C_longitudinal", tangent / np.linalg.norm(tangent), 0.08),
                    ]:
                        excess = abs(plane @ vec) - limit
                        if excess > 1e-6:
                            add(
                                sec,
                                category,
                                i,
                                row,
                                excess,
                                "slope excess (m/m)",
                                loc[0].tolist(),
                                road,
                            )
                remaining = remaining.difference(band)
                if remaining.is_empty:
                    break
            for road, area in cache[i]:
                if remaining.is_empty:
                    break
                if owner not in (None, road):
                    continue
                part = remaining.intersection(area)
                if part.is_empty:
                    continue
                loc, gap = samples(part)
                k = abs(gap).argmax()
                if abs(gap[k]) > 0.5 + 1e-7:
                    add(
                        sec, "D", i, row, abs(gap[k]) - 0.5, role, loc[k].tolist(), road
                    )
                remaining = remaining.difference(area)
            if remaining.is_empty:
                continue
            if high[3] > LIMIT:
                loc, gap = samples(remaining)
                k = gap.argmax()
                if gap[k] > LIMIT + 1e-7:
                    add(sec, "A", i, row, gap[k] - LIMIT, role, loc[k].tolist(), owner)
            continue
        if high[3] <= LIMIT:
            continue
        over = excess_polygon(vertices, LIMIT)
        if role == "paving-1" and platform.covers(over):
            continue
        add(
            sec,
            "A" if role != "deck" else "unverifiedDeck",
            i,
            row,
            high[3] - 0.05,
            role,
            high[:2],
            owner,
        )
    levels = {}
    for sec, roads in registered.items():
        for road in roads:
            axis = LineString(points(ways[road]))
            heights = []
            for rail, ids in cross.items():
                if road not in ids:
                    continue
                alignment = LineString(points(ways[rail]))
                p = alignment.intersection(axis)
                if p.geom_type != "Point":
                    raise ValueError(f"Ambiguous crossing {rail}/{road}")
                tile = tiles[(int(p.x // 256) * 256, int(p.y // 256) * 256)]
                y = encoded_track(world, tile, p, alignment)[0]
                heights.append([rail, y])
            levels[road] = dict(
                section=sec,
                rails=heights,
                spreadM=max(h for _, h in heights) - min(h for _, h in heights),
            )
    return dict(
        chords={
            s: {k: list(v.values()) for k, v in cats.items()}
            for s, cats in summary.items()
        },
        verifiedOverheadFaces=dict(b_count),
        crossings=levels,
        railHeadsChecked={road: 2*len(levels[road]["rails"]) for road in sorted(panel_roads)},
        coveredRailHeads={road: list(covered_heads[road].values()) for road in sorted(panel_roads)},
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("world", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "faces.ndjson"
        subprocess.run(
            [
                ROOT / "node_modules/.bin/tsx",
                ROOT / "scripts/audit-track-surfaces.ts",
                args.world,
                path,
            ],
            stdout=subprocess.DEVNULL,
            check=True,
        )
        with path.open() as f:
            report = run(args.world, f)
    print(json.dumps(report, indent=2))
    raise SystemExit(
        int(
            bool(report["chords"]) or any(report["coveredRailHeads"].values())
            or any(q["spreadM"] > 0.05 for q in report["crossings"].values())
        )
    )
