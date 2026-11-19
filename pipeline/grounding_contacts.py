"""Physical joints between independently packed components of a landmark."""
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
import shapely


def intersect_triangles(a, b, tolerance=.012):
    # Separating axes for two convex triangles. In-plane edge normals handle
    # coplanar overlap. Offsetting both triangles keeps the dot products local.
    origin = a[:, :1]
    a, b = a-origin, b-origin
    ea, eb = np.roll(a,-1,axis=1)-a, np.roll(b,-1,axis=1)-b
    na, nb = np.cross(ea[:,0],ea[:,1]), np.cross(eb[:,0],eb[:,1])
    overlap = np.ones(len(a), dtype=bool)
    def test(axis):
        margin = tolerance*np.linalg.norm(axis,axis=1)
        pa, pb = np.einsum('ij,ikj->ik',axis,a), np.einsum('ij,ikj->ik',axis,b)
        overlap[:] &= (pa.min(axis=1)<=pb.max(axis=1)+margin) & (pb.min(axis=1)<=pa.max(axis=1)+margin)
    test(na)
    test(nb)
    for axis in range(3):
        test(np.cross(ea[:,axis],na))
        test(np.cross(eb[:,axis],nb))
        for other in range(3):
            test(np.cross(ea[:,axis],eb[:,other]))
    return overlap


def crossing_joints(tris, face_group, count):
    """A beam passing through a wall need not have a vertex on that wall."""
    lo, hi = tris.min(axis=1), tris.max(axis=1)
    boxes = shapely.box(lo[:,0]-.006,lo[:,2]-.006,hi[:,0]+.006,hi[:,2]+.006)
    tree = shapely.STRtree(boxes)
    pairs = set()
    for start in range(0,len(tris),192):
        a,b=tree.query(boxes[start:start+192])
        a+=start
        keep=(a<b)&(face_group[a]!=face_group[b])&(lo[a,1]<=hi[b,1]+.012)&(lo[b,1]<=hi[a,1]+.012)
        a,b=a[keep],b[keep]
        if len(a):
            touch=intersect_triangles(tris[a],tris[b])
            groups=np.sort(np.column_stack((face_group[a[touch]],face_group[b[touch]])),axis=1)
            pairs.update(map(tuple,np.unique(groups,axis=0)))
    i,j=np.array(list(pairs),dtype=int).reshape(-1,2).T
    graph=coo_matrix((np.ones(len(i),dtype=bool),(i,j)),shape=(count,count))
    return connected_components(graph,directed=False)[1]
