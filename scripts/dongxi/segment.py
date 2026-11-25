from pathlib import Path
import math,json,sys
import numpy as np
import onnxruntime as ort
from PIL import Image,ImageDraw
from scipy.special import expit,softmax

root=Path(__file__).resolve().parents[2];folder=root/'pipeline/data/layout';bounds=next(e['replace']['polygon'] for e in json.loads((root/'pipeline/landmarks.json').read_text()) if e['id']=='wangcheng_market')
zoom=19
def absolute(lon,lat):return np.asarray([(lon+180)/360,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2])*256*2**zoom
lower=np.floor(np.min([absolute(*p) for p in bounds],axis=0)).astype(int)-64
upper=np.ceil(np.max([absolute(*p) for p in bounds],axis=0)).astype(int)+64
def pixel(coord):return tuple(absolute(*coord)-lower)
size=tuple(upper-lower); photo=Image.new('RGB',size)
for tx in range(lower[0]//256,upper[0]//256+1):
    for ty in range(lower[1]//256,upper[1]//256+1):
        tile=Image.open(f'tiles/esri_{zoom}_{tx}_{ty}.img').convert('RGB');photo.paste(tile,(int(tx*256-lower[0]),int(ty*256-lower[1])))
photo.save('density-rgb.png');image=np.asarray(photo)/255;options=ort.SessionOptions();options.intra_op_num_threads=3;session=ort.InferenceSession('roofs.onnx',options);out=np.zeros((3,*image.shape[:2]),dtype='f');counts=out[0].copy();weight=np.maximum(.02,np.outer(np.hanning(256),np.hanning(256)))
for row in sorted(set(min(r,size[1]-256) for r in range(0,size[1],192))):
    for col in sorted(set(min(c,size[0]-256) for c in range(0,size[0],192))):
        tile=(image[row:row+256,col:col+256]-[.485,.456,.406])/[.229,.224,.225];logits=session.run(None,{'image':tile.transpose(2,0,1)[None].astype('f')})[0][0];out[:,row:row+256,col:col+256]+=logits*weight;counts[row:row+256,col:col+256]+=weight
out/=counts;np.savez_compressed('density-logits.npz',logits=out,lower=lower,zoom=zoom)
for kind in ['roof','lane']:
    mask=Image.new('1',size);draw=ImageDraw.Draw(mask)
    for feat in json.loads(((root/'pipeline/data/layout')/'dongxi-layout.geojson').read_text())['features']:
        if feat['properties']['kind']!=kind:continue
        coords=feat['geometry']['coordinates'];draw.polygon([pixel(p) for p in coords[0]],fill=1) if kind=='roof' else draw.line([pixel(p) for p in coords],fill=1,width=4)
    selected=np.asarray(mask);print(kind,'sigmoid',expit(out[:,selected]).mean(1),'softmax',softmax(out[:,selected],axis=0).mean(1),flush=True)
