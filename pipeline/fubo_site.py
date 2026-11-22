"""Fit the Fubo rock outcrop to its OSM parcel and preserve the published eastern reach."""
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import nearest_points

from common import GRID, load_osm
from features import area, points
from peak_road_geometry import road_buffers, TrailAreas


def grid_window(shape, left, top, region):
    xmin, zmin, xmax, zmax = region.bounds
    cols = np.arange(max(0,int((xmin-left)//GRID)), min(shape[1],int((xmax-left)//GRID)+2))
    rows = np.arange(max(0,int((zmin-top)//GRID)), min(shape[0],int((zmax-top)//GRID)+2))
    x, z = np.meshgrid(left+cols*GRID, top+rows*GRID)
    return np.ix_(rows,cols), x, z


@lru_cache(maxsize=1)
def fubo_site(east_limit):
    return FuboSite(east_limit)


class FuboSite:
    def __init__(self, east_limit):
        elements = load_osm()
        park = area(next(e for e in elements if e['type']=='way' and e['id']==485320268))
        river = area(next(e for e in elements if e['type']=='relation' and e['id']==2339020))
        areas = TrailAreas(elements)
        summit = areas.summits[1618571712]
        regions = areas.regions(summit)
        ways, index = road_buffers(park.buffer(150))
        trails, strict, water_paths = [], [], []
        for i in index.query(park.buffer(100)):
            if areas.trail(ways[i], regions):
                trails.append(LineString(points(ways[i])))
                water_paths.append(index.geometries[i].intersection(river))
            else:
                strict.append(index.geometries[i])
        self.trails = shapely.union_all(trails)
        self.steps = LineString(points(next(e for e in elements if e['id']==485320266)))
        self.safe = park.union(river).intersection(box(park.bounds[0],park.bounds[1],
                                                        east_limit,park.bounds[3])).difference(
            shapely.union_all(strict + water_paths)).buffer(-.10)
        self.river = river
        self.park = park
        # Place the summit on the dry riverside strip, at the nearest feasible
        # location to the mapped summit with room for the pavilion foundations.
        land = park.intersection(self.safe).buffer(-2).intersection(river.buffer(16))
        interior = land.difference(self.trails.buffer(10)).difference(shapely.union_all(strict).buffer(10))
        self.center = np.array(nearest_points(summit, interior)[1].coords[0])
        self.corridor = self.trails.buffer(2)
        self.dry_allowed = park.difference(shapely.union_all(strict))

    def grade_trail(self, field, wet, left, top, floor):
        # OSM walking ways are textured directly on GL04. Grade the lower
        # hillside itself, rising from the southern entrance to the lookout.
        window,x,z = grid_window(field.shape,left,top,self.park)
        pts = shapely.points(x,z)
        inside = shapely.contains(self.dry_allowed,pts)
        edge = shapely.distance(pts,self.dry_allowed.boundary)
        entrance = self.steps.coords[-1][1]
        rise = np.clip((entrance-z)*.16,0,8)
        target = floor + np.minimum(rise,edge*.30)
        weight = np.where(inside & ~wet[window],np.clip(edge/6,0,1),0)
        field[window] = np.rint((1-weight)*field[window]+weight*target*10)

    def retain_street_grade(self, terrain, original, water, published, left, top):
        # The expanded city uses frozen street splines here. Keep their
        # surveyed underlay as well, while removing the old mountain imprint.
        window,x,z = grid_window(original.shape,left,top,box(-190,-844,-6,-586))
        pts = shapely.points(x,z)
        inside = shapely.contains(self.dry_allowed,pts)
        fade = np.clip(shapely.distance(pts,self.dry_allowed.boundary)/8,0,1)
        keep_new = np.where(inside,fade*fade*(3-2*fade),0)
        dry = water[window]==-32768
        correction = np.where(dry,np.rint((published[window]-original[window])*(1-keep_new)),0).astype('<i2')
        original[window] += correction
        terrain[window] += correction

    def grade_bank(self, terrain, original, water, left, top):
        # Water physics uses the water plane at wet vertices. Grade only the
        # shallow shelf whose 4 m triangles support an OSM land trail.
        zone = self.trails.buffer(GRID*np.sqrt(2))
        window,x,z = grid_window(water.shape,left,top,zone)
        levels = water[window]
        near = (levels!=-32768) & shapely.intersects_xy(zone,x,z)
        for field in (terrain,original):
            field[window] = np.where(near,levels.astype(int)-2,field[window])

    def clear_trail_imprint(self, terrain, original, left, top):
        # Rapier interpolates 4 m grid cells. Clear all three corners of every
        # cell a walker on the trail can touch, including at switchbacks.
        zone = self.trails.buffer(GRID*2)
        window,x,z = grid_window(terrain.shape,left,top,zone)
        mask = shapely.intersects_xy(zone,x,z)
        terrain[window] = np.where(mask,original[window],terrain[window])

    def finish_mesh(self, vertices, faces, floor, far_faces):
        # Recheck the actual faces: far LOD chords can cut across a concave
        # plaza corner even when their endpoints satisfy a radial limit.
        segments = 128
        rings = np.arange(len(vertices)-1).reshape(-1,segments)
        self.far_vertices = np.r_[rings[[0,1,4,6,8,11],::4].ravel(),len(vertices)-1]
        self.far_faces = far_faces
        coarse = self.far_vertices[self.far_faces]
        both = np.vstack([faces,coarse])
        original = vertices[:,[0,2]].copy()
        scale = np.ones(segments)
        for _ in range(80):
            coords = vertices[:,[0,2]]
            triangles = shapely.polygons(coords[both])
            outside = ~shapely.covers(self.safe,triangles)
            cap = np.any(both==len(vertices)-1,axis=1)
            outside[cap] |= shapely.intersects(triangles[cap],self.corridor)
            if not outside.any():
                break
            bad = np.unique(both[outside])
            scale[bad[bad<len(vertices)-1]%segments] *= .94
            # Limit changes in radius between adjoining azimuths.
            scale = np.minimum(scale,np.minimum(np.roll(scale,1),np.roll(scale,-1))+.035)
            vertices[:-1,[0,2]] = self.center+(original[:-1]-self.center)*np.tile(scale,len(rings))[:,None]
        else:
            raise ValueError('Cannot fit Fubo mesh inside its OSM site')
        # Carry the low rock toe a few metres across the shared riverbank
        # wherever a continuous road-free radial segment reaches the water.
        # The mouth, folds and summit retain their original relative relief.
        shore_coords = coords.copy()
        origin = Point(self.center)
        for i,foot in enumerate(coords[:segments]):
            delta = foot-self.center
            radius = np.linalg.norm(delta)
            if delta[0]<=0 or radius<1:
                continue
            direction = delta/radius
            ray = LineString([self.center,self.center+100*direction])
            river_distance = origin.distance(ray.intersection(self.river))
            if not np.isfinite(river_distance) or river_distance>35:
                continue
            reach = min(river_distance+3,origin.distance(ray.intersection(self.safe.boundary))-1)
            if reach<=max(radius,river_distance+.5):
                continue
            for level,weight in enumerate((1,.96,.8,.6,.4,.2)):
                shore_coords[rings[level,i]] += weight*(reach-radius)*direction
        # Coarse chords across a bend must satisfy the same parcel clearance.
        for weight in (1,.75,.5,.25,0):
            fitted = coords+weight*(shore_coords-coords)
            triangles = shapely.polygons(fitted[both])
            if shapely.covers(self.safe,triangles).all():
                vertices[:,[0,2]] = fitted
                break
        # Leave a continuous walkable native terrain surface under each mapped
        # trail. Keep both LODs below it across every intersected triangle.
        touched = shapely.intersects(triangles,self.corridor)
        ids = np.unique(both[touched])
        vertices[ids,1] = np.minimum(vertices[ids,1],floor-3)

    def fit(self, angles, radii):
        center = Point(self.center)
        limits = []
        for angle in angles:
            end = self.center + 200*np.array([np.cos(angle), np.sin(angle)])
            ray = LineString([self.center,end])
            limits.append(center.distance(ray.intersection(self.safe.boundary)))
        # Allow for the skirt folds, ridge modulation, the summit lean and LOD chords.
        return np.maximum(1, np.minimum(radii, (np.asarray(limits)-3)/1.22))
