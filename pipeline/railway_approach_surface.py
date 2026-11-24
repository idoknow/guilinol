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


def fit_patch(control, mask, left, top, roads, anchors):
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
    if anchors:
        x,z,lo,hi = np.array(anchors).T
        bounds(basis(shape,left,top,np.column_stack((x,z))),lo-datum,hi-datum)
    samples,radii = [],[]
    for line,tags in roads:
        if line.length<.1:
            continue
        ds = np.linspace(0,line.length,max(2,math.ceil(line.length/3)+1))
        xy = get_coordinates(line_interpolate_point(line,ds))
        ij = np.rint((xy-[left,top])/STEP+1).astype(int)
        keep = distance[np.clip(ij[:,1],0,shape[0]-1),np.clip(ij[:,0],0,shape[1]-1)] < 96
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
        step = ds[1]
        slope = (center[1:]-center[:-1])/step
        valid = keep[:-1]&keep[1:]
        cap = grade_cap(tags)
        bounds(slope[valid],-cap,cap)
        bounds(((slope[1:]-slope[:-1])/step)[valid[1:]&valid[:-1]],-.005,.005)
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
        raise ValueError(f'Rail approach fit at ({left},{top}): {solution.status}')
    target[free] = solution.x
    fitted = datum+target.reshape(shape)
    blend = np.clip((136-distance)/40,0,1)
    control += (fitted-control)*blend**2*(3-2*blend)
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
    for tunnel in tunnels:
        if tunnel['way']==UNDERPASS:
            for x,y,z in tunnel['portals']:
                anchors.append((x,z,y-.049,y-.041))
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
                anchors.append((p.x,p.y,h-.09,h-.005))
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
        survey = fit_patch(local,mask,left,top,roads,active)
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
        road = eval_bspline_grid(local,left,top,xx,zz)-.24
        for field in (terrain,ground):
            old = field[patch]
            target = np.where(edge<1,road*10,np.minimum(old,road*10))
            old[:] = np.rint(old+blend*(target-old))
