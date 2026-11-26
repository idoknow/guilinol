#!/usr/bin/env python3
"""
Merge all generated 512m city-upgrade shard JSONs into a unified, sorted public/city-upgrade/index.json.

Scans public/city-upgrade/shards/*.json, skips empty shards, computes ring classification
(r1 <= 1000m, r2 <= 2000m, r3 <= 4500m, r4 > 4500m from CITY_CENTER (-850, 0)),
and writes deterministic compact JSON compatible with web/src/city-upgrade/state.ts.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from build_city_upgrade import RING_ORDER, SHARD_SIZE, chunk_ring, shard_of, shard_ring

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARD_FILE_RE = re.compile(r"^(-?\d+)_(-?\d+)\.json$")
SHARD_KEYS = ("overrides", "fascias", "eaves", "acUnits", "blades", "streetSigns", "walls")


def is_shard_empty(payload: dict) -> bool:
    return not any(payload.get(k) for k in SHARD_KEYS)


def build_index(
    out_dir: Path,
    fascia_grid: tuple[int, int] = (8, 12),
    world_dir: Path | None = None,
    write_path: Path | None = None,
) -> dict:
    """Scan shard JSONs in out_dir/shards and emit sorted CityUpgradeIndex."""
    shards_dir = out_dir / "shards"
    if not shards_dir.is_dir():
        raise FileNotFoundError(f"Shards directory not found: {shards_dir}")

    # Optional manifest chunk map so shard rings align identically with existing chunks if provided
    chunk_rings_by_shard: dict[tuple[int, int], str] = {}
    if world_dir is not None:
        mf_path = world_dir / "manifest.json"
        if mf_path.is_file():
            mf = json.loads(mf_path.read_text(encoding="utf-8"))
            for c in mf.get("chunks", ()):
                sg = shard_of(c["x"], c["z"])
                r = chunk_ring(c["x"], c["z"])
                prev = chunk_rings_by_shard.get(sg)
                if prev is None or RING_ORDER[r] < RING_ORDER[prev]:
                    chunk_rings_by_shard[sg] = r

    shards_meta: dict[str, dict] = {}
    skipped_empty = 0
    total_buildings = 0
    total_fascias = 0
    ring_counts: Counter[str] = Counter()

    parsed_files: list[tuple[int, int, Path]] = []
    for p in shards_dir.glob("*.json"):
        m = SHARD_FILE_RE.match(p.name)
        if not m:
            continue
        parsed_files.append((int(m.group(1)), int(m.group(2)), p))
    parsed_files.sort(key=lambda item: (item[0], item[1]))

    for gx, gz, p in parsed_files:
        payload = json.loads(p.read_text(encoding="utf-8"))
        if is_shard_empty(payload):
            skipped_empty += 1
            continue
        skey = f"{gx},{gz}"
        ring = chunk_rings_by_shard.get((gx, gz)) or shard_ring(gx, gz)
        bldgs = len(payload.get("overrides") or {})
        fascias = len(payload.get("fascias") or [])
        shards_meta[skey] = {
            "ring": ring,
            "buildings": bldgs,
            "fascias": fascias,
        }
        ring_counts[ring] += 1
        total_buildings += bldgs
        total_fascias += fascias

    rings_index: dict[str, list[str]] = {"r1": [], "r2": [], "r3": [], "r4": []}
    for skey in sorted(shards_meta.keys(), key=lambda s: tuple(map(int, s.split(",")))):
        r = shards_meta[skey]["ring"]
        rings_index.setdefault(r, []).append(skey)

    index_payload = {
        "version": 1,
        "shardSize": SHARD_SIZE,
        "fasciaGrid": [fascia_grid[0], fascia_grid[1]],
        "rings": {k: v for k, v in rings_index.items() if v or k in ("r1", "r2", "r3")},
        "shards": shards_meta,
    }

    target_path = write_path or (out_dir / "index.json")
    target_path.write_text(json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(
        f"[merge_index] Wrote {target_path}: {len(shards_meta)} shards "
        f"(skipped_empty={skipped_empty}), {total_buildings} buildings, {total_fascias} fascias | "
        f"rings={dict(sorted(ring_counts.items()))}"
    )
    return index_payload


def main():
    ap = argparse.ArgumentParser(description="Merge public/city-upgrade/shards/*.json into ordered index.json.")
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "public/city-upgrade")
    ap.add_argument("--world-dir", type=Path, default=None, help="Optional world directory for chunk-aligned ring lookup")
    ap.add_argument("--fascia-grid", choices=("8x8", "8x12"), default="8x12")
    ap.add_argument("--output", type=Path, default=None, help="Optional custom output path for index.json")
    args = ap.parse_args()

    cols, rows = map(int, args.fascia_grid.split("x"))
    build_index(args.out_dir, fascia_grid=(cols, rows), world_dir=args.world_dir, write_path=args.output)


if __name__ == "__main__":
    main()
