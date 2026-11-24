"""Grade the surveyed uneven carriageways against the final visible road mesh."""
import json
import math
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree

from features import points
from service_streets import width
from vehicle_tunnels import grade_limit


def stations(elements, widths, lanes, bounds):
    intervals = json.loads(Path(__file__).with_name('road-grade-survey.json').read_text())
    sections = []
    active = {l['way'] for l in lanes if not l.get('gradeSeparated')}
    protected = {r['id'] for r in elements if r['type']=='node' and
                 r.get('tags',{}).get('railway')=='level_crossing'}
    for way in elements:
        wid=way['id']
        if (way['type']!='way' or wid not in active or str(wid) not in intervals or
                protected.intersection(way['nodes'])):
            continue
        tags = way['tags']
        coords = points(way)
        line = LineString(coords)
        if not bounds.covers(line):
            continue
        # Keep every original bend as a knot. The preceding/following section
        # and any crossing OSM way must agree at a shared junction.
        vertex_s = np.r_[0,np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
        half = widths.get(wid, width(tags) if tags['highway'] in ('service','living_street') else 6.5)/2+.5
        for a,b in intervals[str(wid)]:
            a,b=max(0,a),min(line.length,b)
            if b<=a:
                continue
            ds=sorted({a,b,*vertex_s[(vertex_s>a)&(vertex_s<b)],*np.arange(a+6,b,6)})
            xy=[line.interpolate(d).coords[0] for d in ds]
            sections.append((ds,xy,half,grade_limit(tags['highway'])))
    return sections


def profiles(sections, measured, portal_grades):
    # Portal, railway and bridge landings have independent hard constraints.
    # Leave the transitions handled by the tunnel solver on their own grades.
    protected=STRtree([line.buffer(half+1) for line,half,*_ in portal_grades])
    grades=[]
    samples=iter(measured)
    for ds,xy,half,limit in sections:
        levels=np.array([next(samples) for _ in xy])
        if len(protected.query(LineString(xy).buffer(half),predicate='intersects')):
            continue
        ds=np.array(ds)
        cap=limit*.88
        if abs(levels[-1]-levels[0])>cap*(ds[-1]-ds[0]):
            continue
        # Narrow spikes from the old mesh must not be propagated into the
        # body footprint. The envelopes bound slopes and keep both tie-ins.
        smooth=levels.copy()
        for i in range(1,len(ds)-1):
            mask=np.abs(ds-ds[i])<=12
            weights=np.maximum(0,1-np.abs(ds[mask]-ds[i])/13)
            smooth[i]=np.average(levels[mask],weights=weights)
        lo=smooth.copy()
        hi=smooth.copy()
        for indices in [range(1,len(ds)),range(len(ds)-2,-1,-1)]:
            step=indices.step
            for i in indices:
                gap=abs(ds[i]-ds[i-step])*cap
                lo[i]=max(lo[i],lo[i-step]-gap)
                hi[i]=min(hi[i],hi[i-step]+gap)
        lower=np.maximum(levels[0]-cap*(ds-ds[0]),levels[-1]-cap*(ds[-1]-ds))
        upper=np.minimum(levels[0]+cap*(ds-ds[0]),levels[-1]+cap*(ds[-1]-ds))
        ys=np.clip((lo+hi)/2,lower,upper)
        for a,b,ya,yb in zip(xy,xy[1:],ys,ys[1:]):
            if math.dist(a,b)>.01:
                grades.append((LineString([a,b]),half,ya,yb,limit,0))
    return grades
