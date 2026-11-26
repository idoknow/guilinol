"""Compare both endpoints of every GL04 chord in a previously accepted section."""
import argparse
import json
from pathlib import Path

from section_track_strips import section_strips


def vertices(world, section, graded=False):
    chords = []
    heights = {}
    for way, ax, az, ah, bx, bz, bh, flags in section_strips(
        world, design_flag="gradeTrackTerrain" if graded else None
    )[section]:
        ends = [(way, ax, az), (way, bx, bz)]
        chords.append((*ends, flags))
        for point, height in zip(ends, (ah, bh)):
            if heights.setdefault(point, height) != height:
                raise ValueError(f"Discontinuous railhead at {point}")
    if not chords:
        raise ValueError(f"No encoded tracks for {section}")
    return sorted(chords), heights


def check(base, candidate, section, allowed, graded=False):
    old_chords, old = vertices(base, section, graded)
    new_chords, new = vertices(candidate, section, graded)
    if old_chords != new_chords:
        raise ValueError(f"Changed geometry or flags in {section}")
    changes = []
    observed = set()
    for point in old:
        delta = new[point] - old[point]
        if delta == 0:
            continue
        key = (point[0], round(point[1], 5), round(point[2], 5))
        if key in observed or key not in allowed or abs(allowed[key] - delta) > 0.000002:
            raise ValueError(f"Unexpected rail change {point}: {delta:+.9f} m")
        observed.add(key)
        changes.append(dict(way=point[0], x=key[1], z=key[2], mainM=old[point],
                            candidateM=new[point], deltaM=round(delta, 6)))
    if observed != set(allowed):
        raise ValueError(f"Missing approved adjustments: {set(allowed) - observed}")
    return dict(section=section, chords=len(old_chords), vertices=len(old),
                unchangedVertices=len(old)-len(observed), changes=changes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("section")
    parser.add_argument("allowlist", type=Path)
    parser.add_argument("--graded", action="store_true", help="Include fitted approach tracks outside the audit boundary")
    args = parser.parse_args()
    limits = {(r["way"], r["x"], r["z"]): r["deltaM"] for r in json.loads(args.allowlist.read_bytes())}
    print(json.dumps(check(args.base, args.candidate, args.section, limits, args.graded), indent=2))
