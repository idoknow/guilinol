import gzip
import json
import struct
import unittest

from check_campus_release import check_paving_delta, check_tree_delta


def chunk(paths, image=b'png'):
    payload = json.dumps([[], [paths]], separators=(',', ':')).encode()
    return gzip.compress(struct.pack('<4s5I', b'GL04', 0, 0, len(payload), len(image), 0)
                         + bytes(16900) + payload + image)


class ProtectedDelta(unittest.TestCase):
    def test_tree_multiplicity_and_identity(self):
        first, second = bytes(12), bytes(range(12))
        original = gzip.compress(first * 2 + second)
        for kept, removed, expected in [(first + second, [first], True), (second, [first], False),
                                        (first * 3, [second], False), (first + second, [second], False)]:
            self.assertEqual(check_tree_delta(original, gzip.compress(kept), [row.hex() for row in removed]), expected)

    def test_patch_must_fit_and_preserve_other_bytes(self):
        ring = [[0, 0], [100, 0], [100, 100], [0, 100]]
        patch = dict(kind=1, face=[1, ring], gap=[ring])
        before, after = chunk([]), chunk([patch['face']])
        self.assertTrue(check_paving_delta(before, after, [patch]))
        self.assertFalse(check_paving_delta(before, chunk([patch['face']], b'bad'), [patch]))
        self.assertFalse(check_paving_delta(before, after, [dict(patch, gap=[ring[:3]])]))
        self.assertFalse(check_paving_delta(before, after, [dict(patch, kind=0)]))
