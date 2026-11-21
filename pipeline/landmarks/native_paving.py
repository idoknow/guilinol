"""Cut same-level native GL04 pavement out of landmark walking surfaces."""
from pathlib import Path
import math
import sys
import numpy as np
import shapely

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from seam_streets import Streets


class NativePaving:
    def __init__(self, world, entry):
        self.streets=Streets(world)
        self.origin=np.array(entry['position'])
        angle=math.radians(entry['rotation'])
        self.rotation=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])
        self.tiles={}

    def clip(self, vertices, uv):
        vertices=vertices.reshape(-1,3,3)
        uv=uv.reshape(-1,3,2)
        result=[]; textures=[]
        for tri,coords in zip(vertices,uv):
            xz=tri[:,::2]@self.rotation+self.origin[::2]
            footprint=shapely.Polygon(xz)
            # Preserve skirts, undersides and vertical kerb faces.
            if not footprint.exterior.is_ccw and footprint.area>1e-5:
                pieces=self.exposed(footprint,xz,tri[:,1]+self.origin[1])
                if pieces is not None:
                    for piece in shapely.get_parts(shapely.constrained_delaunay_triangles(pieces)):
                        points=np.asarray(shapely.orient_polygons(piece,exterior_cw=True).exterior.coords)[:3]
                        weights=np.linalg.solve((xz[1:]-xz[0]).T,(points-xz[0]).T).T
                        result.append(tri[0]+weights@(tri[1:]-tri[0]))
                        textures.append(coords[0]+weights@(coords[1:]-coords[0]))
                    # Close freshly cut edges of raised slabs down to the terrain.
                    # Native street geometry can sit well above the terrain mesh.
                    cut=pieces.boundary.difference(footprint.boundary.buffer(.0001))
                    for line in shapely.get_parts(cut):
                        if line.geom_type!='LineString':continue
                        for a,b in zip(line.coords,list(line.coords)[1:]):
                            edge=np.asarray([a,b])
                            weights=np.linalg.solve((xz[1:]-xz[0]).T,(edge-xz[0]).T).T
                            top=tri[0]+weights@(tri[1:]-tri[0])
                            foot=top.copy()
                            foot[:,1]=[self.streets.world.sample(*point)[0]-self.origin[1] for point in edge]
                            if np.max(top[:,1]-foot[:,1])<.12:continue
                            side_uv=coords[0]+weights@(coords[1:]-coords[0])
                            result.extend(([top[0],foot[1],top[1]],[top[0],foot[0],foot[1]]))
                            textures.extend((side_uv[[0,1,1]],side_uv[[0,0,1]]))
                    continue
            result.append(tri); textures.append(coords)
        return np.array(result).reshape(-1,3),np.array(textures).reshape(-1,2)

    def exposed(self, face, xz, elevations):
        size=self.streets.world.size
        x0,z0,x1,z1=face.bounds
        covered=[]
        for col in range(math.floor(x0/size),math.floor(x1/size)+1):
            for row in range(math.floor(z0/size),math.floor(z1/size)+1):
                origin=col*size,row*size
                if origin not in self.streets.world.files:continue
                tree,kinds,_=self.streets.tile(origin)
                for i in tree.query(face,predicate='intersects'):
                    if kinds[i] not in (0,1,5,6):continue
                    overlap=face.intersection(shapely.make_valid(tree.geometries[i]))
                    if overlap.area<1e-6:continue
                    key=(origin,i)
                    if key not in self.tiles:
                        self.tiles[key]=tree.geometries[i].representative_point()
                    centre=np.asarray(self.tiles[key].coords[0])
                    points=shapely.get_coordinates(overlap)
                    weights=np.linalg.solve((xz[1:]-xz[0]).T,(points-xz[0]).T).T
                    heights=elevations[0]+weights@(elevations[1:]-elevations[0])
                    # Probe just inside the polygon: rounded tile and lane edges
                    # can otherwise select the neighbouring surface height.
                    for point,height in zip(points,heights):
                        delta=centre-point
                        probe=point+delta*min(1,.002/max(np.linalg.norm(delta),1e-9))
                        street,k=self.streets.at(*probe)
                        if not k or abs(street-height)>.05:break
                    else:
                        covered.append(overlap)
        if not covered:return None
        native=shapely.union_all(covered)
        # GL04 contours are rounded to centimetres. Keep the model boundary
        # exact, but discard isolated slivers entirely inside that tolerance.
        parts=[piece for piece in shapely.get_parts(face.difference(native))
               if piece.geom_type=='Polygon' and not native.buffer(.01).covers(piece)]
        return shapely.union_all(parts) if parts else shapely.Polygon()
