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
