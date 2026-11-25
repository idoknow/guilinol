import gzip
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import Polygon, box, union_all

from service_streets import patch_tile, walk_lines, width


class ServiceStreetTests(unittest.TestCase):
    def test_walk_selection(self):
        def spans(tags):
            way = dict(type='way', geometry=[dict(lat=25, lon=110), dict(lat=25.001, lon=110)], tags=tags)
            return [span for _, span in walk_lines([way])]
        for highway, span in [('footway',3), ('path',2), ('pedestrian',4)]:
            self.assertEqual(spans({'highway': highway}), [span])
        self.assertEqual(spans({'highway':'path','width':'8 ft'}), [8*.3048])
        for extra in [dict(highway='steps'), dict(footway='sidewalk'), dict(footway='crossing'),
                      dict(layer='-1'), dict(bridge='yes'), dict(tunnel='yes'), dict(indoor='yes'), dict(area='yes')]:
            self.assertEqual(spans({'highway':'footway', **extra}), [])

    def test_width(self):
        self.assertEqual(width({}), 4)
        self.assertEqual(width({'service':'driveway'}), 3)
        self.assertEqual(width({'service':'parking_aisle','width':'4.5 m'}), 4.5)
        self.assertAlmostEqual(width({'width':'10 ft'}), 3.048)

    def test_junction(self):
        road = [0, [[0,0],[600,0],[600,3000],[0,3000]]]
        walk = [1, [[600,0],[800,0],[800,3000],[600,3000]]]
        collision = json.dumps([[], [[road, walk], [], []], [], []]).encode()
        bitmap = np.full((256,256,3), (179,177,156), dtype=np.uint8)
        bitmap[9:15,4:29] = (216,210,193)
        png = io.BytesIO(); Image.fromarray(bitmap).save(png,format='PNG')
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder)/'test.glc'
            file.write_bytes(gzip.compress(struct.pack('<4s5I', b'GL04',0,0,len(collision),len(png.getvalue()),0)
                                           +bytes(8450)+np.full(4225,-32768,dtype='<i2').tobytes()+collision+png.getvalue()))
            footway = file.with_name('footway.glc')
            footway.write_bytes(file.read_bytes())
            strip = box(4,10,28,14)
            self.assertTrue(patch_tile(footway,strip,(216,210,193),sidewalk=True))
            raw = gzip.decompress(footway.read_bytes())
            new_paths = json.loads(raw[16924:16924+struct.unpack_from('<I',raw,12)[0]])[1][0]
            self.assertEqual(new_paths[:2], [road, walk])
            self.assertEqual([kind for kind,*_ in new_paths[2:]], [1])
            paved_walk = Polygon(np.array(new_paths[2][1])/100)
            self.assertTrue(paved_walk.equals(box(8.02,10,28,14)))
            self.assertEqual(paved_walk.intersection(box(0,0,6,30)).area, 0)
            self.assertFalse(patch_tile(footway,strip,(216,210,193),sidewalk=True))
            blocked = file.with_name('protected.glc')
            building = [[1000,900],[1600,1350],[1200,1600]]
            data = bytearray(gzip.decompress(file.read_bytes()))
            data[8474+2*(3*65+5):8476+2*(3*65+5)] = struct.pack('<h',1500)
            protected = json.dumps([[[0,10,[building]]], [[road,walk],[],[]],[],[]]).encode()
            struct.pack_into('<I',data,12,len(protected))
            data[16924:16924+len(collision)] = protected
            blocked.write_bytes(gzip.compress(data))
            self.assertTrue(patch_tile(blocked,strip,(216,210,193),sidewalk=True))
            data = gzip.decompress(blocked.read_bytes())
            created = json.loads(data[16924:16924+struct.unpack_from('<I',data,12)[0]])[1][0][2:]
            for _, shell, *holes in created:
                shape = Polygon(np.array(shell)/100,[np.array(hole)/100 for hole in holes])
                self.assertEqual(shape.intersection(Polygon(np.array(building)/100)).area, 0)
                self.assertEqual(shape.intersection(box(16,8,24,16)).area, 0)
            self.assertTrue(patch_tile(file,box(4,10,28,14),(216,210,193)))
            data = gzip.decompress(file.read_bytes()); size, image_size = struct.unpack_from('<II',data,12)
            paths = json.loads(data[16924:16924+size])[1][0]
            shapes = [(kind,Polygon(np.array(shell)/100,[np.array(hole)/100 for hole in holes])) for kind,shell,*holes in paths]
            paved = [shape for kind,shape in shapes if kind==0]
            self.assertEqual(union_all(paved).area,180+22*4)
            self.assertEqual(sum(shape.area for shape in paved),union_all(paved).area)
            self.assertTrue(union_all(paved).covers(box(4,10,28,14)))
            self.assertTrue(all(shape.intersection(union_all(paved)).area==0 for kind,shape in shapes if kind==1))
            image = Image.open(io.BytesIO(data[16924+size:16924+size+image_size]))
            self.assertEqual(image.getpixel((16,9)),(179,177,156))
