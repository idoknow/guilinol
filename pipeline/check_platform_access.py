"""Verify the horizontal rail clearance and the grade of every finished island access ramp."""
import argparse
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Polygon, box
from check_rail_platforms import rail_chords


def check(world):
    manifest = json.loads((world/'manifest.json').read_bytes())
    config = json.loads(Path(__file__).with_name('rail-sections').joinpath('09-guilinbei-yard.json').read_bytes())
    style = json.loads(Path(__file__).with_name('railway-style.json').read_bytes())
    radius = style['gauge']/2 + style['headWidth'] + .10
    report = []
    for ramp in config['platformAccess']:
        end = np.array(ramp['endXZ'])
        along = np.array(ramp['inward'])
        normal = along[::-1]*[-1,1]
        across = normal+ramp['endSkew']*along
        toe = end-ramp['length']*along

        def footprint(half):
            return Polygon([p+v*across for p,v in [(toe,-half),(end,-half),(end,half),(toe,half)]])
        deck = footprint(ramp['width']/2)
        earth = footprint(ramp['width']/2+ramp['shoulder'])
        tracks = rail_chords(world, earth.buffer(12), include_structures=True)
        clear = min(earth.distance(LineString([k[:2],k[2:]])) for k in tracks) - radius
        samples = []
        coverage = 0.
        for tile in manifest['chunks']:
            origin = np.array([tile['x'],tile['z']])
            if not deck.intersects(box(*origin,*(origin+256))):
                continue
            for _, vertices in tile.get('platformAccess', []):
                for tri in np.asarray(vertices).reshape(-1,3,3):
                    xy = tri[:,[0,2]]+origin
                    face = Polygon(xy)
                    clip = face.intersection(deck)
                    if clip.area < max(1e-7,face.area*1e-5):
                        continue
                    if face.area-clip.area > 1e-5:
                        raise ValueError(f"Access ramp missing a crease at {xy.tolist()}")
                    coverage += clip.area
                    slope = np.linalg.solve(np.diff(xy,axis=0),np.diff(tri[:,1]))
                    samples.append([abs(slope@along),abs(slope@normal)])
        longitudinal, transverse = np.max(samples,axis=0) if samples else [1.,1.]
        passed = (abs(coverage-deck.area)<.001 and ramp['width']>=1.2 and ramp['shoulder']<=2
                  and longitudinal<=.08 and transverse<=.02 and clear>=0)
        report.append(dict(platform=ramp['platform'],widthM=ramp['width'],lengthM=ramp['length'],
                           shoulderM=ramp['shoulder'],deckAreaM2=deck.area,measuredM2=coverage,
                           railEnvelopeMarginM=clear,maxGrade=longitudinal,maxCrossfall=transverse,
                           passed=bool(passed)))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    rows = check(parser.parse_args().world)
    print(json.dumps(rows,indent=2))
    raise SystemExit(not all(r['passed'] for r in rows))
