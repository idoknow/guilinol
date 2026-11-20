import json
import os
import subprocess
import sys
from hidden_faces import GroundFloor, prune
import trimesh
import numpy as np
from pathlib import Path
from tempfile import TemporaryDirectory


root = Path(__file__).resolve().parent
ground = GroundFloor(root.parent / "public/world")
for entry in json.loads((root/'landmarks.json').read_text()):
    if entry.get('noStreetSign'):
        continue
    if len(sys.argv)>1 and entry['id'] not in sys.argv[1:]:
        continue
    generator = root/'landmarks'/f"{entry['id']}.py"
    if not generator.exists():
        continue
    target = root.parent/'public'/entry['model']
    target.parent.mkdir(exist_ok=True, parents=True)
    with TemporaryDirectory() as temp:
        subprocess.run([sys.executable, generator, temp], check=True)
        scene = trimesh.load_scene(Path(temp)/f"{entry['id']}.glb")
        minimum,maximum = scene.bounds
        info = dict(sphere=[*((minimum+maximum)/2),float(np.linalg.norm(maximum-minimum)/2)],
                    lods=sorted(name for name in scene.graph.nodes if name in ('lod0','lod1','lod2')))
        before, after = prune(Path(temp)/f"{entry['id']}.glb", entry['id'], ground)
        print(f"render triangles {entry['id']} {before} {after}", flush=True)
        subprocess.run([os.getenv('GLTFPACK','gltfpack'), '-i', Path(temp)/f"{entry['id']}.glb",
                        '-o', target, '-cc','-tc','-tl','1024','-kn'],check=True)
        target.with_suffix('.json').write_text(json.dumps(info)+'\n')
