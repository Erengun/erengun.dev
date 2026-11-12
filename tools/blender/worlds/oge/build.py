# Öge world ("One Desk" control room) props, original geometry.
# Run: /opt/homebrew/bin/blender -b -P tools/blender/worlds/oge/build.py
# Output: public/worlds/oge/props.glb with meshes:
#   Desk      one 2.0 m desk segment with a two-tier monitor rail (monitors are instanced separately)
#   Monitor   bezel + back shell, screen centre at the origin facing +z (screen quad 0.60 x 0.36 drawn in three)
#   BigFrame  wall display frame around a 3.6 x 2.143 screen centred at the origin, facing +z
#   Pedestal  printer console + stamp gantry (origin on the floor)
#   Printer   thermal receipt printer (origin at its bottom centre, paper exits at (0, .118, .085) heading +z)
#   Stamp     stamp head on a piston rod (origin at the rubber face centre)
#   Chair     office chair (origin on the floor, facing +z)
#
# Vertex colour "Col" (linear RGBA): rgb = albedo (baked darkening in recesses), a = material class:
#   0.0 emissive (rgb = emission), 0.25 matte plastic, 0.5 satin metal, 0.75 glossy laminate, 1.0 rubber/fabric
import bpy, math, os
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../public/worlds/oge/props.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)


def B(x, y, z):  # three.js (x right, y up, z toward viewer) -> blender
    return Vector((x, -z, y))


def finish(o, col, bevel=0.0, segs=1):
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
    o.select_set(False)
    return o


def box(x0, x1, y0, y1, z0, z1, col, bevel=0.0, segs=1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (x1 - x0, z1 - z0, y1 - y0)
    return finish(o, col, bevel, segs)


def cyl(x, y0, y1, z, r, col, verts=16, axis='y', bevel=0.0):
    h = y1 - y0
    if axis == 'y':
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=B(x, (y0 + y1) / 2, z))
    elif axis == 'x':  # y0..y1 interpreted along x, (x) is ignored; centre given by z, y = x param
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=B((y0 + y1) / 2, x, z),
                                            rotation=(0, math.pi / 2, 0))
    else:  # along z
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=B(x, z, (y0 + y1) / 2),
                                            rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    return finish(o, col, bevel)


def sphere(x, y, z, r, col, sx=1, sy=1, sz=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=r, location=B(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sz, sy)
    return finish(o, col)


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    bpy.ops.object.shade_flat()
    return o


def C(r, g, b, cls):
    return (r, g, b, cls)


LAM = C(0.045, 0.043, 0.042, 0.75)      # dark desk laminate
LAM_EDGE = C(0.11, 0.105, 0.1, 0.5)     # aluminium edge
STEEL = C(0.075, 0.075, 0.08, 0.5)
STEEL_D = C(0.03, 0.03, 0.033, 0.5)
PLAST = C(0.028, 0.028, 0.03, 0.25)
PLAST_L = C(0.06, 0.06, 0.062, 0.25)
RUBBER = C(0.02, 0.02, 0.02, 1.0)
FABRIC = C(0.03, 0.028, 0.027, 1.0)
CREAM = C(0.78, 0.74, 0.66, 0.25)
ORANGE_E = C(1.0, 0.22, 0.04, 0.0)
ORANGE_P = C(0.6, 0.12, 0.03, 0.25)
LED_G = C(0.3, 1.0, 0.45, 0.0)
SHADOW = C(0.012, 0.012, 0.013, 0.25)

# ------------------------------------------------------------------ Desk (2.0 m segment, front edge at z=+.4)
p = []
p.append(box(-1.0, 1.0, 0.72, 0.75, -0.4, 0.4, LAM, bevel=0.006))
p.append(box(-1.0, 1.0, 0.705, 0.72, 0.385, 0.405, LAM_EDGE))                 # front aluminium lip
p.append(box(-0.98, -0.94, 0.0, 0.72, -0.36, 0.34, STEEL_D))                   # end panels
p.append(box(0.94, 0.98, 0.0, 0.72, -0.36, 0.34, STEEL_D))
p.append(box(-0.94, 0.94, 0.12, 0.70, -0.37, -0.35, SHADOW))                  # modesty panel
p.append(box(-0.94, 0.94, 0.58, 0.66, -0.3, -0.12, STEEL_D))                  # cable tray
# monitor rail: two posts and two crossbars (lower monitors centred at y=1.0, upper at y=1.42)
for x in (-0.96, 0.96):
    p.append(box(x - 0.025, x + 0.025, 0.75, 1.68, -0.33, -0.28, STEEL))
    p.append(box(x - 0.06, x + 0.06, 0.75, 0.77, -0.38, -0.23, STEEL_D))
for y in (1.0, 1.42):
    p.append(box(-0.96, 0.96, y - 0.02, y + 0.02, -0.33, -0.29, STEEL))
p.append(box(-0.98, 0.98, 1.66, 1.70, -0.34, -0.27, STEEL))
# orange status strip on the top rail (emissive)
p.append(box(-0.9, 0.9, 1.70, 1.705, -0.31, -0.29, ORANGE_E))
# keyboards + mice for two operators
for x in (-0.5, 0.5):
    p.append(box(x - 0.22, x + 0.22, 0.75, 0.765, 0.06, 0.22, PLAST, bevel=0.004))
    p.append(box(x - 0.205, x + 0.205, 0.765, 0.768, 0.075, 0.205, PLAST_L))
    p.append(box(x + 0.29, x + 0.35, 0.75, 0.772, 0.1, 0.2, PLAST, bevel=0.008))
# a paper notepad, a mug
p.append(box(-0.08, 0.08, 0.75, 0.756, 0.12, 0.3, CREAM))
p.append(cyl(0.2, 0.75, 0.85, 0.15, 0.04, C(0.5, 0.48, 0.44, 0.25), verts=14))
p.append(cyl(0.2, 0.84, 0.845, 0.15, 0.034, C(0.02, 0.012, 0.008, 0.75), verts=14))
desk = join('Desk', p)

# ------------------------------------------------------------------ Monitor (screen 0.60 x 0.36 at z=0)
p = []
p.append(box(-0.315, 0.315, -0.198, 0.198, -0.028, -0.001, PLAST, bevel=0.006))
p.append(box(-0.315, 0.315, -0.198, -0.17, -0.001, 0.004, PLAST_L))            # chin
p.append(box(-0.2, 0.2, -0.12, 0.12, -0.07, -0.028, PLAST, bevel=0.01))         # back shell
p.append(box(-0.05, 0.05, -0.05, 0.05, -0.12, -0.07, STEEL))                   # VESA mount -> rail
p.append(box(0.27, 0.285, -0.188, -0.182, 0.004, 0.006, ORANGE_E))              # power LED
mon = join('Monitor', p)

# ------------------------------------------------------------------ BigFrame (screen 3.6 x 2.143)
SW, SH = 3.6, 2.143
p = []
bz = 0.07
p.append(box(-SW / 2 - bz, SW / 2 + bz, SH / 2, SH / 2 + bz, -0.12, 0.02, PLAST, bevel=0.01))
p.append(box(-SW / 2 - bz, SW / 2 + bz, -SH / 2 - bz * 1.6, -SH / 2, -0.12, 0.02, PLAST, bevel=0.01))
p.append(box(-SW / 2 - bz, -SW / 2, -SH / 2, SH / 2, -0.12, 0.02, PLAST, bevel=0.01))
p.append(box(SW / 2, SW / 2 + bz, -SH / 2, SH / 2, -0.12, 0.02, PLAST, bevel=0.01))
p.append(box(-SW / 2, SW / 2, -SH / 2, SH / 2, -0.16, -0.12, SHADOW))
p.append(box(-0.4, 0.4, -SH / 2 - bz * 1.6 + 0.03, -SH / 2 - bz * 1.6 + 0.04, 0.02, 0.025, ORANGE_E))  # chin LED bar
# side speaker / rack columns
for s in (-1, 1):
    x0 = s * (SW / 2 + 0.16)
    p.append(box(x0 - 0.09, x0 + 0.09, -SH / 2 - 1.1, SH / 2 + 0.1, -0.2, 0.06, PLAST, bevel=0.01))
    for i in range(9):
        y = -SH / 2 - 0.95 + i * 0.3
        p.append(box(x0 - 0.065, x0 + 0.065, y, y + 0.012, 0.06, 0.065, ORANGE_E if i % 4 == 1 else PLAST_L))
# floor console under the screen (the "one desk")
p.append(box(-SW / 2, SW / 2, -SH / 2 - 1.1, -SH / 2 - 0.2, -0.3, 0.5, LAM, bevel=0.008))
p.append(box(-SW / 2, SW / 2, -SH / 2 - 0.2, -SH / 2 - 0.18, -0.32, 0.52, LAM_EDGE))
p.append(box(-SW / 2 + 0.05, SW / 2 - 0.05, -SH / 2 - 0.25, -SH / 2 - 0.245, 0.5, 0.505, ORANGE_E))
for i in range(12):
    x = -SW / 2 + 0.25 + i * 0.28
    p.append(box(x - 0.08, x + 0.08, -SH / 2 - 0.6, -SH / 2 - 0.3, 0.5, 0.51, PLAST_L))
big = join('BigFrame', p)

# ------------------------------------------------------------------ Pedestal: body + tilted deck + stamp gantry
# Deck frame (three.js): origin at the deck's front edge centre on its surface = (0, TOP_F, 0.30),
# rotated THETA about x (front edge low, surface normal toward the viewer). Must match oge.ts.
from mathutils import Matrix
TOP_F, THETA, DZ = 0.98, 0.5, 0.30
p = []
t = math.tan(THETA)
def prism(profile, x0, x1, col):
    import bmesh
    me = bpy.data.meshes.new('prism')
    bm = bmesh.new()
    n = len(profile)
    a = [bm.verts.new(B(x0, y, z)) for (z, y) in profile]
    b = [bm.verts.new(B(x1, y, z)) for (z, y) in profile]
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('prism', me)
    bpy.context.collection.objects.link(o)
    return finish(o, col)
under = lambda z: TOP_F - 0.035 / math.cos(THETA) + (DZ - z) * t
p.append(prism([(-0.28, 0.0), (0.24, 0.0), (0.24, under(0.24)), (-0.28, under(-0.28))], -0.3, 0.3, PLAST))
p.append(box(-0.27, 0.27, 0.06, 0.08, 0.24, 0.245, ORANGE_P))
for i in range(4):
    y = 0.22 + i * 0.13
    p.append(box(-0.24, 0.24, y, y + 0.06, 0.24, 0.25, PLAST_L))
p.append(box(-0.31, 0.31, 0.0, 0.04, -0.3, 0.27, STEEL_D))
d = []
d.append(box(-0.34, 0.34, -0.035, 0.0, -0.66, 0.0, LAM, bevel=0.004))
d.append(box(-0.34, 0.34, -0.03, -0.01, 0.0, 0.006, ORANGE_E))
d.append(box(-0.33, 0.33, 0.0, 0.002, -0.06, -0.02, LAM_EDGE))
for x in (-0.3, 0.3):
    d.append(box(x - 0.02, x + 0.02, 0.0, 0.62, -0.19, -0.15, STEEL))
d.append(box(-0.32, 0.32, 0.62, 0.7, -0.22, -0.12, STEEL_D, bevel=0.006))
d.append(box(-0.07, 0.07, 0.56, 0.62, -0.21, -0.13, STEEL_D))
d.append(box(-0.28, 0.28, 0.66, 0.665, -0.121, -0.118, ORANGE_E))
deck = join('DeckTmp', d)
deck.data.transform(Matrix.Translation(B(0, TOP_F, DZ)) @ Matrix.Rotation(THETA, 4, 'X'))
p.append(deck)
ped = join('Pedestal', p)

# ------------------------------------------------------------------ Printer (bottom centre at origin)
p = []
p.append(box(-0.11, 0.11, 0.0, 0.1, -0.13, 0.08, CREAM, bevel=0.012, segs=2))
p.append(box(-0.105, 0.105, 0.1, 0.118, -0.12, 0.07, C(0.62, 0.59, 0.53, 0.25), bevel=0.006))   # lid
p.append(box(-0.062, 0.062, 0.112, 0.12, 0.074, 0.09, SHADOW))                                 # paper slot
p.append(box(-0.1, 0.1, 0.0, 0.012, -0.12, 0.075, RUBBER))
p.append(box(0.055, 0.085, 0.06, 0.075, 0.08, 0.084, ORANGE_E))                                 # status LED
p.append(box(-0.085, -0.045, 0.055, 0.075, 0.08, 0.088, PLAST_L, bevel=0.003))                   # feed button
p.append(box(-0.1, 0.1, 0.02, 0.023, 0.079, 0.081, ORANGE_P))
prn = join('Printer', p)

# ------------------------------------------------------------------ Stamp head (origin at rubber face)
p = []
p.append(box(-0.054, 0.054, 0.0, 0.008, -0.034, 0.034, C(0.5, 0.09, 0.02, 1.0)))              # inked rubber
p.append(box(-0.058, 0.058, 0.008, 0.045, -0.038, 0.038, C(0.03, 0.03, 0.032, 0.5), bevel=0.004))
p.append(box(-0.059, 0.059, 0.03, 0.036, -0.039, 0.039, ORANGE_E))
p.append(cyl(0.0, 0.045, 0.09, 0.0, 0.03, STEEL, verts=16))
p.append(cyl(0.0, 0.09, 0.78, 0.0, 0.012, C(0.16, 0.16, 0.17, 0.5), verts=12))                   # piston rod
stamp = join('Stamp', p)

# ------------------------------------------------------------------ Chair
p = []
for i in range(5):
    a = i * 2 * math.pi / 5
    x, z = math.sin(a) * 0.15, math.cos(a) * 0.15
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(x, 0.06, z))
    o = bpy.context.active_object
    o.scale = (0.03, 0.3, 0.03)
    o.rotation_euler = (0, 0, -a)
    p.append(finish(o, STEEL_D))
    p.append(cyl(x * 1.9, 0.0, 0.05, z * 1.9, 0.025, RUBBER, verts=10))
p.append(cyl(0.0, 0.06, 0.42, 0.0, 0.025, STEEL, verts=12))
p.append(box(-0.24, 0.24, 0.42, 0.49, -0.22, 0.24, FABRIC, bevel=0.03, segs=2))
p.append(box(-0.03, 0.03, 0.44, 0.62, -0.3, -0.25, STEEL_D))
p.append(box(-0.22, 0.22, 0.58, 1.0, -0.32, -0.25, FABRIC, bevel=0.03, segs=2))
for s in (-1, 1):
    p.append(box(s * 0.25 - 0.02, s * 0.25 + 0.02, 0.48, 0.66, -0.05, 0.0, STEEL_D))
    p.append(box(s * 0.25 - 0.03, s * 0.25 + 0.03, 0.66, 0.68, -0.15, 0.12, RUBBER))
chair = join('Chair', p)

mat = bpy.data.materials.new('Oge')
for o in (desk, mon, big, ped, prn, stamp, chair):
    o.data.materials.clear()
    o.data.materials.append(mat)
    print(o.name, 'tris', sum(len(q.vertices) - 2 for q in o.data.polygons))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='ACTIVE',
    export_animations=False, export_skins=False, export_materials='EXPORT', export_normals=True,
    export_texcoords=False, export_draco_mesh_compression_enable=False, export_yup=True,
)
print('WROTE', os.path.abspath(OUT))
