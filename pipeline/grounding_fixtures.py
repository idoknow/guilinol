"""Independent stations on the packed waterfront structures, in landmark-local metres."""

# Floating craft must be tested at their designed draft, separately from the bollard
# and rock on the same GLB. Station, footprint radius, draft, reviewable reason.
CRAFT = {
    'guihu_moorings': [
        (x,z,8.5,.32,'系泊客船的水线位于船底上方 0.32 m')
        for x,z in [(-83.015,-70.074),(-88.105,-54.923),(-92.539,-38.511),(2.944,64.129)]
    ],
    'elephant_hill': [
        (x,z,3.5,.06,'观光竹筏浮在漓江，竹筒底部吃水 0.06 m')
        for x,z in [(134,-14),(152,20),(118,24)]
    ]
}

# Probe walkable tops near the outer end of the actual approach (some GLBs
# contain both a water span and land approach). Offsets avoid decorative rails.
ENDS = {
    'ronghu': [('steel',-604.1,z) for z in (65.01,109.39)]
        + [('glass',304,z) for z in (145.55,174.45)]
        + [('nine-bends-north',75.22,38.28),('nine-bends-island',109.91,123.34)]
        + [('ancient',31.4-.51*d,82.1+.86*d) for d in (-21.10,21.10)],
    'guanyi_bridge': [('promenade',x,z) for x in (-54.92,52.92) for z in (-16.1,16.1)],
    'lize_bridge': [('approach',x,z) for x in (-74.42,74.42) for z in (-9.6,9.6)],
    'huaqiao': [('stairs',x,0) for x in (-101.96,47.36)],
    'jiefang_bridge': [('west approach',-264.92,2.1),('east landing',140.42,2.1),
                       ('upper road joint',-140.42,2.1)]
}

PIERS = {
    'lize_bridge': [('tower',x,z) for x in (-40,40) for z in (-8.25,8.25)],
    'huaqiao': [('river pier',x,0) for x in (-17.6,0,17.6)],
    'jiefang_bridge': [('cutwater',x,z) for x in (-46,0,46) for z in (-21.15,21.15)]
}


def ronghu_footings(vertices, surface):
    """Check each island edge vertex, pavilion foundation and north-bank post."""
    from math import ceil, cos, sin, tau
    import numpy as np
    from scipy.spatial import cKDTree
    from common import load_osm
    from features import points

    index = cKDTree(vertices[:,::2])
    rows = []
    def foot(label, x, z, radius, retaining=False):
        candidates = vertices[index.query_ball_point([x,z],radius)]
        if not len(candidates):
            rows.append(dict(rule='bearing',fixture=label,local=[x,None,z],status='fail',gap=None,
                             reason='missing packed foundation vertices'))
            return
        distances = np.linalg.norm(candidates[:,::2]-[x,z],axis=1)
        candidates = candidates[distances <= distances.min()+.01]
        feet = candidates[candidates[:,1]<=candidates[:,1].min()+.015]
        records = []
        for px,py,pz in feet:
            ground,water = surface.sample(px,pz)
            diff = float(py-ground)
            ok = -.30<=diff<=.15
            if retaining and water is not None and water>ground:
                ok = ok and diff<=.015 and candidates[:,1].max()>=water
            records.append((ok,max(diff-.15,-.30-diff),px,py,pz,ground,water,diff))
        ok,_,px,py,pz,ground,water,diff = min(records,key=lambda r:(r[0],-r[1]))
        rows.append(dict(rule='bank-footing' if retaining else 'bearing',fixture=label,
                         local=[float(px),float(py),float(pz)],ground=ground,water=water,gap=diff,
                         status='pass' if ok else 'fail'))

    relation = next(e for e in load_osm() if e['type']=='relation' and e['id']==9373836)
    member = next(m for m in relation['members'] if m['role']=='inner' and m['ref']==674611987)
    for wx,wz in points(member)[:-1]:
        dx,dz = wx-surface.x,wz-surface.z
        foot('island retaining wall',surface.cos*dx-surface.sin*dz,surface.sin*dx+surface.cos*dz,.18,True)
    def north_bank(x):
        for step in range(80):
            if surface.water(x,7.2-step) is None:
                return 6.2-step
        raise ValueError(f'Missing dry north shore at x={x}')
    px = -46
    pz = north_bank(px)-2
    for i in range(6):
        foot('library pavilion plinth',px+3*cos(i*tau/6),pz+3*sin(i*tau/6),.11,True)
    for first,last in ((-36,-2.2),(2.2,72)):
        count=ceil((last-first)/1.6)
        for i in range(count+1):
            x=first+(last-first)*i/count
            for dx in (-.13,.13):
                for dz in (-.13,.13):
                    foot('north shore rail post',x+dx,north_bank(x)+dz,.075)
    return rows
