from functools import lru_cache

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from shapely.geometry import Polygon
from shapely.affinity import translate
from shapely.ops import unary_union

from shop_lettering import sign_font


class Outline(BasePen):
    def __init__(self, glyphs):
        super().__init__(glyphs)
        self.shape = Polygon()

    def _moveTo(self, point):
        self.points = [point]

    def _lineTo(self, point):
        self.points.append(point)

    def _curveToOne(self, first, second, last):
        start = np.asarray(self.points[-1])
        for phase in np.linspace(0, 1, 7)[1:]:
            rest = 1-phase
            self.points.append(rest**3*start + 3*rest**2*phase*np.asarray(first) +
                               3*rest*phase**2*np.asarray(second) + phase**3*np.asarray(last))

    def _qCurveToOne(self, control, last):
        start = np.asarray(self.points[-1])
        for phase in np.linspace(0, 1, 7)[1:]:
            self.points.append((1-phase)**2*start + 2*phase*(1-phase)*np.asarray(control) + phase**2*np.asarray(last))

    def _closePath(self):
        if len(self.points) > 2:
            self.shape = self.shape.symmetric_difference(Polygon(self.points).buffer(0))


@lru_cache
def outline(text):
    with TTFont(sign_font().path, fontNumber=2) as font:
        glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
        shapes, advance = [], 0
        for char in text:
            glyph = glyphs[cmap[ord(char)]]
            pen = Outline(glyphs)
            glyph.draw(pen)
            shapes.append(translate(pen.shape, xoff=advance))
            advance += glyph.width
    return unary_union(shapes)
