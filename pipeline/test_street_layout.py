import json
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from shapely import STRtree
from shapely.geometry import LineString, Polygon, box

from common import LAT0,LON0
from road_profile import profile
from streets import chunks


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.line=LineString([(-40,0),(0,0),(40,0)])
        self.facades=STRtree([box(-50,-20,50,-10),box(-50,10,50,20)])

    def test_frontage(self):
        road=profile(self.line,{'highway':'pedestrian'},self.facades)
        self.assertEqual((road.width,road.lanes,road.left,road.right),(20,0,0,0))
        road=profile(self.line,{'highway':'primary','width':'14 m','lanes':'4','sidewalk':'left'},self.facades)
        self.assertEqual((road.width,road.lanes,road.right,road.divided),(14,4,0,True))

    def test_yiwu_has_no_inferred_median(self):
        tags={'highway':'secondary','lanes':'4'}
        self.assertFalse(profile(self.line,tags,self.facades,221349755).divided)
        self.assertTrue(profile(self.line,tags,self.facades,1).divided)

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
