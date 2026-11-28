"""Local centimetre samples derived from the published GL04, not the roof DEM."""
from pathlib import Path

import numpy as np


PROFILE=Path(__file__).resolve().parents[1]/'data/landmarks/liangjiang-grades.npz'


class Grade:
    def __init__(self,name,center):
        with np.load(PROFILE) as record:
            self.samples=record[name].astype(float)/100
            self.origin=record[name+'_origin']-[center.x,center.y]
        self.datum=float(self.height(np.array([[0,0]]))[0])

    def height(self,points):
        grid=(points-self.origin)/4
        cells=np.floor(grid).astype(int)
        east,south=cells.T; across,down=(grid-cells).T
        nw=self.samples[south,east];ne=self.samples[south,east+1]
        sw=self.samples[south+1,east];se=self.samples[south+1,east+1]
        return np.where(across+down<=1,nw+(ne-nw)*across+(sw-nw)*down,
                        se+(sw-se)*(1-across)+(ne-se)*(1-down))

    def fit(self,mesh):
        verts=mesh.vertices.copy();height=verts[:,1].copy()
        ground=self.height(verts[:,::2])-self.datum
        blend=np.clip(height/7,0,1)
        verts[:,1]=np.maximum(height,-.06)+(1-blend)*ground+blend*(self.samples.max()-self.datum)
        mesh.vertices=verts
        return mesh


def extract(directory):
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from landmarks.world_surface import Surface
    from airport import airfield
    import json
    world=Surface(directory)
    footprints={element['id']:foot for element,foot,_ in airfield()[1]}
    arrays={}
    for entry in json.loads((PROFILE.parents[2]/'landmarks.json').read_text()):
        if not entry.get('expandedAirport'): continue
        key=entry['id'].removeprefix('liangjiang_');bounds=footprints[int(entry['anchor'].split('/')[1])].bounds
        start=np.floor(np.array(bounds[:2])/4).astype(int)-3
        end=np.ceil(np.array(bounds[2:])/4).astype(int)+3
        arrays[key+'_origin']=start*4
        arrays[key]=np.array([[round(world.sample(east*4,south*4,include_peaks=False)[0]*100)
            for east in range(start[0],end[0]+1)] for south in range(start[1],end[1]+1)],dtype='<i2')
    np.savez_compressed(PROFILE,**arrays)


if __name__=='__main__':
    import sys
    extract(sys.argv[1])
