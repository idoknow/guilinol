"""Transfer the adjacent rails' vertical movement to both edges of an OSM platform."""

import numpy as np
from shapely import LineString, Point, STRtree, box

from features import area, points


def mark_platform_grades(manifest, ways, sections):
    for section in sections:
        ids = section.get("fitPlatforms", [])
        if not ids:
            continue
        platforms = [area(ways[wid]) for wid in ids]
        station = box(*np.asarray([p.bounds for p in platforms]).reshape(-1, 2).min(axis=0),
                      *np.asarray([p.bounds for p in platforms]).reshape(-1, 2).max(axis=0))
        tracks = {}
        for wid, way in ways.items():
            if way.get("tags", {}).get("railway") != "rail":
                continue
            line = LineString(points(way))
            if line.distance(station) < 15:
                tracks[wid] = line
        ids_by_index = list(tracks)
        nearby = STRtree(list(tracks.values()))
        offsets = {int(wid): np.asarray(profile["offsets"]).T
                   for wid, profile in section["railProfiles"].items()}

        def shift(x, z):
            point = Point(x, z)
            wid = ids_by_index[int(nearby.nearest(point))]
            if wid not in offsets:
                return 0.
            return np.interp(tracks[wid].project(point), *offsets[wid], left=0, right=0)

        for platform in platforms:
            left, start, right, end = platform.bounds
            rows = []
            for z in np.linspace(start+.001, end-.001, int(np.ceil(end-start))+1):
                span = platform.intersection(LineString([(left-1, z), (right+1, z)]))
                a, _, b, _ = span.bounds
                rows.append((z, a, b, shift(a, z), shift(b, z)))
            for tile in manifest["chunks"]:
                x, z = tile["x"], tile["z"]
                if not platform.intersects(box(x, z, x+256, z+256)):
                    continue
                local = [[round(s-z, 4), round(a-x, 4), round(b-x, 4), round(dl, 6), round(dr, 6)]
                         for s, a, b, dl, dr in rows if z-2 <= s <= z+258]
                if not local or not any(dl or dr for _, _, _, dl, dr in local):
                    continue
                ring = [[round(px-x, 4), round(pz-z, 4)] for px, pz in platform.buffer(.025, join_style="mitre").exterior.coords]
                style = tile.setdefault("stationPaving", {})
                style.setdefault("platformGrades", []).append(dict(ring=ring, rows=local))
