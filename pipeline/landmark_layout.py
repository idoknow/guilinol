import os
import json
import math
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
import trimesh

from common import ll2xz, load_osm
from features import area, points


def polygon(coords):
    return Polygon([ll2xz(lat,lon) for lon,lat in coords])


def _model_structure_footprint(glb_path: Path, px: float, pz: float, rot_deg: float) -> Polygon:
    gltfpack = os.getenv('GLTFPACK') or 'gltfpack'
    rot = math.radians(rot_deg)
    cs, sn = math.cos(rot), math.sin(rot)
    T = np.array([[cs, 0, sn, px], [0, 1, 0, 0.0], [-sn, 0, cs, pz], [0, 0, 0, 1]], dtype=float)
    with tempfile.NamedTemporaryFile(suffix='.glb') as tmp:
        subprocess.run([gltfpack, '-i', str(glb_path), '-o', tmp.name, '-kn'], check=True, capture_output=True)
        sc = trimesh.load_scene(tmp.name)
        edges = {child: parent for parent, child, _ in sc.graph.to_edgelist()}
        tpolys = []
        for node in sc.graph.nodes_geometry:
            cur = node
            skip = False
            while cur and cur != sc.graph.base_frame:
                nm = str(cur).lower()
                if nm in ('lod1', 'lod2') or nm.startswith('collision'):
                    skip = True
                    break
                cur = edges.get(cur)
            if skip:
                continue
            mat, gname = sc.graph[node]
            g = sc.geometry[gname].copy()
            g.apply_transform(T @ mat)
            tris = g.vertices[g.faces]
            above = tris[tris[:, :, 1].max(axis=1) > 0.6]
            for tri in above:
                tp = Polygon(tri[:, [0, 2]])
                if tp.is_valid and tp.area > 1e-3:
                    tpolys.append(tp)
        return unary_union(tpolys).buffer(0) if tpolys else Polygon()


class Layout:
    def __init__(self):
        root = Path(__file__).resolve().parent
        self.entries = []
        self.ids = set()
        self.flatten = []
        self.school_grounds = []
        self.allow_unmapped_court = []
        tree_free = []
        areas = []
        compound_areas = []
        tree_clearings = []
        osm = {f"{item['type']}/{item['id']}":item for item in load_osm()}
        peak_models = {peak['model'] for peak in json.loads((root/'peaks.json').read_text()) if peak.get('model')}
        for entry in json.loads((root/'landmarks.json').read_text()):
            anchor = entry['anchor']
            if isinstance(anchor,str):
                element = osm[anchor]
                if element['type']=='node':
                    x,z = ll2xz(element['lat'],element['lon'])
                else:
                    shape=area(element)
                    center = shape.centroid if not shape.is_empty else Point(points(element)[0])
                    x,z=center.coords[0]
            else:
                x,z = ll2xz(anchor[1],anchor[0])
            for ring in entry.get('treeClearingsMeters',[]):
                tree_clearings.append(Polygon([(x+east,z+south) for east,south in ring]))
            replace = entry.get('replace',[])
            if isinstance(replace,dict):
                p_comp = polygon(replace['polygon'])
                areas.append(p_comp)
                compound_areas.append(p_comp)
            else:
                for key in replace:
                    if key in osm:
                        # A bridge way is a line. Skip it here; bridges.py drops the deck.
                        shape = area(osm[key])
                        if not shape.is_empty:
                            areas.append(shape)
                    else:
                        self.ids.add(key)
            # Extra footprints when one OSM way is the whole grounds, not the modeled mass.
            for ring in entry.get('replacePolygons',[]):
                areas.append(polygon(ring))
            if 'flatten' in entry:
                patch = entry['flatten']
                region = polygon(patch['polygon'])
                if entry.get('allowUnmappedCourt'):
                    self.allow_unmapped_court.append(region)
                self.flatten.append((region,patch['elevation']))
                (self.school_grounds if entry.get('schoolGround') else tree_free).append(region)
            model = root.parent/'public'/entry['model']
            if entry['model'] in peak_models:
                continue
            if model.exists():
                self.entries.append((x,z,dict(id=entry['id'],name=entry['name'],file=entry['model'],
                    rotation=entry.get('rotation',0),collision=entry['collision'],bytes=model.stat().st_size,
                    **json.loads(model.with_suffix('.json').read_text()))))
        model_polys = []
        for x, z, entry in self.entries:
            if entry['id'] in ('fubo', 'diecai', 'duxiu'):
                continue
            model_polys.append(_model_structure_footprint(root.parent / 'public' / entry['file'], x, z, entry['rotation']))
        self.compound_polygons = unary_union(compound_areas) if compound_areas else Polygon()
        self.replace_exclude = unary_union(areas)
        self.model_footprints = unary_union(model_polys) if model_polys else Polygon()
        self.exclude = unary_union([self.replace_exclude, self.model_footprints])
        self.tree_exclude = unary_union([self.exclude, *tree_free, *tree_clearings]).buffer(2)
