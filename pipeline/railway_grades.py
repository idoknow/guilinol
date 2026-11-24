"""Report rail-first grades and connected-road constraints for a generated world."""
import argparse
import json
from pathlib import Path

from railways import bake_world


def grade_report(directory):
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    plan = bake_world(directory, manifest, plan_profile=True)
    profile = plan['profile']
    levels = {row['sharedNode']: row['roadY'] for row in profile['crossings'] if row['type'] == 'level'}
    return dict(stationRailheadM=plan['stationRailheadM'], stationNodes=plan['stationNodes'],
                parallelRailHeight=plan['parallelRailHeight'], levelRecords=sum(
                    row['type'] == 'level' for row in profile['crossings']),
                levelSites=len(levels), carriagewayY=levels,
                stationApproachExceptions=plan.get('stationApproachExceptions', []),
                roadFeasibilityConflicts=profile['roads']['conflicts'],
                roadTargets=profile['roads']['targets'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', type=Path)
    args = parser.parse_args()
    print(json.dumps(grade_report(args.world), ensure_ascii=False, indent=2))
