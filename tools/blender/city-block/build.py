# City building blocks (original asset): 4 facade variants for the twisting-city stage.
# Run: /opt/homebrew/bin/blender -b -P tools/blender/city-block/build.py
# Output: public/models/city-block.glb  (meshes "Block0".."Block3")
#
# Local frame (three.js coords): block centred on the origin, pitch 14.044 (z) x 13.435 (y) x 26.8015 (x).
# The street facade faces -x and sits at x = -13.4; the runtime mirrors blocks for the other street side.
# Vertex colour "Col" (linear RGBA): rgb = albedo (with baked-in recess darkening), a = window-glass mask.
# UV0 on glass: u = per-pane random, v = per-window random (a lit window lights all its panes together).
import bpy, math, os, random
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../public/models/city-block.glb')
W, H, D = 14.044, 13.435, 26.8015
FX = -D / 2          # facade plane
HW, HH = W / 2 - 0.2, H / 2 - 0.15

bpy.ops.wm.read_factory_settings(use_empty=True)


def B(x, y, z):
    return Vector((x, -z, y))


def finish(o, col, uvv=(0.0, 0.0), bevel=0.0, segs=1):
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        m = o.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = o.data
    a = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for d in a.data:
        d.color = col
    me.color_attributes.active_color = a
    me.color_attributes.render_color_index = 0
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    for l in me.uv_layers[0].data:
        l.uv = uvv
    o.select_set(False)
    return o


def box(x0, x1, y0, y1, z0, z1, col, bevel=0.0, uvv=(0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (x1 - x0, z1 - z0, y1 - y0)
    return finish(o, col, uvv, bevel)


def plane_x(x, y0, y1, z0, z1, col, uvv):
    """quad facing -x (the street) at depth x"""
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(x, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    # blender plane is in XY (normal +Z = three +y); rotate so the normal points to three -x (blender -X)
    o.rotation_euler = (0, -math.pi / 2, 0)
    o.scale = (y1 - y0, z1 - z0, 1)
    return finish(o, col, uvv)


def grey(v, t=0.0):
    return (v * (1 - t * 0.3), v, v * (1 + t * 0.15), 0.0)


GLASS = (0.035, 0.045, 0.06, 1.0)
FRAME = (0.16, 0.17, 0.18, 0.0)
DARK = (0.05, 0.055, 0.06, 0.0)


def window(z0, z1, y0, y1, cols, rows, rng, parts, depth=0.55):
    """recessed window: glass panes at FX+depth, mullions, sill; the opening's reveal comes from the
    surrounding piers/spandrels. Every pane carries (pane rand, window rand) in UV0."""
    g = rng.random()
    xg = FX + depth
    parts.append(box(FX + depth - 0.05, FX + depth + 0.25, y0, y1, z0, z1, DARK))  # dark back reveal
    pw, ph = (z1 - z0) / cols, (y1 - y0) / rows
    for c in range(cols):
        for r in range(rows):
            m = 0.07
            parts.append(plane_x(xg - 0.06, y0 + r * ph + m, y0 + (r + 1) * ph - m, z0 + c * pw + m, z0 + (c + 1) * pw - m,
                                 GLASS, (rng.random(), g)))
    for c in range(1, cols):
        z = z0 + c * pw
        parts.append(box(xg - 0.2, xg - 0.05, y0, y1, z - 0.07, z + 0.07, FRAME))
    for r in range(1, rows):
        y = y0 + r * ph
        parts.append(box(xg - 0.2, xg - 0.05, y - 0.06, y + 0.06, z0, z1, FRAME))
    parts.append(box(FX - 0.25, FX + 0.1, y0 - 0.22, y0, z0 - 0.15, z1 + 0.15, grey(0.62), 0.04))  # sill


def facade(parts, rng, floors, bays, wall, win_rows, win_cols, top=HH, bottom=-HH, x0=FX, inset=0.55):
    """piers + spandrels on the facade plane with recessed windows between them"""
    fh = (top - bottom) / floors
    bw = (2 * HW) / bays
    pier = 0.55 + rng.random() * 0.4
    for i in range(bays + 1):
        z = -HW + i * bw
        parts.append(box(x0, x0 + inset, bottom, top, max(-HW, z - pier / 2), min(HW, z + pier / 2), wall, 0.06))
    for f in range(floors + 1):
        y = bottom + f * fh
        sh = 1.0 if 0 < f < floors else 0.6
        parts.append(box(x0, x0 + inset, max(bottom, y - sh / 2), min(top, y + sh / 2), -HW, HW, wall, 0.06))
    for f in range(floors):
        for i in range(bays):
            if rng.random() < 0.12:  # blind bay
                continue
            y0 = bottom + f * fh + 0.5 + 0.05
            y1 = bottom + (f + 1) * fh - 0.5 - 0.35
            z0 = -HW + i * bw + pier / 2
            z1 = -HW + (i + 1) * bw - pier / 2
            window(z0, z1, y0, y1, win_cols, win_rows, rng, parts, inset)


def ac(parts, rng, n, wall):
    for _ in range(n):
        y = -HH + 1.2 + rng.random() * (2 * HH - 3)
        z = -HW + 1 + rng.random() * (2 * HW - 3)
        parts.append(box(FX - 0.9, FX, y, y + 0.9, z, z + 1.4, grey(0.58, 0.3), 0.08))
        parts.append(box(FX - 0.92, FX - 0.88, y + 0.15, y + 0.75, z + 0.2, z + 1.2, DARK))


def pipe(parts, z, wall):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=2 * HH, vertices=8, location=B(FX - 0.25, 0, z))
    o = bpy.context.active_object
    parts.append(finish(o, grey(0.5)))


def core(parts, wall, x0=FX + 0.5, top=HH, bottom=-HH):
    parts.append(box(x0, -FX, bottom, top, -HW, HW, wall, 0.18))
    # side seams (visible when the block is rolled / seen from the side)
    for z in (-HW - 0.02, HW + 0.02):
        for y in (-HH / 3, HH / 3):
            parts.append(box(x0 + 1, -FX - 1, y - 0.12, y + 0.12, z - 0.03, z + 0.03, DARK))


def variant(i):
    rng = random.Random(1234 + i * 97)
    parts = []
    wall = grey(0.5 + 0.05 * i, i * 0.3)
    if i == 0:  # 4 bays x 3 floors, 2x2 panes, balcony slab, AC units, parapet
        core(parts, wall)
        facade(parts, rng, 3, 4, wall, 2, 2)
        y = -HH + (2 * HH) / 3
        parts.append(box(FX - 1.4, FX, y - 0.25, y + 0.05, -HW + 0.3, HW - 0.3, grey(0.6), 0.08))
        for k in range(9):
            z = -HW + 0.5 + k * (2 * HW - 1) / 8
            parts.append(box(FX - 1.38, FX - 1.3, y + 0.05, y + 1.0, z - 0.04, z + 0.04, DARK))
        parts.append(box(FX - 1.38, FX - 1.28, y + 0.95, y + 1.05, -HW + 0.3, HW - 0.3, DARK))
        ac(parts, rng, 3, wall)
        parts.append(box(FX - 0.2, -FX, HH - 0.5, HH, -HW, HW, grey(0.58), 0.08))
    elif i == 1:  # stepped setback + oriel bay with its own windows
        core(parts, wall, top=HH - 3.6)
        facade(parts, rng, 2, 3, wall, 2, 3, top=HH - 3.6)
        # setback top storey, recessed 2.5
        parts.append(box(FX + 2.5, -FX, HH - 3.6, HH, -HW, HW, grey(0.55, 0.3), 0.15))
        facade(parts, rng, 1, 4, grey(0.55, 0.3), 1, 2, top=HH - 0.2, bottom=HH - 3.6, x0=FX + 2.5 - 0.55)
        parts.append(box(FX - 0.3, FX + 2.6, HH - 3.75, HH - 3.45, -HW, HW, grey(0.62), 0.06))
        # oriel
        parts.append(box(FX - 1.6, FX, -HH + 2.5, HH - 4.6, -2.2, 2.2, grey(0.58, 0.2), 0.12))
        for f in range(2):
            y0 = -HH + 3.0 + f * 2.8
            parts.append(box(FX - 1.65, FX - 1.55, y0, y0 + 1.9, -1.6, 1.6, DARK))
            for c in range(3):
                parts.append(plane_x(FX - 1.67, y0 + 0.1, y0 + 1.8, -1.55 + c * 1.05, -0.6 + c * 1.05, GLASS, (rng.random(), rng.random())))
        ac(parts, rng, 2, wall)
    elif i == 2:  # 4 bays, small windows, per-bay balconies with railings, drain pipes
        core(parts, wall)
        facade(parts, rng, 3, 4, wall, 2, 1)
        bw = (2 * HW) / 4
        for f in range(1, 3):
            y = -HH + f * (2 * HH) / 3
            for b in range(4):
                if rng.random() < 0.55:
                    z0, z1 = -HW + b * bw + 0.5, -HW + (b + 1) * bw - 0.5
                    parts.append(box(FX - 1.1, FX, y - 0.2, y + 0.05, z0, z1, grey(0.6), 0.05))
                    parts.append(box(FX - 1.12, FX - 1.02, y + 0.05, y + 0.95, z0, z1, grey(0.35)))
        pipe(parts, -HW + 0.4, wall)
        pipe(parts, 1.2, wall)
        ac(parts, rng, 2, wall)
    else:  # industrial: 2 wide bays, 3x3 panes, vertical fins, ledges
        core(parts, wall)
        facade(parts, rng, 2, 2, wall, 3, 3)
        for k in range(5):
            z = -HW + 0.8 + k * (2 * HW - 1.6) / 4
            parts.append(box(FX - 0.9, FX, -HH, HH, z - 0.12, z + 0.12, grey(0.6)))
        parts.append(box(FX - 0.7, FX, -0.35, 0.0, -HW, HW, grey(0.62), 0.06))
        ac(parts, rng, 4, wall)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = f'Block{i}'
    bpy.ops.object.shade_flat()
    o.select_set(False)
    return o


mat = bpy.data.materials.new('City')
for i in range(4):
    o = variant(i)
    o.data.materials.clear()
    o.data.materials.append(mat)
    print(o.name, 'tris', sum(len(p.vertices) - 2 for p in o.data.polygons))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='ACTIVE',
    export_animations=False, export_skins=False, export_materials='EXPORT', export_normals=True,
    export_draco_mesh_compression_enable=False, export_yup=True,
)
print('WROTE', os.path.abspath(OUT))
