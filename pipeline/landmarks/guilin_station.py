"""Guilin Station after the 2021 refurbishment. All survey rings are project metres."""

import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely import constrained_delaunay_triangles, get_parts, union_all
from shapely.geometry import LineString
from shapely.affinity import translate

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import load_osm
from features import area, points
from seam_streets import Streets
from m26_16_kit import export_landmark_glb, get_font
from station_site import CENTER, ROOT, canopy_stations, footprints
from uni_kit import ccw, edges, fin, quad, slab
from world_surface import LandmarkSurface, Surface

RAILWAY_STYLE = json.loads((ROOT / "pipeline/railway-style.json").read_text())
STYLE = RAILWAY_STYLE["station"]
LEVELS = RAILWAY_STYLE["stationLevels"]
NAME = "guilin_station"


def local(poly):
    return translate(poly, -CENTER[0], -CENTER[1])


def facade(b, polygon, height, curtain=False):
    ring = ccw(polygon.exterior.coords)
    top = max(b.grade(*p) for p in ring) + height
    floor = LEVELS["hallFloor"] - b.surface.y
    if not curtain:
        sill, head = top - 4.0, top - 1.65
        base = min(b.grade(*p) for p in ring) - 0.045
        b.prism(ring, base, sill - base, "wall", collide=True, footing=True)
        b.prism(ring, head, top - head, "wall", cap_region="roof")
        for _, a, end, length, unit, normal in edges(ring, min_len=0.05):
            unit, normal = np.asarray(unit), np.asarray(normal)
            last = a
            for center in np.arange(4, length - 2, 6.5):
                left, right = a + unit * (center - 1.45), a + unit * (center + 1.45)
                quad(b, last, left, sill, head, 0, normal, "wall")
                quad(b, left, right, sill, head, -0.22, normal, "glass")
                if b.detail:
                    quad(b, left, left - 0.22 * normal, sill, head, 0, unit, "wall")
                    quad(b, right, right - 0.22 * normal, sill, head, 0, -unit, "wall")
                last = right
            quad(b, last, end, sill, head, 0, normal, "wall")
            b.hit_quad([(p[0], h, p[1]) for p, h in
                        ((a, sill), (end, sill), (end, top), (a, top))],
                       (normal[0], 0, normal[1]))
        return top

    # Cut the three passages through both the visible shell and its collision mesh.
    _, a, _, length, unit, normal = max(
        (e for e in edges(ring) if e[-1][0] > 0.8), key=lambda e: e[3]
    )
    unit, normal = np.asarray(unit), np.asarray(normal)
    portals = []
    lintel = floor + STYLE["entryHeight"]
    for fraction in (0.18, 0.50, 0.82):
        mid = a + unit * length * fraction
        axis = LineString([mid + normal * 5, mid - normal * 100])
        portals.append(axis.buffer(STYLE["entryWidth"] / 2, cap_style="flat"))
        # Fixed glazed sidelights frame a clear double-door opening.
        for side in (-1, 1):
            jamb = mid + unit * side * (STYLE["entryWidth"] / 2 - 1.05)
            p0, p1 = jamb - unit, jamb + unit
            quad(b, p0, p1, floor, lintel, -0.35, normal, "glass")
            quad(b, p0, p1, floor + 3.2, floor + 3.33, -0.32, normal, "frame")
            b.hit_quad([(p[0] - normal[0] * 0.35, h, p[1] - normal[1] * 0.35)
                        for p, h in ((p0, floor), (p1, floor), (p1, lintel), (p0, lintel))],
                       (normal[0], 0, normal[1]))
        if b.detail:
            slab(b, mid - unit * 5.5, mid + unit * 5.5,
                 lintel, 0.24, 1.3, normal, "frame")
    for pier in get_parts(polygon.difference(union_all(portals))):
        b.prism(pier.exterior.coords, 0, lintel, "wall", collide=True, footing=True)
    b.prism(ring, lintel, top - lintel, "wall", cap_region="roof")
    for clipped in get_parts(polygon.intersection(union_all(portals))):
        for tri in constrained_delaunay_triangles(clipped).geoms:
            b.face([(x, lintel, z) for x, z in list(tri.exterior.coords)[:3]],
                   (0, -1, 0), "soffit")
    for _, a, end, length, unit, normal in edges(ring):
        if abs(normal[0]) < 0.8 or length < 60:
            continue
        unit = np.asarray(unit)
        start, stop = a + unit * 2, end - unit * 2
        low, high = top - 5.8, top - 0.6
        quad(b, start, stop, low, high, 0.06, normal, "glass")
        if b.detail:
            for y in np.arange(low + 0.55, high, 0.55):
                quad(b, start, stop, y, y + 0.07, 0.10, normal, "frame")
            for offset in np.arange(4, length - 4, 4):
                mid = a + unit * offset
                quad(b, mid, mid + unit * 0.08, low, high, 0.11, normal, "frame")
    return top


def plinth(b, x, z, width, top):
    half = width / 2
    ring = [(x - half, z - half), (x + half, z - half),
            (x + half, z + half), (x - half, z + half)]
    low = min(b.grade(*p) for p in ring) - 0.05
    b.prism(ring, low, max(0.05, top - low), "frame", footing=True)


def platform(b, poly):
    ring = ccw(poly.exterior.coords)
    _, a, end, length, u, normal = max(edges(ring), key=lambda edge: edge[3])
    width = poly.area / length
    front = np.array(normal)
    # Frame X follows the long axis; all columns stay on the OSM platform.
    mid = np.array(poly.centroid.coords[0])
    old = b.set_frame((mid[0], 0, mid[1]), front)
    # The corridor produces a level 1.25 m platform above the station railhead.
    platform_y = LEVELS["hallFloor"] + LEVELS["platformRise"] - b.surface.y
    along = np.linspace(-length / 2 + 0.45, length / 2 - 0.45,
                        math.ceil(length / (12 if b.detail else 36)) + 1)
    half = width / 2 - 0.35
    across = [-half, half]

    def row_at(x):
        return [(x, platform_y + 0.025, z) for z in across]

    previous = row_at(along[0])
    for x in along[1:]:
        row = row_at(x)
        # Masonry fascia and a sloped toe stay within the mapped platform edge.
        for index, side in ((0, -1), (-1, 1)):
            p, q = previous[index], row[index]
            toe_z = p[2] + side * 0.25

            def base(vertex):
                return (vertex[0], b.grade(vertex[0], toe_z) - 0.04, toe_z)

            def shoulder(vertex):
                return (vertex[0], max(base(vertex)[1], vertex[1] - 0.22), vertex[2])

            b.face([p, q, shoulder(q), shoulder(p)], (0, 0, side), "frame")
            b.face(
                [shoulder(p), shoulder(q), base(q), base(p)], (0, 0.4, side), "soffit"
            )
        previous = row
    positions = canopy_stations(length, STYLE["columnSpacing"])
    levels = [platform_y + STYLE["canopyHeight"]] * len(positions)
    for i, (x, y) in enumerate(zip(positions, levels)):
        base = platform_y + 0.11
        plinth(b, x, 0, STYLE["columnPlinth"], base)
        b.cylinder_y(x, base, y - base, 0, 0.30, "wall", sections=8, collide=True)
        if i:
            prev, py = positions[i - 1], levels[i - 1]
            w = width * 0.47
            for side in (-1, 1):
                edge = side * w
                b.face(
                    [
                        (prev, py, 0),
                        (x, y, 0),
                        (x, y + 0.42, edge),
                        (prev, py + 0.42, edge),
                    ],
                    (0, 1, 0),
                    "roof",
                )
                b.face(
                    [
                        (prev, py - 0.22, 0),
                        (x, y - 0.22, 0),
                        (x, y + 0.20, edge),
                        (prev, py + 0.20, edge),
                    ],
                    (0, -1, 0),
                    "wall",
                )
                b.face(
                    [
                        (prev, py + 0.20, edge),
                        (x, y + 0.20, edge),
                        (x, y + 0.42, edge),
                        (prev, py + 0.42, edge),
                    ],
                    (0, 0, side),
                    "frame",
                )
    b.restore_frame(old)


def platform_access(b, streets):
    # Join the north exit forecourt to the east edge of the first platform.
    x, z = -2247.05 - CENTER[0], 1749.50 - CENTER[1]
    outward = np.array([0.993, -0.118])
    along = np.array([0.118, 0.993])
    rows = []
    for inset in (-1.5, 1.2, 11):
        row = []
        for side in (-2, 2):
            px, pz = np.asarray((x, z)) + inset * outward + side * along
            if inset <= 1.2:
                height = LEVELS["hallFloor"] + LEVELS["platformRise"]
            else:
                height, _ = streets.at(px + CENTER[0], pz + CENTER[1])
            row.append((px, height - b.surface.y + 0.025, pz))
        rows.append(row)
    for near, far in zip(rows, rows[1:]):
        floor = [near[0], near[1], far[1], far[0]]
        b.face(floor, (0, 1, 0), "frame", street_role="sidewalk")
        b.hit_quad(floor, (0, 1, 0))
        for index, side in ((0, -1), (1, 1)):
            a, c = near[index], far[index]
            wall = [a, c, (c[0], b.grade(c[0], c[2]) - 0.04, c[2]),
                    (a[0], b.grade(a[0], a[2]) - 0.04, a[2])]
            b.face(wall, (side * along[0], 0, side * along[1]), "frame")


def track_limits(ways, platforms):
    """Pedestrian collision at the rolling-stock envelope below the bridge deck."""
    extent = union_all(platforms).convex_hull.buffer(5)
    beds = []
    for way in ways.values():
        if way.get("tags", {}).get("railway") != "rail":
            continue
        line = local(LineString(points(way)))
        if extent.intersects(line):
            beds.append(line.buffer(1.7).intersection(extent))
    return union_all(beds)


def block_tracks(b, envelope):
    for polygon in get_parts(envelope):
        for ring in [polygon.exterior, *polygon.interiors]:
            coordinates = list(ring.segmentize(8).coords)
            for (x, z), (xx, zz) in zip(coordinates, coordinates[1:]):
                low, far = b.grade(x, z) - 0.08, b.grade(xx, zz) - 0.08
                fence_top = LEVELS["hallFloor"] + LEVELS["platformRise"] + 2.2 - b.surface.y
                b.hit_quad(
                    [
                        (x, low, z),
                        (xx, far, zz),
                        (xx, max(far + 2.2, fence_top), zz),
                        (x, max(low + 2.2, fence_top), z),
                    ],
                    (zz - z, 0, x - xx),
                )


def main(out):
    site = {k: local(v) for k, v in footprints().items()}
    ways = {e["id"]: e for e in load_osm() if e["type"] == "way"}
    platforms = [local(area(ways[i])) for i in range(376029417, 376029421)]
    track_envelope = track_limits(ways, platforms)
    annex = local(area(ways[1017598908]))
    bus_shelter = local(area(ways[1017598916]))
    image = Image.new("RGBA", (512, 512), "#ffffff")
    draw = ImageDraw.Draw(image)
    rects = {}
    for i, key in enumerate(
        ("wall", "roof", "frame", "glass", "soffit", "green")
    ):
        x, y = (i % 4) * 128, (i // 4) * 128
        rects[key] = (x, y, 128, 128)
        draw.rectangle(
            (x, y, x + 127, y + 127),
            fill=STYLE[key],
        )
    rects["sign"] = (0, 256, 512, 128)
    draw.rectangle((0, 256, 511, 383), fill=(0, 0, 0, 0))
    draw.line((2, 370, 509, 370), fill=STYLE["frame"], width=2)
    for x in (97, 256, 415):
        draw.line((x, 310, x, 382), fill=STYLE["frame"], width=3)
    draw.text(
        (256, 319),
        STYLE["signText"],
        font=get_font(**STYLE["signFont"]),
        anchor="mm",
        fill=STYLE["signColor"],
    )
    world = Surface()
    east, south = CENTER
    if NAME not in world.entries:
        world.entries[NAME] = dict(
            position=[east, world.sample(east, south)[0], south], rotation=0
        )
    surface = LandmarkSurface(world, NAME)

    streets = Streets(world)

    def build(b):
        top = facade(b, site["wall"], 16.2, curtain=True)
        roof_ring = ccw(site["roof"].exterior.coords)
        b.prism(roof_ring, top, STYLE["eaveThickness"], "soffit", cap_region="roof")
        b.face([(x, top, z) for x, z in roof_ring], (0, -1, 0), "soffit")
        front = max(
            edges(ccw(site["roof"].exterior.coords)), key=lambda edge: edge[-1][0]
        )
        _, a, end, _, _, normal = front
        mid = (a + end) / 2
        old = b.set_frame((mid[0], 0, mid[1]), normal)
        b.sign_quad(
            0,
            top + STYLE["eaveThickness"] + STYLE["signHeight"] / 2,
            -0.30,
            STYLE["signWidth"],
            STYLE["signHeight"],
            "sign",
        )
        b.restore_frame(old)
        for wing in ("north-wing", "south-wing"):
            facade(b, site[wing], 8.3)
        facade(b, annex, 4.2)
        # Light open-sided bus shelter along the divider; keep the queue lane clear.
        roof = bus_shelter.buffer(-0.65)
        canopy = max(b.grade(x, z) for x, z in roof.exterior.coords) + 3.3
        b.prism(roof.exterior.coords, canopy, 0.22, "frame", cap_region="roof")
        for tri in constrained_delaunay_triangles(roof).geoms:
            b.face(
                [(x, canopy, z) for x, z in list(tri.exterior.coords)[:3]],
                (0, -1, 0),
                "frame",
            )
        for _, a, end, length, u, n in edges(ccw(roof.exterior.coords)):
            if length > 9:
                for t in np.linspace(2, length - 2, math.ceil(length / 9)):
                    x, z = a + np.asarray(u) * t - np.asarray(n) * 0.35
                    g = b.grade(x, z) - 0.035
                    b.cylinder_y(x, g, canopy - g, z, 0.14, "frame", sections=6)
        if b.collide:
            block_tracks(b, track_envelope)
        for poly in platforms:
            platform(b, poly)
        platform_access(b, streets)
        crossing = site["crossing"]
        platform_y = LEVELS["hallFloor"] + LEVELS["platformRise"] - surface.y
        y = platform_y - LEVELS["platformHeight"] + LEVELS["overheadClearance"]
        b.prism(crossing.exterior.coords, y, 0.55, "frame", collide=True)
        b.prism(crossing.exterior.coords, y + 3.75, 0.25, "frame", cap_region="roof")
        b.face(
            [(x, y + 3.75, z) for x, z in crossing.exterior.coords[:-1]],
            (0, -1, 0),
            "wall",
        )
        for _, a, end, length, u, n in edges(ccw(crossing.exterior.coords)):
            pane = [
                (a[0], y + 0.55, a[1]),
                (end[0], y + 0.55, end[1]),
                (end[0], y + 3.75, end[1]),
                (a[0], y + 3.75, a[1]),
            ]
            (b.glass if b.detail else b.atlas).add_poly(pane, (n[0], 0, n[1]), "glass")
            if length > 20 and b.detail:
                for t in np.arange(1.5, length, 2.5):
                    fin(
                        b,
                        a + np.asarray(u) * t,
                        y + 0.55,
                        3.2,
                        0.10,
                        0.15,
                        u,
                        n,
                        "wall",
                    )
        for way_id, poly in zip(range(376029417, 376029421), platforms, strict=True):
            overlap = crossing.intersection(poly)
            if overlap.is_empty:
                continue
            x, z = overlap.centroid.coords[0]
            g = platform_y + 0.11
            b.cylinder_y(x, g, y - g, z, 0.42, "wall", collide=True)
            # Stair flights sit along the platform axis, clear of the track bed.
            _, _, _, _, axis, _ = max(
                edges(ccw(poly.exterior.coords)), key=lambda edge: edge[3]
            )
            old = b.set_frame((x, 0, z), axis)
            plinth(b, 0, 0, STYLE["bridgePlinth"], g)
            # Keep the foot of the stairs at its surveyed platform position.
            length = STYLE["bridgeStairRunByPlatform"][str(way_id)]
            bottom = platform_y - 0.02
            flight = LineString([(x, z), (x + axis[0] * length, z + axis[1] * length)])
            landing = flight.intersection(crossing).length
            run = length - landing
            steps = math.ceil((y + 0.55 - bottom) / 0.16)
            if b.detail:
                rise = (y + 0.55 - bottom) / steps
                tread = run / steps
                for k in range(steps):
                    toe, heel = length - k * tread, length - (k + 1) * tread
                    lower, upper = bottom + k * rise, bottom + (k + 1) * rise
                    b.face([(-1.1, upper, toe), (1.1, upper, toe),
                            (1.1, upper, heel), (-1.1, upper, heel)], (0, 1, 0), "roof")
                    b.face([(-1.1, lower, toe), (1.1, lower, toe),
                            (1.1, upper, toe), (-1.1, upper, toe)], (0, 0, 1), "frame")
                    for side in (-1, 1):
                        edge = side * 1.1
                        b.face([(edge, lower - 0.18, toe), (edge, upper, toe),
                                (edge, upper, heel), (edge, upper - 0.18, heel)],
                               (side, 0, 0), "wall")
                b.face([(-1.1, bottom - 0.18, length), (1.1, bottom - 0.18, length),
                        (1.1, y + 0.37, landing), (-1.1, y + 0.37, landing)],
                       (0, -1, 0), "soffit")
                # The first tread bears on a landing built up from the terrain.
                foot_ring = [(-1.1, length + 0.6), (1.1, length + 0.6),
                             (1.1, length), (-1.1, length)]
                low = min(b.grade(*p) for p in foot_ring) - 0.04
                b.prism(foot_ring, low, bottom - low, "frame", footing=True)
            if not b.detail:
                b.face([(-1.1, bottom, length), (1.1, bottom, length),
                        (1.1, y + 0.55, landing), (-1.1, y + 0.55, landing)], (0, 1, 0), "roof")
            b.hit_quad(
                [
                    (-1.1, bottom, length),
                    (1.1, bottom, length),
                    (1.1, y + 0.55, landing),
                    (-1.1, y + 0.55, landing),
                ],
                (0, 1, 0),
            )
            b.restore_frame(old)
        for key in ("planter-north", "planter-south"):
            ring = site[key].exterior.coords
            y = max(b.grade(x, z) for x, z in ring) + 0.35
            base = min(b.grade(x, z) for x, z in ring) - 0.04
            b.prism(
                ring,
                base,
                y - base,
                "frame",
                cap_region="green",
                footing=True,
                collide=True,
            )
        for planter in ("planter-north", "planter-south"):
            c = site[planter].centroid
            for dx in (-7, 7):
                x, z = c.x + dx, c.y
                g = b.grade(x, z) - 0.03
                b.cylinder_y(x, g, 5.8, z, 0.11, "frame", sections=6)
                b.box(x, g + 5.8, z, 1.5, 0.14, 0.48, "wall", bottom=True)
        c = site["plaza"].centroid
        b.cylinder_y(c.x, b.grade(c.x, c.y) - 0.03, 10, c.y, 0.10, "frame")

    export_landmark_glb(
        out / (NAME + ".glb"),
        image,
        rects,
        build,
        NAME,
        surface=surface,
        glass_opacity=STYLE["bridgeGlassOpacity"],
        masked_atlas=True,
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
