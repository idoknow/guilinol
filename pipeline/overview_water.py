"""Bake the two diagonal samples used by the overview water mesh (8 m cells)."""
import base64
import gzip

import numpy as np
from PIL import ImageColor


def water_mask(image, color):
    rgb = np.asarray(image.convert('RGB'))
    srgb = np.arange(256) / 255
    lut = np.where(srgb <= .04045, srgb/12.92, ((srgb+.055)/1.055)**2.4)
    target = lut[list(ImageColor.getrgb(color))]
    def matches(samples):
        return np.abs(lut[samples]-target).sum(axis=2) < .06
    wet = matches(rgb[::2,::2]) | matches(rgb[1::2,1::2])
    packed = np.packbits(wet, bitorder='little').tobytes()
    return base64.b64encode(gzip.compress(packed, mtime=0)).decode('ascii')
