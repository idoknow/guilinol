import gzip
import json
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from shapely import STRtree
from shapely.geometry import LineString, Polygon, box

from common import LAT0,LON0
from road_profile import profile
from dongxi_streets import street_surface
from streets import chunks
from street_rings import repaired_paths, repair_frozen_tile


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.line=LineString([(-40,0),(0,0),(40,0)])
        self.facades=STRtree([box(-50,-20,50,-10),box(-50,10,50,20)])

    def test_frozen_street_split_preserves_lower_index_and_holes(self):
        crossed = [1, [[0, 0], [10, 10], [0, 10], [10, 0]]]
        lower = [6, [[0, 0], [20, 0], [20, 20], [0, 20]],
                 [[2, 2], [2, 4], [4, 4], [4, 2]]]
        paths = [crossed, lower]
        streets = [paths, *[[] for _ in range(10)], [1, [], []]]
        collision = json.dumps([[], streets, [], []]).encode()
        header = struct.pack('<4s5I', b'GL04', 0, 0, len(collision), 4, 0)
        raw = header + bytes(16900) + collision + b'tail'
        packed = repair_frozen_tile(gzip.compress(raw))
        fixed = gzip.decompress(packed)
        length = struct.unpack_from('<I', fixed, 12)[0]
        result = json.loads(fixed[16924:16924+length])[1]
        self.assertEqual(result[11][0], 2)
        self.assertEqual(result[0][2:], [lower])
        parts = [Polygon(shell, holes) for _, shell, *holes in result[0][:2]]
        self.assertTrue(all(poly.is_valid for poly in parts))
        self.assertEqual(sum(poly.area for poly in parts), 50)
        self.assertEqual(fixed[16924+length:], b'tail')
        self.assertEqual(repair_frozen_tile(packed), packed)
        self.assertEqual(repaired_paths([1, [[0, 0], [5, 5], [5, 5]]]), [])

    def test_frontage(self):
        road=profile(self.line,{'highway':'pedestrian'},self.facades)
        self.assertEqual((road.width,road.lanes,road.left,road.right),(20,0,0,0))
        road=profile(self.line,{'highway':'primary','width':'14 m','lanes':'4','sidewalk':'left'},self.facades)
        self.assertEqual((road.width,road.lanes,road.right,road.divided),(14,4,0,True))

    def test_dongxi_inferred_surface_keeps_axis_and_opposite_edge(self):
        wall = box(-5,3,5,15)
        with patch('dongxi_streets.frontage_limits',return_value={'R41':wall}):
            inferred=profile(self.line,{'highway':'pedestrian'},self.facades,1554170682)
            surface=street_surface(inferred)
            self.assertTrue(surface.covers(self.line))
            self.assertTrue(surface.covers(box(-4,-9,4,-3)))
            self.assertEqual(surface.intersection(wall).area,0)
            surveyed=profile(self.line,{'highway':'pedestrian','width':'20'},self.facades,1554170682)
            self.assertGreater(street_surface(surveyed).intersection(wall).area,0)

    def test_yiwu_has_no_inferred_median(self):
        tags={'highway':'secondary','lanes':'4'}
        self.assertFalse(profile(self.line,tags,self.facades,221349755).divided)
        self.assertTrue(profile(self.line,tags,self.facades,1).divided)

    def test_yiwu_photo_section(self):
        tags = {'highway':'secondary','name':'翊武路'}
        road = profile(self.line,tags,self.facades,221349755)
        self.assertEqual((road.section,road.lanes,road.width,road.divided),('local',2,6.5,False))
        self.assertEqual(profile(self.line,tags,self.facades,1).section,'collector')

    def test_signals(self):
        tags={'highway':'primary','width':'14','lanes':'4'}
        roads=[profile(line,tags,self.facades) for line in (self.line,LineString([(0,-40),(0,0),(0,40)]))]
        node={'type':'node','lat':LAT0,'lon':LON0,'tags':{'highway':'traffic_signals'}}
        with patch('streets.load_osm',return_value=[node]):
            encode,_=chunks(roads,[],box(-80,-80,80,80),[box(60,60,70,70)],lambda *_:(150,-32768),Polygon())
            signals=sum(len(encode(box(x,z,x+256,z+256),(x,z))[3]) for x in (-256,0) for z in (-256,0))
        self.assertEqual(signals,1)

    def test_packed_assets(self):
        public=Path(__file__).resolve().parents[1]/'public'
        glb=(public/'landmarks/placeholder.glb').read_bytes()
        metadata=json.loads(glb[20:20+struct.unpack_from('<I',glb,12)[0]])
        self.assertTrue({'KHR_texture_basisu','KHR_mesh_quantization','EXT_meshopt_compression'}.issubset(metadata['extensionsRequired']))
        self.assertIn('collision_box',[node.get('name') for node in metadata['nodes']])
        textures=list((public/'textures').glob('*.ktx2'))
        self.assertEqual(len(textures),5)
        self.assertLessEqual(sum(file.stat().st_size for file in textures),1500000)
        for texture in textures:self.assertTrue(texture.read_bytes().startswith(b'\xabKTX 20'))


if __name__=='__main__':
    unittest.main()
