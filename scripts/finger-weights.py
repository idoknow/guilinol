"""
给 figure_m.glb / figure_f.glb 补「食指」蒙皮权重（方案 A 的脚本版）

背景（Blender 实测数据）：
  骨架共 66 根骨，其中 40 根是手指骨（index/middle/ring/pinky/thumb 各 4 段 × 左右）。
  但顶点权重只有拇指有：thumb_01_l = 31 顶点、thumb_02_l = 38 顶点；
  index_01/02/03、middle、ring、pinky 全是 0 顶点 —— 手是一个「带拇指的连指手套」。

这个脚本做的事：
  1. 导入 GLB；
  2. 找出掌前区域里、离食指骨线段最近的一片顶点；
  3. 把这批顶点从原权重里摘出来，转给 index_01_<side> / index_02_<side>（按到指根的距离分成两段）；
  4. 导出新 GLB（原名 + .fingers.glb，不覆盖原文件），动作 idle/walk/wave 原样带出。

用法（Windows）：
  D:\\Blender\\blender-4.5.15-windows-x64\\blender.exe -b --factory-startup -P scripts/finger-weights.py

跑完后请先看输出里的指骨顶点数，再决定是否用 .fingers.glb 覆盖原文件；
覆盖后要跑一遍姿势回归（跑/跳/蹲/骑/抽烟/倒地/出拳），因为手部权重变了。
"""
import bpy
import json
import sys

MODELS = [
    (r"C:\Users\Administrator\Desktop\网上桂林\guilinol\public\avatar\figure_m.glb", "m"),
    (r"C:\Users\Administrator\Desktop\网上桂林\guilinol\public\avatar\figure_f.glb", "f"),
]

# 离食指骨线段多近算「属于食指」（米）
RADIUS = 0.024


def dist_to_segment(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared == 0 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def fix_model(path, tag):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name == 'Walker')
    bones = arm.data.bones

    summary = {}
    for side in ('l', 'r'):
        idx1 = bones.get('index_01_' + side)
        idx2 = bones.get('index_02_' + side)
        if not idx1 or not idx2:
            summary[side] = 'no index bones'
            continue
        a, b = idx1.head_local.copy(), idx1.tail_local.copy()
        c, d = idx2.head_local.copy(), idx2.tail_local.copy()
        hand = bones['hand_' + side]
        hand_head = hand.head_local.copy()

        picked1, picked2 = [], []
        for v in body.data.vertices:
            co = v.co
            # 只看掌前、且不在另一侧
            if (co.x - hand_head.x) * (1 if side == 'l' else -1) < 0.055:
                continue
            d1 = dist_to_segment(co, a, b)
            d2 = dist_to_segment(co, c, d)
            if min(d1, d2) > RADIUS:
                continue
            (picked1 if d1 <= d2 else picked2).append(v.index)

        g1 = body.vertex_groups.get('index_01_' + side) or body.vertex_groups.new(name='index_01_' + side)
        g2 = body.vertex_groups.get('index_02_' + side) or body.vertex_groups.new(name='index_02_' + side)
        for vid in picked1:
            body.data.vertices[vid].groups.clear() if False else None
            g1.add([vid], 1.0, 'REPLACE')
        for vid in picked2:
            g2.add([vid], 1.0, 'REPLACE')
        # 把这两段从其它组里摘干净，避免原手掌权重把它拉回去
        for g in body.vertex_groups:
            if g.name in (g1.name, g2.name):
                continue
            g.remove(picked1)
            g.remove(picked2)
        summary[side] = {'index_01': len(picked1), 'index_02': len(picked2)}

    out = path.replace('.glb', '.fingers.glb')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_animations=True,
        export_skins=True,
        export_yup=True,
        use_selection=False,
    )
    summary['output'] = out
    summary['actions'] = [a.name for a in bpy.data.actions]
    return summary


results = {}
for path, tag in MODELS:
    try:
        results[tag] = fix_model(path, tag)
    except Exception as error:  # noqa: BLE001
        results[tag] = 'ERROR: ' + str(error)
print('FINGERS_START')
print(json.dumps(results, ensure_ascii=False, indent=1))
print('FINGERS_END')
