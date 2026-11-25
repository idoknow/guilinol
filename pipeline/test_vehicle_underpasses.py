import unittest

from vehicle_tunnels import mark_underpasses, underground


def road(ident, nodes, coordinates, **tags):
    return dict(id=ident,type='way',nodes=nodes,tags=dict(highway='service',**tags),
                geometry=[dict(lat=25.28+z*.0001,lon=110.3+x*.0001) for x,z in coordinates])


class UnderpassTest(unittest.TestCase):
    def test_only_crossings_and_explicit_cover_are_underground(self):
        span=road(1,[1,2],[(0,0),(2,0)],bridge='yes',layer='1')
        below=road(2,[3,4],[(1,-1),(1,1)],layer='-1')
        approach=road(3,[2,5],[(2,0),(2,1)],layer='-1')
        cover=road(4,[6,7],[(5,1),(5,2)],layer='-1',covered='yes')
        surface=road(5,[8,9],[(6,1),(6,2)],covered='yes')
        tunnel=road(6,[10,11],[(7,1),(7,2)],tunnel='yes')
        ends_below=road(7,[12,13],[(1,-1),(1,0)],layer='-1')
        ways=[span,below,approach,cover,surface,tunnel,ends_below]
        mark_underpasses(ways)
        self.assertEqual([w['id'] for w in ways if underground(w)],[2,4,6,7])
        self.assertEqual([w['id'] for w in ways if w.get('surfaceUnderlay')],[3])
