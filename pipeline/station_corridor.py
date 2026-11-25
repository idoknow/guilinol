"""Connect the Guilin station pad to the unchanged, baked main rail profiles."""
import math

import numpy as np
from scipy import sparse
from scipy.optimize import linprog
from scipy.sparse.csgraph import dijkstra
from shapely import LineString, Point, STRtree, union_all
from shapely.affinity import translate

from features import area

PLATFORMS = (376029417, 376029418, 376029419, 376029420)
RAILHEAD = 153.80


def station_pad(ways):
    hull = union_all([area(ways[w]) for w in PLATFORMS]).convex_hull
    corners = np.asarray(hull.minimum_rotated_rectangle.exterior.coords)
    sides = np.diff(corners, axis=0)
    axis = sides[np.linalg.norm(sides, axis=1).argmax()]
    dx, dz = axis * (50 / np.linalg.norm(axis))
    return union_all([translate(hull, dx, dz), translate(hull, -dx, -dz)]).convex_hull


def parallel_segments(pieces, coords, ways):
    """Compare linear profiles at matching perpendicular chainages on both tracks."""
    surface = {wid for wid,way in ways.items() if way.get('tags',{}).get('railway')=='rail'
               and all(way['tags'].get(k,'no')=='no' for k in ('bridge','tunnel'))}
    rows = [piece for piece in pieces if piece[4] in surface]
    if not rows:
        return None
    indices = np.array([[i, j] for i, j, *_ in rows])
    endpoints = np.asarray(coords)[indices]
    delta = endpoints[:, 1] - endpoints[:, 0]
    lengths = np.linalg.norm(delta, axis=1)
    axes = delta / lengths[:, None]
    lines = [LineString(pair) for pair in endpoints]
    source, target = STRtree(lines).query(lines, predicate='dwithin', distance=8)
    way_ids = np.array([row[4] for row in rows])
    layers = np.array([ways[k]['tags'].get('layer', '0') for k in way_ids])
    cosine = np.sum(axes[source] * axes[target], axis=1)
    keep = ((way_ids[source] != way_ids[target]) & (layers[source] == layers[target])
            & (abs(cosine) >= math.cos(math.radians(10))))
    source, target = source[keep], target[keep]
    # Clip the source segment to both the target chainage interval and its
    # eight-metre strip. Height difference is linear between these endpoints.
    offset = endpoints[source, 0] - endpoints[target, 0]
    along = np.sum(offset * axes[target], axis=1)
    normal = axes[target][:, ::-1].copy()
    normal[:, 0] *= -1
    across = np.sum(offset * normal, axis=1)
    lo, hi = np.zeros(len(source)), np.ones(len(source))
    for start, step, minimum, maximum in (
        (along, np.sum(delta[source] * axes[target], axis=1), 0, lengths[target]),
        (across, np.sum(delta[source] * normal, axis=1), -8, 8),
    ):
        moving = abs(step) > 1e-10
        divisor = np.where(moving, step, 1)
        a, b = (minimum - start) / divisor, (maximum - start) / divisor
        lo = np.maximum(lo, np.where(moving, np.minimum(a, b), 0))
        hi = np.minimum(hi, np.where(moving, np.maximum(a, b),
                                     np.where((start >= minimum) & (start <= maximum), 1, -1)))
    valid = hi >= lo
    source, target = source[valid], target[valid]
    if not len(source):
        return None
    fraction = np.stack((lo[valid], hi[valid]), axis=1)
    xy = endpoints[source, :1] + fraction[:, :, None] * delta[source, None]
    station = np.sum((xy - endpoints[target, :1]) * axes[target, None], axis=2)
    return (indices[source], indices[target], fraction, station / lengths[target, None],
            xy, way_ids[source], way_ids[target])


def parallel_height_audit(pieces, coords, height, ways):
    pairs = parallel_segments(pieces, coords, ways)
    result = dict(directedSegmentPairs=0, over5cm=0, maximumM=0)
    if pairs is None:
        return result
    a, b, along_a, along_b, xy, way_a, way_b = pairs
    result['directedSegmentPairs'] = len(a)
    source_y = height[a[:, :1]] + along_a * np.diff(height[a], axis=1)
    target_y = height[b[:, :1]] + along_b * np.diff(height[b], axis=1)
    diff = abs(source_y - target_y)
    pair, end = np.unravel_index(diff.argmax(), diff.shape)
    result.update(over5cm=int(np.count_nonzero(diff.max(axis=1) > .050001)),
                  maximumM=float(diff[pair, end]), ways=[int(way_a[pair]), int(way_b[pair])],
                  xz=xy[pair, end].tolist(), railheadM=[source_y[pair, end], target_y[pair, end]])
    return result


def split_at_pad(coords, pieces, heights, pad):
    coords = list(coords)
    heights = list(heights)
    sections = []
    for i, j, station, flags, way in pieces:
        line = LineString([coords[i], coords[j]])
        last, start = i, 0.
        if line.intersects(pad.boundary):
            hits = line.intersection(pad.boundary)
            distances = sorted({line.project(p) for p in getattr(hits, 'geoms', [hits])
                                if p.geom_type == 'Point'})
            for at in distances:
                if at < 1.e-5 or at > line.length - 1.e-5:
                    continue
                node = len(coords)
                coords.append(line.interpolate(at).coords[0])
                heights.append(heights[i] + at / line.length * (heights[j] - heights[i]))
                sections.append((last, node, station + start, flags, way))
                last, start = node, at
        sections.append((last, j, station + start, flags, way))
    return np.asarray(coords), sections, np.asarray(heights)


def grade_limit(tags):
    if any(name in tags.get('name','') for name in ('衡柳','湘桂')):
        return .012
    return .025 if tags.get('service') or tags.get('usage') == 'branch' else .012


def fit_corridor(coords, pieces, native, ways):
    pad = station_pad(ways)
    if not pad.area:
        raise ValueError('Missing Guilin station platforms')
    coords, pieces, native = split_at_pad(coords, pieces, native, pad)
    fixed = np.array([pad.distance(Point(p)) < .001 for p in coords])
    a, b = np.array([(i,j) for i,j,*_ in pieces]).T
    lengths = np.linalg.norm(coords[a]-coords[b], axis=1)
    graph = sparse.coo_matrix((np.r_[lengths,lengths], (np.r_[a,b],np.r_[b,a])),
                              shape=(len(coords),len(coords))).tocsr()
    distance = dijkstra(graph, indices=np.flatnonzero(fixed), min_only=True)
    limits = np.array([grade_limit(ways[w]['tags']) for _,_,_,_,w in pieces])
    side = np.sign(coords[:,1] - pad.centroid.y)
    result = native.copy()
    result[fixed] = RAILHEAD
    cuts = {}
    boundaries = {}
    for direction, label in ((-1,'north'),(1,'south')):
        on_side = (side[a] == direction) | (side[b] == direction)
        ends = np.flatnonzero(on_side & ~(fixed[a] & fixed[b]))
        yard = np.flatnonzero(on_side & fixed[a] & fixed[b])

        def trial(extent, final=False):
            xy, bounds, key_for, local, sections, slopes, adjustable = [], [], [], {}, [], [], []
            def vertex(key, position, main, pinned):
                if key not in local:
                    local[key] = len(xy)
                    xy.append(position)
                    bounds.append((pinned,pinned) if pinned is not None else (None,None))
                    key_for.append((key,main))
                return local[key]
            ties = {}
            def original(i):
                return vertex(i,coords[i],native[i],RAILHEAD if fixed[i] else
                              native[i] if distance[i] >= extent else None)
            for k in ends[np.minimum(distance[a[ends]],distance[b[ends]]) < extent + 48]:
                i,j,station,flags,w = pieces[k]
                if max(distance[i],distance[j]) >= extent > min(distance[i],distance[j]):
                    u = (extent-distance[i])/(distance[j]-distance[i])
                    base = native[i]+u*(native[j]-native[i])
                    pos = coords[i]+u*(coords[j]-coords[i])
                    cut = vertex(('tie',k),pos,base,base)
                    ties[k] = (u,pos,base)
                    ranges = [(original(i),cut,distance[i]<extent),
                              (cut,original(j),distance[j]<extent)]
                else:
                    ranges = [(original(i),original(j),min(distance[i],distance[j])<extent)]
                for l,r,active in ranges:
                    length = np.linalg.norm(xy[l]-xy[r])
                    if length < 1.e-7:
                        continue
                    sections.append((l,r,station,flags,w))
                    adjustable.append(active)
                    if active:
                        slopes.append((l,r,length*limits[k]))
            for k in yard:
                i,j,station,flags,w = pieces[k]
                sections.append((original(i),original(j),station,flags,w))
                adjustable.append(True)
            rows, cols, data, rhs = [], [], [], []
            def difference(nodes, weights, limit):
                for sign in (1,-1):
                    rows.extend([len(rhs)]*len(nodes))
                    cols.extend(nodes)
                    data.extend(sign*v for v in weights)
                    rhs.append(limit)
            for l,r,limit in slopes:
                difference((l,r),(1,-1),limit)
            pairs = parallel_segments(sections,np.asarray(xy),ways)
            if pairs:
                aa,bb,ua,ub,*_ = pairs
                active_edges = {(l,r) for (l,r,*_),moving in zip(sections,adjustable) if moving}
                for i in range(len(aa)):
                    if tuple(aa[i]) not in active_edges and tuple(bb[i]) not in active_edges:
                        continue
                    for u,v in zip(ua[i], ub[i]):
                        difference((*aa[i],*bb[i]),(1-u,u,v-1,-v),.04999)
            n = len(xy)
            mat = sparse.coo_matrix((data,(rows,cols)),shape=(len(rhs),n)).tocsr()
            cost = np.zeros(n)
            if final:
                # Among feasible profiles minimize departure from the native rail head.
                ref = np.array([val for _,val in key_for])
                eye = sparse.eye(n,format='csr')
                mat = sparse.bmat([[mat,None],[eye,-eye],[-eye,-eye]],format='csr')
                rhs = np.r_[rhs,ref,-ref]
                bounds += [(0,None)]*n
                cost = np.r_[cost,np.ones(n)]
            fit = linprog(cost,A_ub=mat,b_ub=rhs,bounds=bounds,method='highs')
            if final and fit.success:
                for (k,_),v in zip(key_for,fit.x[:n]):
                    if isinstance(k,(int,np.integer)) and distance[k]<extent:
                        result[k] = v
                cuts.update(ties)
            return fit.success
        # Check possible integral-metre boundaries in order. A native rail
        # endpoint that is unreachable by grade alone cannot be a tie point.
        reachable = dijkstra(sparse.coo_matrix((np.r_[lengths*limits,lengths*limits],
                             (np.r_[a,b],np.r_[b,a])),shape=graph.shape).tocsr(),
                             indices=np.flatnonzero(fixed),min_only=True)
        for extent in range(1,math.ceil(max(distance[ends_node] for ends_node in
                                             np.unique(np.r_[a[ends],b[ends]]) if np.isfinite(distance[ends_node])))+2):
            lo,hi = distance[a[ends]],distance[b[ends]]
            k = ends[(np.minimum(lo,hi)<extent)&(np.maximum(lo,hi)>=extent)]
            if not len(k):
                continue
            u = (extent-distance[a[k]])/(distance[b[k]]-distance[a[k]])
            tie_y = native[a[k]]+u*(native[b[k]]-native[a[k]])
            gain = np.minimum(reachable[a[k]]+u*lengths[k]*limits[k],
                              reachable[b[k]]+(1-u)*lengths[k]*limits[k])
            if np.any(abs(tie_y-RAILHEAD)>gain+1.e-7) or not trial(extent):
                continue
            if not trial(extent,True):
                raise ValueError('Unable to fit Guilin station at selected tie point')
            boundaries[label] = dict(fromPadEndM=extent,ties=len(k))
            break
        else:
            raise ValueError(f'Guilin station cannot tie back to main on its {label} end')
    points = list(coords)
    levels = list(result)
    output = []
    for k,(i,j,station,flags,w) in enumerate(pieces):
        if k in cuts:
            u,pos,val = cuts[k]
            if 1.e-8 < u < 1-1.e-8:
                idx = len(points)
                points.append(pos)
                levels.append(val)
                output.append((i,idx,station,flags,w))
                i,station = idx,station+u*lengths[k]
        output.append((i,j,station,flags,w))
    return np.asarray(points),output,np.asarray(levels),boundaries
