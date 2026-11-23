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

from service_streets import patch_tile, width


class ServiceStreetTests(unittest.TestCase):
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
                                           +bytes(16900)+collision+png.getvalue()))
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
