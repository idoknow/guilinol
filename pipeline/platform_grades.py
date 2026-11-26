"""Transfer the adjacent rails' vertical movement to both edges of an OSM platform."""

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box

from features import area, points


def passenger_profiles(directory, polygon, rise):
    from check_rail_platforms import rail_chords
    from island_transects import transects

    rails = rail_chords(directory, polygon.buffer(16))
    keys = list(rails)
    lines = [LineString([k[:2], k[2:]]) for k in keys]
    rows = []
    for section in transects(polygon, lines):
        if section is None:
            continue
        probes, left, right = section
        heights = [np.dot([1-t, t], rails[keys[i]]) + rise for i, t in (left, right)]
        a, b = probes[[0, -1]]
        across = b - a
        across /= np.linalg.norm(across)
        # Store the actual edges, restoring the survey's 8 cm inward offset.
        rows.append((a-.08*across, b+.08*across, heights))
    if not rows:
        raise ValueError("Island platform without paired boarding tracks")
    along = np.array([across[1], -across[0]])
    if np.dot(rows[-1][0]-rows[0][0], along) < 0:
        along *= -1
    return along, across, rows


def mark_platform_grades(directory, manifest, ways, sections):
    for section in sections:
        ids = section.get("fitPlatforms", [])
        if not ids:
            continue
        outlines = manifest.get("platformOutlines", {})
        platforms = [Polygon(outlines[str(wid)]) if str(wid) in outlines else area(ways[wid]) for wid in ids]
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

        for wid, platform in zip(ids, platforms):
            if wid in section.get("islandPlatforms", []):
                along, across, samples = passenger_profiles(directory, platform, section["islandBoardingHeightM"])
                for tile in manifest["chunks"]:
                    origin = np.array([tile["x"], tile["z"]])
                    cell = box(*origin, *(origin + 256))
                    if not platform.intersects(cell):
                        continue
                    stations = (np.asarray(cell.exterior.coords) - origin) @ along
                    lo, hi = stations.min()-18, stations.max()+18
                    rows = [[float((a-origin) @ along), float((a-origin) @ across),
                             float((b-origin) @ across), *heights] for a, b, heights in samples
                            if lo < (a-origin) @ along < hi]
                    ring = (np.asarray(platform.buffer(.025, join_style="mitre").exterior.coords)-origin).round(4)
                    tile.setdefault("stationPaving", {}).setdefault("platformGrades", []).append(
                        dict(ring=ring.tolist(), rows=np.round(rows, 6).tolist(), along=along.tolist(), across=across.tolist()))
                continue
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
