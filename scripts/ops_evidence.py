import os
from pathlib import Path


def require_evidence(relative):
    root = os.environ.get('GLOL_OPS_ROOT')
    if root:
        path = Path(root).resolve() / 'docs' / relative
        if path.exists():
            return path
    print(f'SKIP: GLOL_OPS_ROOT 未配置或缺少私有资料 {relative}')
    raise SystemExit(0)
