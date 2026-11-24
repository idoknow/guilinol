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
from station_site import CENTER, ROOT, footprints
from uni_kit import ccw, edges, fin, quad, slab
from world_surface import LandmarkSurface, Surface

STYLE = json.loads((ROOT / "pipeline/railway-style.json").read_text())["station"]
NAME = "guilin_station"


def local(poly):
    return translate(poly, -CENTER[0], -CENTER[1])


def facade(b, polygon, height, curtain=False):
    ring = ccw(polygon.exterior.coords)
    top = max(b.grade(*p) for p in ring) + height
    b.prism(ring, 0, top, "wall", cap_region="roof", collide=True, footing=True)
    for _, a, end, length, u, normal in edges(ring):
        u = np.asarray(u)
        glazing = curtain and length > 60
        bands = (
            [(top - 9.8, top - 0.6)]
            if glazing
            else [(max(top - height + 1.05, top - 4.1), top - 1.2)]
        )
        for low, high in bands:
            for k in range(3 if glazing else 1):
                inset = (1.0, 3.2, 1.0)[k]
                span = length / (3 if glazing else 1)
                start = a + u * (k * span + inset)
                stop = a + u * ((k + 1) * span - inset)
                quad(b, start, stop, low, high, 0.04, normal, "glass")
                if b.detail:
                    for t in np.arange(2.4, np.linalg.norm(stop - start), 2.4):
                        fin(
                            b,
                            start + u * t,
                            low,
                            high - low,
                            0.11,
                            0.12,
                            u,
                            normal,
                            "frame",
                        )
                    for y in np.arange(low + 1.25, high, 1.25):
                        slab(b, start, stop, y, 0.10, 0.15, normal, "frame")
        if glazing and normal[0] > 0.8:
            for t in (0.18, 0.50, 0.82):
                mid = a + u * length * t
                quad(
                    b,
                    mid - u * 5.5,
                    mid + u * 5.5,
                    top - 15.4,
                    top - 10.2,
                    0.06,
                    normal,
                    "soffit",
                )
                slab(
                    b,
                    mid - u * 5.9,
                    mid + u * 5.9,
                    top - 10.2,
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
    roof_half = length / 2 - 12
    positions = np.linspace(
        -roof_half, roof_half, math.ceil(2 * roof_half / STYLE["columnSpacing"]) + 1
    )
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
            (x, y, x + 127, y + 127), fill=STYLE[key] if key != "warning" else "#dfb44e"
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
        crossing = site["crossing"]
        y = max(b.grade(x, z) for x, z in crossing.exterior.coords) + 7.4
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
        for poly in platforms:
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
            length = 2.1 * (y - g)
            bottom = b.grade(0, length) - 0.02
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
