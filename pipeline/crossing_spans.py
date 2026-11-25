"""Grade the West Ring and Shanghai Road decks over the traffic lanes below them."""
import numpy as np
from shapely import LineString, Point, box, union_all

from canal_passages import sample_road_heights
from features import points
from road_profile import RULES
from service_streets import width
from terminal_decks import update_slabs
from vehicle_tunnels import grade_limit


SPANS = {
    420273230: (464498744, 575608293, 685161916),
    464498761: (464498744, 575608293, 685161916),
    259020549: (259020522, 246520667, 259020536, 259020560),
    246520670: (259020522, 246520667, 259020536, 259020560),
}

# Shanghai Road is mapped as two separate carriageways at both bridge ends.
OPPOSITE = {259020564: 259925407, 259925407: 259020564,
            259020555: 246520669, 246520669: 259020555}


def grade_crossings(output, manifest, elements, widths):
    ways = {e['id']: e for e in elements if e['type'] == 'way'}
    landings = []
    for bridge, roads in SPANS.items():
        if bridge in ways and all(i in ways for i in roads):
            grade_deck(output, manifest, ways, widths, bridge, roads, landings)
    return landings


def grade_deck(output, manifest, ways, widths, bridge, roads, landings):
    axis = LineString(points(ways[bridge]))
    x, z, w, h = manifest['extent']
    if not box(x, z, x + w, z + h).covers(axis):
        return

    corridors = []
    for road in roads:
        tags = ways[road]['tags']
        default = RULES['defaultWidth'].get(tags['highway'], width(tags))
        half_width = widths.get(road, default) / 2
        corridors.append(LineString(points(ways[road])).buffer(half_width + .5, cap_style='flat'))
    lower = union_all(corridors)
    stations = np.linspace(0, axis.length, int(np.ceil(axis.length)) + 1)
    offsets = np.arange(-5, 5.01, .5)
    probes, inside = [], []
    for station in stations:
        center = np.array(axis.interpolate(station).coords[0])
        tangent = np.subtract(axis.interpolate(min(axis.length, station + .1)).coords[0],
                              axis.interpolate(max(0, station - .1)).coords[0])
        normal = tangent[::-1] * [-1, 1] / np.linalg.norm(tangent)
        for offset in offsets:
            px, pz = center + normal * offset
            probes.append(dict(x=px, z=pz, roofProbe=True))
            inside.append(lower.covers(Point(px, pz)))

    hits = np.array(sample_road_heights(output, manifest, probes), dtype=float)
    hits = hits.reshape(len(stations), len(offsets), 2)
    deck = hits[:, len(offsets) // 2, 1]
    present = np.isfinite(deck)
    if not np.any(present):
        return
    if not np.all(present[2:-2]):
        raise ValueError(f'Resurvey the deck of {bridge}')
    deck = np.interp(stations, stations[present], deck[present])
    same_slab = np.abs(hits[:, :, 1] - deck[:, None]) < .3
    underneath = np.reshape(inside, same_slab.shape) & same_slab
    native = np.where(underneath, hits[:, :, 0], -np.inf)
    # Allow 4.5 m below the 1.2 m fascia, plus 4 cm for baking and interpolation.
    height = np.maximum(deck, native.max(axis=1) + 5.74)
    grade = grade_limit(ways[bridge]['tags']['highway']) * .95
    budgets = grade * np.diff(stations)
    for i, budget in enumerate(budgets):
        height[i + 1] = max(height[i + 1], height[i] - budget)
    for i in reversed(range(len(budgets))):
        height[i] = max(height[i], height[i + 1] - budgets[i])
    if np.max(height - deck) < .01:
        return
    for i in (0, -1):
        if height[i] - deck[i] < .02:
            continue
        ref = ways[bridge]['nodes'][i]
        arms = [w for w in ways.values() if w['id'] in OPPOSITE
                and ref in (w['nodes'][0], w['nodes'][-1])]
        if len(arms) != 1:
            raise ValueError(f'Resurvey the bridge approach at {ref}')
        arm = arms[0]
        coords = points(arm)
        line = LineString(coords if arm['nodes'][0] == ref else coords[::-1])
        parallel = LineString(points(ways[OPPOSITE[arm['id']]]))
        steps = np.linspace(0, line.length, int(np.ceil(line.length / 2)) + 1)
        pts = [line.interpolate(d) for d in steps]
        end = pts[-1]
        target, = sample_road_heights(output, manifest, [dict(x=end.x, z=end.y, way=arm['id'])])
        # Match the bridge downgrade, then join the native road with a
        # parabolic vertical curve. Carrying the lift to the far end of the
        # approach leaves a retaining step across the station exit sidewalk.
        native = deck[i] + (target - deck[i]) * steps / line.length
        descent = height[i] - grade * steps
        band = min(.08, height[i]-deck[i], target-descent[-1])
        profile = np.maximum(native, descent)
        if band > 0:
            profile += np.maximum(0, band-np.abs(native-descent))**2/(4*band)
        if abs(target - height[i]) > grade * line.length:
            raise ValueError(f'Extend the grade of {bridge} past {arm["id"]}')
        half = widths.get(arm['id'], RULES['defaultWidth'][arm['tags']['highway']]) / 2
        for a, b, y, h in zip(pts, pts[1:], profile, profile[1:]):
            segment = LineString([a, b])
            radius = min(half, segment.interpolate(.5, normalized=True).distance(parallel) / 2)
            landings.append((segment, radius, y, h, grade, 0))
    update_slabs(output, manifest['chunks'], {bridge: axis}, {bridge: stations},
                 {bridge: height}, spans=(bridge,))
