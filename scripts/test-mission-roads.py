"""Check driving orders against the baked traffic graph (horizontal world metres)."""
import gzip
import heapq
import json
import math
from collections import defaultdict
from pathlib import Path

with gzip.open("public/world/roads/graph.json.gz") as file:
    graph = json.load(file)
nodes = {n["id"]: (n["x"], n["z"]) for n in graph["nodes"]}
roads = defaultdict(dict)
lanes = []
for lane in graph["lanes"]:
    if lane["kind"] != "motor":
        continue
    a, b = lane["from"], lane["to"]
    x, z = nodes[a]
    dx, dz = nodes[b][0] - x, nodes[b][1] - z
    length = math.hypot(dx, dz)
    ux, uz = dx / length, dz / length
    # Match Traffic's lateral offset from the OSM way centre.
    lanes.append((a, b, x - uz * lane["offset"], z + ux * lane["offset"], ux, uz, length))
    roads[a][b] = roads[b][a] = length


def snap(point):
    candidates = []
    for a, b, x, z, ux, uz, length in lanes:
        dx, dz = point[0] - x, point[1] - z
        along = max(0, min(length, dx * ux + dz * uz))
        gap = math.hypot(dx - along * ux, dz - along * uz)
        # Canonical endpoint order also handles two stops on the same edge.
        edge = (a, b, along) if a < b else (b, a, length - along)
        candidates.append((gap, edge))
    gap, edge = min(candidates)
    assert gap <= 5, f"{point} is {gap:.1f} m from the nearest motor lane"
    return edge


def shortest(start, end):
    a, b, offset = start
    c, d, target = end
    # Seed Dijkstra with the partial road to each endpoint of the starting lane.
    queue = [(offset, a), (roads[a][b] - offset, b)]
    heapq.heapify(queue)
    seen = set()
    best = abs(offset - target) if (a, b) == (c, d) else math.inf
    while queue:
        distance, node = heapq.heappop(queue)
        if distance >= best:
            break
        if node in seen:
            continue
        seen.add(node)
        if node == c:
            best = min(best, distance + target)
        if node == d:
            best = min(best, distance + roads[c][d] - target)
        for neighbor, length in roads[node].items():
            if neighbor not in seen:
                heapq.heappush(queue, (distance + length, neighbor))
    assert math.isfinite(best), f"disconnected motor lanes {start}, {end}"
    return best


for path in sorted(Path("web/src/missions").glob("*.json")):
    order = json.loads(path.read_text())
    if order["line"] not in ("taxi", "race"):
        continue
    snap(order["giver"])
    stops = [snap(step["at"]) for step in order["steps"]]
    legs = [shortest(a, b) for a, b in zip(stops, stops[1:])]
    print(f"{path.stem}: legs {[round(m) for m in legs]}, total {sum(legs):.1f} m")
    if order["line"] == "taxi":
        for step, length in zip(order["steps"][1:], legs):
            assert step["meterM"] == math.floor(length), f"{path}: stale meterM at {step['at']}"
    else:
        assert stops[0] == stops[-1], f"{path}: circuit must return to start"
        assert all("timer" not in step for step in order["steps"][2:]), f"{path}: intermediate clock reset"
        assert order["steps"][1]["timer"] >= sum(legs) / (0.6 * 11.1), f"{path}: race clock too short"
