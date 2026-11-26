"""Sparse triangle-interpolated ground for authored models outside the dev world."""
import math


class ModelTerrain:
    def __init__(self, document):
        self.model = document['model']
        self.cells = {(col, row): values for col, row, *values in document['cells']}

    def sample(self, east, south):
        key = math.floor(east/4), math.floor(south/4)
        if key not in self.cells:
            raise ValueError(f'{self.model}: outside the published model terrain at {key}')
        step, northwest, northeast, southwest, southeast, water = self.cells[key]
        across = (east % 256)/step
        down = (south % 256)/step
        across -= math.floor(across)
        down -= math.floor(down)
        if across+down <= 1:
            height = northwest+(northeast-northwest)*across+(southwest-northwest)*down
        else:
            height = southeast+(southwest-southeast)*(1-across)+(northeast-southeast)*(1-down)
        return height, None if water == -32768 else water/10
