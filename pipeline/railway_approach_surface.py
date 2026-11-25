"""Fit one continuous road surface across streets sharing a railway approach."""
import math

import clarabel
import numpy as np
from scipy import sparse
from scipy.ndimage import find_objects, label, maximum_filter, distance_transform_edt
from scipy.spatial import cKDTree
from shapely import LineString, Point, STRtree, box, get_coordinates, line_interpolate_point

from features import points
from railway_road_profiles import grade_cap
from road_grading import STEP, bspline_weights_1d, eval_bspline_grid
from road_profile import RULES
from station_levels import UNDERPASS
from station_approaches import approach_junctions


def basis(shape, left, top, xy):
    """Sparse evaluation of the same 16 cubic weights used by the renderer."""
    u = (xy - [left,top])/STEP + 1
    ix,iz = np.floor(u).astype(int).T
    ix = np.clip(ix,1,shape[1]-3)
    iz = np.clip(iz,1,shape[0]-3)
    wx,wz = (bspline_weights_1d(np.clip(t,0.,1.)) for t in (u[:,0]-ix,u[:,1]-iz))
    cols = np.column_stack([(iz+j-1)*shape[1]+ix+i-1 for j in range(4) for i in range(4)])
    weights = np.column_stack([wx[i]*wz[j] for j in range(4) for i in range(4)])
    return sparse.csr_matrix((weights.ravel(),cols.ravel(),16*np.arange(len(xy)+1)),
                             shape=(len(xy),math.prod(shape)))


class InfeasibleApproach(ValueError):
    pass


def fit_patch(control, mask, left, top, roads, anchors, curvature=.005, grade_reserve=.90):
    distance = distance_transform_edt(~mask)*STEP
    shape = control.shape
    n = control.size
    # Retain the old ground away from the streets being fitted.
    inertia = .4+9*np.minimum(distance/60,1)**2
    datum = np.median(control)
    target = control.ravel()-datum
    eye = sparse.eye(n,format='csr')
    index = np.arange(n).reshape(shape)
    hessian = sparse.diags(inertia.ravel()**2,format='csc')
    load = -(inertia.ravel()**2)*target
    for indices in (index,index.T):
        second = 2*eye[indices[1:-1].ravel()]-eye[indices[:-2].ravel()]-eye[indices[2:].ravel()]
        hessian += 81*(second.T@second)
    rows,limits = [],[]
    def bounds(matrix,low,high):
        for sign,limit in ((1,high),(-1,-np.asarray(low))):
            values = np.broadcast_to(limit,matrix.shape[0])
            finite = np.isfinite(values)
            if finite.any():
                rows.append(matrix[finite]*sign)
                limits.append(values[finite])
    # Keep unsampled transverse spline coefficients within the local
    # elevation range. Centreline constraints alone can otherwise be met
    # by enormous opposing coefficients on a short reverse curve.
    survey_heights = [v for anchor in anchors for v in anchor[2:] if np.isfinite(v)]
    lower = min(float(control.min()),min(survey_heights,default=datum))-1
    upper = max(float(control.max()),max(survey_heights,default=datum))+1
    bounds(eye,lower-datum,upper-datum)
    if anchors:
        x,z,lo,hi = np.array(anchors).T
        bounds(basis(shape,left,top,np.column_stack((x,z))),lo-datum,hi-datum)
    samples,radii = [],[]
    for line,tags in roads:
        if line.length<.1:
            continue
        ds = np.linspace(0,line.length,max(2,math.ceil(line.length/2)+1))
        xy = get_coordinates(line_interpolate_point(line,ds))
        ij = np.rint((xy-[left,top])/STEP+1).astype(int)
        keep = distance[np.clip(ij[:,1],0,shape[0]-1),np.clip(ij[:,0],0,shape[1]-1)] < 128
        if not keep.any():
            continue
        direction = np.gradient(xy,axis=0)
        side = direction[:,::-1]*[-1.,1.]/np.maximum(1.e-8,np.linalg.norm(direction,axis=1))[:,None]
        try:
            width = float(tags.get('width','').removesuffix('m').strip())
        except ValueError:
            width = RULES['defaultWidth'].get(tags['highway'],4.)
        span = max(1.,width*.45)
        center = basis(shape,left,top,xy)
        cross = (basis(shape,left,top,(xy+side*span)[keep])-basis(shape,left,top,(xy-side*span)[keep]))/(2*span)
        bounds(cross,-.024,.024)
        # A station grid can straddle a bend. Bound the crossfall on both
        # incident segments, using their own normals up to the shared vertex.
        coords = np.asarray(line.coords)
        legs = np.diff(coords,axis=0)
        lengths = np.linalg.norm(legs,axis=1)
        if len(legs)>1:
            ij = np.rint((coords[1:-1]-[left,top])/STEP+1).astype(int)
            corner = distance[np.clip(ij[:,1],0,shape[0]-1),np.clip(ij[:,0],0,shape[1]-1)]<128
            directions = legs/np.maximum(lengths[:,None],1.e-8)
            corner &= np.sum(directions[1:]*directions[:-1],axis=1)<.999
            for tangent in (directions[:-1][corner],directions[1:][corner]):
                if not len(tangent):
                    continue
                offsets = tangent[:,::-1]*[-1.,1.]*span
                centers = coords[1:-1][corner]
                tilt = (basis(shape,left,top,centers+offsets)-basis(shape,left,top,centers-offsets))/(2*span)
                bounds(tilt,-.024,.024)
        step = ds[1]
        slope = (center[1:]-center[:-1])/step
        valid = keep[:-1]&keep[1:]
        # Leave headroom for centimetre deck vertices, the 4 m street
        # tessellation, and interpolation across bends between survey stations.
        cap = grade_reserve * grade_cap(tags)
        bounds(slope[valid],-cap,cap)
        bounds(((slope[1:]-slope[:-1])/step)[valid[1:]&valid[:-1]],-curvature,curvature)
        samples.append(xy[keep])
        radii.append(np.full(keep.sum(),span))
    if not samples:
        return
    constraints = sparse.vstack(rows,format='csc')
    settings = clarabel.DefaultSettings()
    settings.verbose = False
    settings.tol_gap_abs = 1.e-6
    settings.tol_gap_rel = 1.e-6
    settings.tol_feas = 1.e-7
    free = distance.ravel()<136
    fixed = ~free
    rhs = np.concatenate(limits)-constraints[:,fixed]@target[fixed]
    load = load[free]+hessian.tocsr()[free][:,fixed]@target[fixed]
    hessian = hessian.tocsr()[free][:,free]
    constraints = constraints[:,free]
    solution = clarabel.DefaultSolver(sparse.triu(hessian).tocsc(),load,constraints,rhs,
                                     [clarabel.NonnegativeConeT(len(rhs))],settings).solve()
    if solution.status not in (clarabel.SolverStatus.Solved,clarabel.SolverStatus.AlmostSolved):
        if curvature==.005 and solution.status==clarabel.SolverStatus.PrimalInfeasible:
            # Close consecutive crossing panels can require a shorter vertical
            # curve. At 0.014/m the slope changes by at most 2.8% over 2 m.
            return fit_patch(control,mask,left,top,roads,anchors,curvature=.014,grade_reserve=grade_reserve)
        if grade_reserve<1 and solution.status==clarabel.SolverStatus.PrimalInfeasible:
            # Where the hard crossing datums consume the interpolation reserve,
            # fit to the actual class limit and check the emitted triangles.
            return fit_patch(control,mask,left,top,roads,anchors,curvature=curvature,grade_reserve=1.)
        raise InfeasibleApproach(f'Rail approach fit at ({left},{top}): {solution.status}')
    target[free] = solution.x
    fitted = datum+target.reshape(shape)
    # The outer knots are fixed in the solve. A second blend after solving
    # shortens the tie-in and changes the already constrained derivative.
    control[:] = fitted
    return np.vstack(samples),np.concatenate(radii)


def grade_approach_surfaces(ways, crossings, panels, tunnels, plans, protected, water):
    terrain,ground,control = protected.after
    old_terrain,old_ground,old_control = protected.before
    changed = abs(control-old_control)>.01
    for field,old in ((terrain,old_terrain),(ground,old_ground)):
        changed[1:-1,1:-1] |= field[::2,::2]!=old[::2,::2]
    # Solve each connected area of edits together, including its boundary roads.
    labels,count = label(maximum_filter(changed,size=35))
    regions = find_objects(labels,max_label=count)
    streets = [(LineString(points(w)),w['tags']) for w in ways.values()
               if w.get('tags',{}).get('highway') and len(w.get('geometry',()))>=2
               and all(w['tags'].get(k,'no')=='no' for k in ('tunnel','bridge'))]
    tree = STRtree([line for line,_ in streets])
    anchors = []
    for panel in panels:
        w = ways[panel['road']]
        line = LineString(points(w))
        start,end = panel['fromM'],panel['toM']
        y = panel['railY']-.045
        for at in np.linspace(start,end,max(2,math.ceil((end-start)/3)+1)):
            p = line.interpolate(at)
            anchors.append((p.x,p.y,y-.004,y+.004))
    for r in crossings:
        if r['type']=='rail_over' and r['surfaceRoad']:
            anchors.append((r['x'],r['z'],-np.inf,r['railY']-5.805))
    paired = LineString(points(ways[UNDERPASS])).buffer(340)
    lower_roads = {r['road'] for r in crossings if r['type']=='rail_over'}
    mouths = [(t['way'],node,portal) for t in tunnels if t['way'] in lower_roads
              for node,portal,open_end in zip(t.get('nodes',()),t['portals'],t.get('mouths',()))
              if open_end and not paired.covers(Point(portal[0],portal[2]))]
    cut_roads = set()
    for tunnel in tunnels:
        if tunnel['way']==UNDERPASS:
            for (x,y,z),junction in zip(tunnel['portals'],approach_junctions(ways)):
                line = LineString(points(ways[junction['approachWay']]))
                start = line.project(Point(x,z))
                sign = 1 if start<line.length/2 else -1
                # Bake the level mouth landing into the road itself. At its
                # far edge the curvature and grade limits continue outwards.
                for offset in (0,4,8,12,16,20):
                    p = line.interpolate(np.clip(start+sign*offset,0,line.length))
                    anchors.append((p.x,p.y,y-.049,y-.041))
    surface_nodes = {node for w in ways.values() if w.get('tags',{}).get('highway')
                     and all(w['tags'].get(k,'no')=='no' for k in ('tunnel','bridge'))
                     for node in w.get('nodes',())}
    for wid,(line,_,stations,levels) in plans.items():
        if wid not in ways:
            continue
        for at,h in zip((stations[0],stations[-1]),(levels[0],levels[-1])):
            p = line.interpolate(at)
            # Joint targets are only meaningful at road-level abutments.
            if ways[wid]['nodes'][0 if at==stations[0] else -1] in surface_nodes:
                anchors.append((p.x,p.y,h-.047,h-.043))
    for num,(rows,cols) in enumerate(regions,1):
        if rows.stop-rows.start<4 or cols.stop-cols.start<4:
            continue
        mask = changed[rows,cols] & (labels[rows,cols]==num)
        left = protected.left+cols.start*STEP
        top = protected.top+rows.start*STEP
        region = box(left+8,top+8,left+(cols.stop-cols.start-4)*STEP,top+(rows.stop-rows.start-4)*STEP)
        roads = []
        for i in tree.query(region,predicate='intersects'):
            line,tags = streets[i]
            clipped = line.intersection(region)
            roads.extend((seg,tags) for seg in getattr(clipped,'geoms',[clipped]) if seg.geom_type=='LineString')
        support = maximum_filter(mask,size=25)
        active = [a for a in anchors if region.contains(Point(*a[:2])) and
                  support[round((a[1]-top)/STEP)+1,round((a[0]-left)/STEP)+1]]
        local = control[rows,cols]
        try:
            def supported(x,z):
                return region.contains(Point(x,z)) and support[round((z-top)/STEP)+1,round((x-left)/STEP)+1]
            entries = [m for m in mouths if supported(m[2][0],m[2][2])]
            lips = [(x,z,y-.049,y-.041) for _,_,(x,y,z) in entries]
            try:
                survey = fit_patch(local,mask,left,top,roads,active+lips)
            except InfeasibleApproach:
                if not entries:
                    raise
                # The surface above a separate lower carriageway cannot also
                # carry its entrance. Grade the connected cut independently.
                survey = fit_patch(local,mask,left,top,roads,active)
                cut_roads.update(wid for wid,_,_ in entries)
        except InfeasibleApproach as error:
            rails = sorted({r['rail'] for r in crossings if region.covers(Point(r['x'],r['z']))})
            abutments = sorted(wid for wid,(line,_,_,_) in plans.items() if line.intersects(region))
            raise InfeasibleApproach(f'{error}; rail ways {rails}; bridge ways {abutments}; '
                                     f'{len(active)} surface elevation bounds') from error
        if survey is None:
            continue
        xy,radii = survey
        # Clear quantized terrain only inside and alongside the graded carriageways.
        patch = np.s_[2*rows.start:2*(rows.stop-2)-1,2*cols.start:2*(cols.stop-2)-1]
        nz,nx = ground[patch].shape
        xx,zz = np.meshgrid(left+np.arange(nx)*4,top+np.arange(nz)*4)
        d,idx = cKDTree(xy).query(np.column_stack((xx.ravel(),zz.ravel())))
        edge = (d-radii[idx]).reshape(xx.shape)
        blend = np.clip((24-edge)/14,0,1)
        blend = blend**2*(3-2*blend)*(water[patch]==-32768)
        np.maximum(protected.paved_support[patch], np.rint(blend*255).astype(np.uint8),
                   out=protected.paved_support[patch])
        road = eval_bspline_grid(local,left,top,xx,zz)-.24
        # A dry tile edge is rendered as 32 m chords. Keep both chord
        # supports below the fitted carriageway wherever it crosses that edge.
        for coords,levels,weights,wet in (
                (xx,road,blend,water[patch]),(zz.T,road.T,blend.T,water[patch].T)):
            orthogonal = zz if coords is xx else xx.T
            for row in np.flatnonzero(orthogonal[:,0]%256==0):
                for col in np.flatnonzero(coords[row]%32==0):
                    if col+8>=levels.shape[1]:
                        continue
                    section = slice(col,col+9)
                    active = weights[row,section]>.8
                    if not np.any(active) or np.any(wet[row,section]!=-32768):
                        continue
                    y = np.min(levels[row,section][active])-.15
                    for k in (col,col+8):
                        levels[row,k] = min(levels[row,k],y)
                        weights[row,k] = 1.
        for field in (terrain,ground):
            old = field[patch]
            target = np.where(edge<1,road*10,np.minimum(old,road*10))
            old[:] = np.rint(old+blend*(target-old))
    return cut_roads
