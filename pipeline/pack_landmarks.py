import json
import os
import subprocess
import sys
import trimesh
import numpy as np
from pathlib import Path
from tempfile import TemporaryDirectory


root = Path(__file__).resolve().parent
for entry in json.loads((root/'landmarks.json').read_text()):
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
        subprocess.run([os.getenv('GLTFPACK','gltfpack'), '-i', Path(temp)/f"{entry['id']}.glb",
                        '-o', target, '-cc','-tc','-tl','1024','-kn'],check=True)
        target.with_suffix('.json').write_text(json.dumps(info)+'\n')
