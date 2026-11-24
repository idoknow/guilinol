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
PAVING = {
    rule["role"]: rule["color"]
    for rule in json.loads((ROOT / "pipeline/seam-surfaces.json").read_text())["atlas"][
        NAME
    ]
}


def local(poly):
    return translate(poly, -CENTER[0], -CENTER[1])


def facade(b, polygon, height, curtain=False):
    ring = ccw(polygon.exterior.coords)
    top = max(b.grade(*p) for p in ring) + height
    podium = top - 8.8 if curtain else top
    b.prism(ring, 0, podium, "wall", cap_region="roof", collide=True, footing=True)
    upper = (
        ccw(polygon.buffer(-2.2, join_style="mitre").exterior.coords)
        if curtain
        else ring
    )
    if curtain:
        b.prism(upper, podium, top - podium, "wall", cap_region="roof")
    for _, a, end, length, unit, normal in edges(upper):
        u = np.asarray(unit)
        glazing = curtain and length > 60
        low, high = (
            (podium + 0.35, top - 0.45)
            if glazing
            else (max(top - height + 1.05, top - 4.1), top - 1.2)
        )
        start, stop = a + u * 1.15, end - u * 1.15
        quad(b, start, stop, low, high, 0.06, normal, "glass")
        if b.detail:
            for t in np.arange(2.4, length - 2.3, 2.4):
                fin(b, start + u * t, low, high - low, 0.2, 0.14, u, normal, "frame")
            for y in np.arange(low + 1.15, high, 1.15):
                slab(b, start, stop, y, 0.13, 0.22, normal, "frame")
    for _, a, end, length, unit, normal in edges(ring):
        u = np.asarray(unit)
        glazing = curtain and length > 60
        if curtain:
            start, stop = a + u * 1.6, end - u * 1.6
            quad(b, start, stop, podium - 2.2, podium - 0.72, 0.08, normal, "glass")
            if b.detail:
                for t in np.arange(1.4, length - 3.2, 1.4):
                    fin(
                        b,
                        start + u * t,
                        podium - 2.2,
                        1.48,
                        0.22,
                        0.22,
                        u,
                        normal,
                        "wall",
                    )
        if glazing and normal[0] > 0.8:
            floor = LEVELS["hallFloor"] - b.surface.y
            for t in (0.18, 0.50, 0.82):
                mid = a + u * length * t
                quad(
                    b,
                    mid - u * 5.5,
                    mid + u * 5.5,
                    floor,
                    floor + 5.2,
                    0.06,
                    normal,
                    "soffit",
                )
                if b.detail:
                    for offset in (-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8):
                        center = mid + u * offset
                        quad(
                            b,
                            center - u * 0.72,
                            center + u * 0.72,
                            floor + 0.08,
                            floor + 4.18,
                            0.12,
                            normal,
                            "glass",
                        )
                        fin(
                            b,
                            center + u * 0.75,
                            floor + 0.08,
                            4.1,
                            0.17,
                            0.10,
                            u,
                            normal,
                            "frame",
                        )
                    slab(
                        b,
                        mid - u * 5.5,
                        mid + u * 5.5,
                        floor + 4.28,
                        0.13,
                        0.20,
                        normal,
                        "wall",
                    )
                slab(
                    b,
                    mid - u * 5.9,
                    mid + u * 5.9,
                    floor + 5.2,
                    0.35,
                    2.8,
                    normal,
                    "roof",
                )
    return top


def platform(b, poly, streets):
    ring = ccw(poly.exterior.coords)
    _, a, end, length, u, normal = max(edges(ring), key=lambda edge: edge[3])
    width = poly.area / length
    front = np.array(normal)
    # Frame X follows the long axis; all columns stay on the OSM platform.
    mid = np.array(poly.centroid.coords[0])
    old = b.set_frame((mid[0], 0, mid[1]), front)
    # Follow the same GL04 surface as the walker, including the baked curb.
    along = np.linspace(
        -length / 2 + 0.45, length / 2 - 0.45, math.ceil(length / 4) + 1
    )
    half = width / 2 - 0.35
    across = [-half, -half + 0.65, -half + 0.86, half - 0.86, half - 0.65, half]

    def row_at(x):
        row = []
        for z in across:
            wx, _, wz = b.xf((x, 0, z))
            h, _ = streets.at(wx + CENTER[0], wz + CENTER[1])
            row.append((x, h - b.surface.y + 0.035, z))
        return row

    previous = row_at(along[0])
    for x in along[1:]:
        row = row_at(x)
        for j, finish in enumerate(("brick", "warning", "brick", "warning", "brick")):
            b.face(
                [previous[j], row[j], row[j + 1], previous[j + 1]], (0, 1, 0), finish
            )
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
    levels = [b.grade(x, 0) + STYLE["canopyHeight"] for x in positions]
    for i, (x, y) in enumerate(zip(positions, levels)):
        base = b.grade(x, 0) - 0.04
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
    points3 = []
    for inset, offset in ((-1, -2), (-1, 2), (9, 2), (9, -2)):
        px, pz = np.asarray((x, z)) + inset * outward + offset * along
        height, _ = streets.at(px + CENTER[0], pz + CENTER[1])
        points3.append((px, height - b.surface.y + 0.045, pz))
    b.face(points3, (0, 1, 0), "frame", street_role="sidewalk")
    b.hit_quad(points3, (0, 1, 0))
    for i, j in ((0, 3), (1, 2)):
        a, c = points3[i], points3[j]
        wall = [
            a,
            c,
            (c[0], b.grade(c[0], c[2]) - 0.04, c[2]),
            (a[0], b.grade(a[0], a[2]) - 0.04, a[2]),
        ]
        side = -1 if i == 0 else 1
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
                b.hit_quad(
                    [
                        (x, low, z),
                        (xx, far, zz),
                        (xx, far + 2.2, zz),
                        (x, low + 2.2, z),
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
        ("wall", "roof", "frame", "glass", "brick", "soffit", "green", "warning")
    ):
        x, y = (i % 4) * 128, (i // 4) * 128
        rects[key] = (x, y, 128, 128)
        draw.rectangle(
            (x, y, x + 127, y + 127),
            fill={**STYLE, "brick": PAVING["sidewalk"], "warning": PAVING["marking"]}[
                key
            ],
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
        b.prism(roof_ring, top, 1.15, "soffit", cap_region="roof")
        b.face([(x, top, z) for x, z in roof_ring], (0, -1, 0), "soffit")
        front = max(
            edges(ccw(site["roof"].exterior.coords)), key=lambda edge: edge[-1][0]
        )
        _, a, end, _, _, normal = front
        mid = (a + end) / 2
        old = b.set_frame((mid[0], 0, mid[1]), normal)
        b.sign_quad(
            0,
            top + 1.15 + STYLE["signHeight"] / 2,
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
            platform(b, poly, streets)
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
            b.glass.add_poly(pane, (n[0], 0, n[1]), "glass")
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
            g = b.grade(x, z) - 0.04
            b.cylinder_y(x, g, y - g, z, 0.42, "wall", collide=True)
            # Stair flights sit along the platform axis, clear of the track bed.
            _, _, _, _, axis, _ = max(
                edges(ccw(poly.exterior.coords)), key=lambda edge: edge[3]
            )
            old = b.set_frame((x, 0, z), axis)
            # Keep the foot of the stairs at its surveyed platform position.
            length = STYLE["bridgeStairRunByPlatform"][str(way_id)]
            bottom = platform_y - 0.02
            steps = math.ceil((y - bottom) / 0.16)
            for k in range(steps):
                frac = (k + 1) / steps
                top_step = bottom + (y + 0.55 - bottom) * frac
                b.box(
                    0,
                    top_step - 0.2,
                    length * (1 - (k + 0.5) / steps),
                    2.2,
                    0.2,
                    length / steps,
                    "roof",
                )
            b.hit_quad(
                [
                    (-1.1, bottom, length),
                    (1.1, bottom, length),
                    (1.1, y + 0.55, 0),
                    (-1.1, y + 0.55, 0),
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
