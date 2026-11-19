"""Run the IDOK-59 LOD0 contact audit without its citywide deferral."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'pipeline'))
from audit_grounding import LandmarkSurface, Surface, measurements
from common import ll2xz
from shapely.geometry import Polygon
from shapely.affinity import translate,rotate

world = Surface()
failures = 0
market=next(entry for entry in json.loads((ROOT/'pipeline/landmarks.json').read_text()) if entry['id']=='wangcheng_market')
boundary=Polygon([ll2xz(lat,lon) for lon,lat in market['replace']['polygon']])
for name in ('dongxixiang', 'wangcheng_market'):
    surface=LandmarkSurface(world,name)
    region=rotate(translate(boundary,-surface.x,-surface.z),world.entries[name]['rotation'],origin=(0,0))
    corners=None
    if name=='wangcheng_market':
        from shapely.geometry import Point
        corners=[]
        for source in ('layout','infill'):
            for feature in json.loads((ROOT/f'docs/layout/dongxi-{source}.geojson').read_text())['features']:
                if feature['properties']['kind']!='roof':continue
                for ring in feature['geometry']['coordinates']:
                    for lon,lat in ring[:-1]:
                        x,z=ll2xz(lat,lon)
                        if boundary.covers(Point(x,z)):corners.append((x-surface.x,z-surface.z))
    rows, _, _, _ = measurements(ROOT/'public'/world.entries[name]['file'],surface,region,corners)
    bearing = [row for row in rows if 'minGap' in row]
    failed = [row for row in rows if row['status'] == 'fail']
    failures += len(failed)
    print(json.dumps(dict(model=name, components=len(bearing), samples=sum(row['bottomVertices'] for row in bearing),
                          minGap=min(row['minGap'] for row in bearing), maxGap=max(row['maxGap'] for row in bearing),
                          failures=len(failed), tolerance=[-.30,.15])), flush=True)
    if len(sys.argv)>1:
        Path(sys.argv[1],name+'-components.json').write_text(json.dumps(rows)+'\n')
sys.exit(bool(failures))
