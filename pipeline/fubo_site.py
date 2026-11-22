"""Fit the Fubo rock outcrop to its OSM parcel and preserve the published eastern reach."""
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box
from shapely.affinity import rotate

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
        nearby = [ways[i] for i in index.query(park.buffer(100))]
        walking = [w for w in nearby if areas.trail(w,regions)]
        uphill = [w for w in walking if w['tags']['highway']!='footway']
        platforms = areas.platforms(summit,nearby,uphill)
        self.platform = shapely.union_all(list(platforms.values()))
        self.steps = max((LineString(points(w)) for w in uphill if w['tags']['highway']=='steps'),key=lambda line:line.length)
        if Point(self.steps.coords[0]).distance(self.platform)<Point(self.steps.coords[-1]).distance(self.platform):
            self.steps = self.steps.reverse()
        self.feet = shapely.union_all([LineString(points(w)) for w in walking if w not in uphill])
        self.trails = self.feet.union(self.steps)
        strict, wet_buffers = [], []
        for i in index.query(park.buffer(100)):
            if areas.trail(ways[i],regions) or ways[i]['id'] in platforms:
                wet_buffers.append(index.geometries[i].intersection(river))
            else:
                strict.append(index.geometries[i])
        blocked = shapely.union_all(strict)
        self.river, self.park = river,park
        self.dry_allowed = park.difference(blocked)
        allowed = park.union(river).intersection(box(park.bounds[0],park.bounds[1],
                                                east_limit,park.bounds[3]))
        allowed = allowed.difference(shapely.union_all([blocked,self.feet.buffer(1),*wet_buffers]))
        # A 15 m opening removes narrow spurs. Choose the connected component
        # carrying the stair and trim the southwest corner along the road.
        cores = shapely.get_parts(allowed.buffer(-7.55,quad_segs=40))
        shoulder = max((p.buffer(7.5,quad_segs=40) for p in cores),
                       key=lambda p:p.intersection(self.steps).length)
        diagonal = rotate(shoulder,45,origin=(0,0))
        x0,z0,x1,z1 = diagonal.bounds
        self.outline = rotate(diagonal.intersection(box(x0-1,z0-1,x1-20,z1+1)),-45,origin=(0,0))
        self.outline = self.outline.simplify(.035,preserve_topology=True)
        # Grid-aligned apex on the broad shoulder near the surveyed summit.
        west,north,east,south = self.outline.bounds
        self.west,self.north = int(west//8)*8-16,int(north//8)*8-16
        self.xs = np.arange(self.west,int(east//8)*8+33,GRID)
        self.zs = np.arange(self.north,int(south//8)*8+33,GRID)
        x,z = np.meshgrid(self.xs,self.zs)
        pts = shapely.points(x,z)
        edge = shapely.distance(pts,self.outline.boundary)
        stair_dist = shapely.distance(pts,self.steps)
        inside = shapely.contains(self.outline,pts)
        score = np.where(inside & (x%8==0) & (z%8==0) & (shapely.distance(pts,summit)<=40),
                         np.minimum(edge,stair_dist*.95),-1)
        row,col = np.unravel_index(np.argmax(score),score.shape)
        self.center = np.array([x[row,col],z[row,col]],dtype=float)
        cx,cz = self.center
        pavilion = box(cx-3.6,cz-3.6,cx+3.6,cz+3.6)
        self.clear_crowns = shapely.union_all([self.steps.buffer(1),self.platform,pavilion])
        self._prepare_heights(x,z,pts,edge,stair_dist,inside)

    def _prepare_heights(self,x,z,pts,edge,stair_dist,inside):
        # A continuous rock surface with a round crown and a graded lower
        # shoulder. A harmonic interpolation blends the surveyed walking
        # route into the slopes on both sides of each switchback.
        from scipy.ndimage import convolve, maximum_filter
        cx,cz = self.center
        rad = np.hypot((x-cx)*1.1,(z-cz)*.8)
        # The west/south shoulder rises across the breadth of the park.
        # Flatten the crown gently in both axes, with a steeper river face.
        floor = 147.
        radius = ((x-cx)/52)**2+((z-cz)/76)**2
        dome = np.maximum(0,1-radius)**.7
        rim = np.sin(np.minimum(edge/18,1)*np.pi/2)**.92
        east = np.clip((x-cx-4)/35,0,1)
        north = np.clip((cz-15-z)/47,0,1)
        flank = (1-.72*east**1.3)*(1-.60*north**1.3)
        prior = np.where(inside,floor+(213-floor)*dome*rim*flank,floor)
        station = shapely.line_locate_point(self.steps,pts)
        foot_dist = shapely.distance(pts,self.feet)
        # The stair crosses a level footway mid-route. Its upper flight
        # climbs from that crossing to the lookout plaza.
        top = 159.
        targets = 148.+np.clip(station*.022,0,1.4)+np.clip((station-68)*.29,0,top-149.4)
        targets = np.where(station>104,top,targets)
        plaza_dist = shapely.distance(pts,self.platform)
        route = stair_dist<=5.8
        platform = plaza_dist<=5.8
        base = np.where(inside,prior,floor)
        fixed = ~inside | route | platform | (rad<4.5)
        base[route] = targets[route]
        base[platform] = top
        base[rad<4.5] = 213.-.035*rad[rad<4.5]**2
        h = base.copy()
        kernel = np.array([[0,.25,0],[.25,0,.25],[0,.25,0]])
        for _ in range(180):
            h = np.where(fixed,base,.63*convolve(h,kernel,mode='nearest')+.37*prior)
        # Bound each shoulder by its highest continuous connection back to
        # the crown. A concave parcel must not produce a detached rock knob.
        connected = np.full_like(h,floor)
        connected[z==cz] = np.where(x[z==cz]==cx,213.,floor)
        for _ in range(h.size):
            raised = np.minimum(h,maximum_filter(connected,size=3))
            if np.array_equal(raised,connected):
                break
            connected = raised
        self.heights = np.round(np.where(route|platform,h,connected),1)
        # Blend to the published road underlay outside the rock. The plaza
        # apron includes all native triangles under its boundary.
        self.apply_weight = np.maximum(np.where(inside,np.clip(edge/6,0,1),0),
                                       np.clip((10-plaza_dist)/4,0,1))
        self.apply_weight = np.where((foot_dist<2)&~platform,0,self.apply_weight)
        self.apply_weight[route | platform] = 1
        self.route_dist = np.minimum(stair_dist,plaza_dist)

    def walkway_trees(self,packed,origin):
        # Test the canopy, not just the trunk. Trees on the downslope side
        # can otherwise emerge through the stone tread at eye level.
        records = np.frombuffer(packed,dtype=np.dtype([('x','<u2'),('z','<u2'),('y','<i2'),
                                    ('kind','u1'),('scale','u1'),('attributes','V4')]))
        centers = shapely.points(origin[0]+records['x']/100,origin[1]+records['z']/100)
        clearance = shapely.distance(centers,self.clear_crowns)
        return bytearray(records[clearance>records['scale']*.05].tobytes())

    def level(self,x,z):
        u,v = (x-self.west)/GRID,(z-self.north)/GRID
        i,j = np.clip(np.floor(u).astype(int),0,len(self.xs)-2),np.clip(np.floor(v).astype(int),0,len(self.zs)-2)
        u,v = np.clip(u-i,0,1),np.clip(v-j,0,1)
        a,b,c,d = self.heights[j,i],self.heights[j,i+1],self.heights[j+1,i],self.heights[j+1,i+1]
        return np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))

    def native_grade(self,terrain,original,water,left,top):
        for j,z in enumerate(self.zs):
            for i,x in enumerate(self.xs):
                row,col = (z-top)//GRID,(x-left)//GRID
                if not (0<=row<water.shape[0] and 0<=col<water.shape[1]) or water[row,col]!=-32768:
                    continue
                weight = self.apply_weight[j,i]
                if weight==0:
                    continue
                # Expose limestone on the flanks and keep the ground texture
                # on the trail. Both have the same 4 m triangulation.
                drop = np.clip((self.route_dist[j,i]-5.8)/5,0,1)*2
                target = self.heights[j,i]-drop
                h = round((1-weight)*original[row,col]+weight*10*target)
                original[row,col] = terrain[row,col] = h

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


    def geometry(self,far):
        from shapely.geometry.polygon import orient
        from features import polygons
        spacing = GRID*2 if far else GRID
        # Clip the actual terrain triangles, retaining concavities and the
        # park footprint in both LODs. Shared centimetre vertices are welded.
        outline = orient(self.outline,sign=-1)
        boundary = np.asarray(outline.exterior.coords)[:-1]
        coords = list(map(tuple,np.round(boundary,2)))
        lookup = {pt:i for i,pt in enumerate(coords)}
        faces = []
        def index(pt):
            key = tuple(np.round(pt,2))
            if key not in lookup:
                lookup[key] = len(coords)
                coords.append(key)
            return lookup[key]
        for z in self.zs[::spacing//GRID]:
            for x in self.xs[::spacing//GRID]:
                if not outline.intersects(box(x,z,x+spacing,z+spacing)):
                    continue
                tl,tr,bl,br = (x,z),(x+spacing,z),(x,z+spacing),(x+spacing,z+spacing)
                for tri in ((tl,bl,tr),(br,tr,bl)):
                    clip = shapely.Polygon(tri).intersection(outline)
                    for part in polygons(clip):
                        for face in shapely.get_parts(shapely.constrained_delaunay_triangles(part)):
                            ring = list(orient(face,sign=-1).exterior.coords)[:3]
                            ids = [index(pt) for pt in ring]
                            if len(set(ids))==3:
                                faces.append(ids)
        coords = np.array(coords)
        x,z = coords.T
        pts = shapely.points(x,z)
        edge = shapely.distance(pts,outline.boundary)
        route = np.minimum(shapely.distance(pts,self.steps),shapely.distance(pts,self.platform))
        height = self.level(x,z)
        # Recess the rock only a few centimetres beneath the paved surface.
        height -= .18*np.clip((9-route)/3,0,1)
        height -= np.clip((4-edge)/4,0,1)*3*np.clip(route/7,0,1)
        # Small folds and a recessed mouth on the north-east riverside face.
        river = shapely.distance(pts,self.river)
        mouth = np.exp(-((z+740)/4)**2)*np.exp(-((river-3)/3)**2)
        height += (.5*np.sin(z*.7)*np.exp(-river/5)-1.2*mouth)*np.clip(route/8,0,1)
        return np.column_stack((x,height,z)).astype('<f4'),np.array(faces,dtype='<u2'),len(boundary)
