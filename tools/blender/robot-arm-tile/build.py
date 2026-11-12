# Robot-arm corridor tile (original asset).
# Run: /opt/homebrew/bin/blender -b -P tools/blender/robot-arm-tile/build.py
# Output: public/models/robot-arm-tile.glb
#
# One corridor tile = the LEFT half of the aisle for one pair slot (z in [-.28, .28], three.js coords,
# x < 0, floor at y = 0). The runtime mirrors it (x -> -x) for the right side and instances it along -z.
#   * "Static"  mesh: floor, track bed, rails, chip pads, bench, knobs, PCB, pedestal, floor cables.
#   * "Arm"     skinned mesh, every vertex weighted 100 % to ONE bone (rigid skinning).
#   * Armature "ArmRig": Root > Base > Shoulder > Elbow > Wrist, clip "Arm_Dip_Rig" (73 frames @ 24 fps).
# Vertex colour "Col" (linear RGBA): rgb = albedo, a = material class
#   1.0 plastic, .6 glossy metal/black, .3 rough/matte, 0.0 emissive.
import bpy, math, os
from mathutils import Vector, Quaternion

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../public/models/robot-arm-tile.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = 72


OFFX = 0.0  # x shift applied to the arm row (pedestal, arm, bones)


def B(x, y, z):
    """three.js (y-up) -> blender (z-up); the glTF exporter converts back."""
    return Vector((x + OFFX, -z, y))


def finish(obj, color, bevel=0.0, segs=3, smooth=True):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        m = obj.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    me = obj.data
    a = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for d in a.data:
        d.color = color
    me.color_attributes.active_color = a
    me.color_attributes.render_color_index = 0
    obj.select_set(False)
    return obj


def box(c, s, color, bevel=0.0, rz=0.0, rx=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(*c))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])
    # three z-rotation = blender rotation about -Y; three x-rotation = blender X
    o.rotation_euler = (rx, -rz, 0)
    return finish(o, color, bevel)


def cyl(c, r, h, axis, color, bevel=0.0, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=B(*c))
    o = bpy.context.active_object
    if axis == 'z':  # three z == blender -Y
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == 'x':
        o.rotation_euler = (0, math.pi / 2, 0)
    elif isinstance(axis, float):  # in the xy plane (three), angle from +y towards -x (three z-rotation)
        o.rotation_euler = (0, -axis, 0)
    return finish(o, color, bevel)


def cable(pts, r, color):
    cu = bpy.data.curves.new('cable', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    cu.resolution_u = 8
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = B(*p)
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('cable', cu)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.select_set(False)
    return finish(o, color, 0.0)


# ------------------------------------------------------------------ palette (linear)
WHITE = (0.80, 0.82, 0.85, 1.0)
GREY = (0.35, 0.36, 0.38, 1.0)
DARK = (0.006, 0.0065, 0.007, 0.3)
DARK2 = (0.01, 0.0105, 0.012, 0.3)
BLACK = (0.006, 0.006, 0.007, 0.6)
METAL = (0.6, 0.62, 0.65, 0.6)
GREEN = (0.012, 0.16, 0.045, 0.6)
PADG = (0.015, 0.2, 0.04, 0.05)  # static emissive
RED = (0.65, 0.04, 0.02, 1.0)
BLUE = (0.03, 0.22, 0.80, 1.0)
YELLOW = (0.80, 0.55, 0.04, 1.0)
ORANGE = (0.85, 0.22, 0.02, 1.0)
LED = (0.6, 1.0, 0.7, 0.0)

L = 0.56  # tile length along z (pair step)
static = []
# floor + centre track
static.append(box((-0.95, -0.03, 0), (1.9, 0.06, L), DARK))
static.append(box((-0.12, 0.012, 0), (0.24, 0.024, L), DARK2))
static.append(box((-0.006, 0.03, 0), (0.012, 0.02, L), BLACK))
static.append(box((-0.175, 0.04, 0), (0.026, 0.035, L), METAL, 0.004))  # rail
static.append(box((-0.215, 0.03, 0), (0.012, 0.012, L), DARK2))
for z in (-0.14, 0.14):
    static.append(box((-0.08, 0.028, z), (0.075, 0.01, 0.055), (0.25, 0.26, 0.25, 0.6), 0.002))
    static.append(box((-0.08, 0.034, z), (0.05, 0.004, 0.034), PADG))
    static.append(box((-0.08, 0.0365, z), (0.022, 0.002, 0.014), (0.02, 0.03, 0.02, 0.6)))
# bench
static.append(box((-0.52, 0.08, 0), (0.56, 0.16, L), DARK2, 0.006))
static.append(box((-0.52, 0.163, 0), (0.54, 0.006, L * 0.98), (0.014, 0.015, 0.017, 0.3)))
for x in (-0.31, -0.69):
    for z in (-0.15, 0.13):
        static.append(cyl((x, 0.21, z), 0.03, 0.09, 'y', BLACK, 0.008))
        static.append(cyl((x, 0.256, z), 0.026, 0.004, 'y', (0.4, 0.4, 0.42, 0.6)))
for z in (-0.02, 0.24):
    static.append(cyl((-0.5, 0.18, z), 0.022, 0.04, 'y', BLACK, 0.006))
# PCB on a stand
static.append(box((-0.4, 0.2, -0.13), (0.05, 0.06, 0.05), BLACK, 0.004))
static.append(box((-0.4, 0.235, -0.13), (0.19, 0.009, 0.15), GREEN, 0.002, rx=0.12))
static.append(box((-0.43, 0.244, -0.12), (0.035, 0.008, 0.03), BLACK, rx=0.12))
static.append(box((-0.37, 0.244, -0.15), (0.025, 0.008, 0.02), BLACK, rx=0.12))
static.append(box((-0.34, 0.246, -0.08), (0.03, 0.014, 0.025), (0.75, 0.75, 0.72, 1.0), rx=0.12))
static.append(box((-0.46, 0.243, -0.18), (0.02, 0.006, 0.02), (0.6, 0.45, 0.1, 0.6), rx=0.12))
# pedestal + controller (arm row sits a bit further out)
OFFX = -0.12
static.append(box((-0.95, 0.25, 0), (0.2, 0.5, 0.2), BLACK, 0.01))
static.append(box((-0.95, 0.5, 0), (0.24, 0.02, 0.24), DARK2, 0.004))
static.append(box((-0.83, 0.33, 0.17), (0.07, 0.24, 0.1), (0.09, 0.09, 0.1, 0.6), 0.006))
static.append(box((-0.794, 0.38, 0.17), (0.004, 0.05, 0.06), (0.8, 0.8, 0.78, 1.0)))
static.append(box((-0.793, 0.34, 0.17), (0.004, 0.012, 0.06), ORANGE))
# back wall
static.append(box((-1.35, 0.15, 0), (0.1, 0.3, L), DARK))
# floor cables running along the corridor
for i, col in enumerate((RED, YELLOW, ORANGE, BLUE)):
    static.append(cyl((-0.76 - i * 0.018, 0.175, 0), 0.0065, L, 'z', col, verts=8))
for i, col in enumerate((RED, YELLOW)):
    static.append(cyl((-0.25 - i * 0.016, 0.01, 0), 0.006, L, 'z', col, verts=8))

# ------------------------------------------------------------------ arm parts, per bone
parts = {'Base': [], 'Shoulder': [], 'Elbow': [], 'Wrist': []}
P = {'base': (-0.95, 0.51, 0), 'sh': (-0.95, 0.78, 0), 'el': (-0.47, 0.86, 0), 'wr': (-0.33, 0.48, 0), 'tip': (-0.31, 0.36, 0)}
parts['Base'] += [
    cyl((-0.95, 0.56, 0), 0.115, 0.1, 'y', WHITE, 0.02),
    cyl((-0.95, 0.515, 0), 0.12, 0.012, 'y', GREY, 0.003),
    cyl((-0.95, 0.66, 0), 0.09, 0.1, 'y', WHITE, 0.02),
    cyl(P['sh'], 0.165, 0.32, 'z', WHITE, 0.05),
]
for zs in (-1, 1):
    parts['Base'].append(cyl((-0.95, 0.78, zs * 0.162), 0.11, 0.01, 'z', (0.62, 0.64, 0.67, 1.0), 0.003))
    parts['Base'].append(cyl((-0.95, 0.78, zs * 0.166), 0.025, 0.006, 'z', GREY, 0.002))
ang = math.atan2(0.08, 0.48)
parts['Shoulder'] += [
    box((-0.71, 0.82, 0), (0.48, 0.19, 0.23), WHITE, 0.065, rz=ang),
    cyl(P['el'], 0.125, 0.26, 'z', WHITE, 0.045),
]
for zs in (-1, 1):
    parts['Shoulder'].append(cyl((-0.47, 0.86, zs * 0.131), 0.075, 0.008, 'z', (0.62, 0.64, 0.67, 1.0), 0.002))
# hanging cable loops on the upper arm (+ black connectors)
for i, (col, zz) in enumerate(((RED, 0.135), (BLUE, 0.148), (YELLOW, 0.161))):
    for zs in (-1, 1):
        if zs < 0 and col is YELLOW:
            continue
        z = zs * zz
        x0, x1 = -0.84 + i * 0.03, -0.6 + i * 0.025
        sag = 0.3 - i * 0.05
        parts['Shoulder'].append(cable([(x0, 0.77, z), (x0 + 0.03, 0.62, z * 1.05), ((x0 + x1) / 2, sag, z * 1.12),
                                        (x1 - 0.02, 0.62, z * 1.05), (x1, 0.8, z)], 0.0085, col))
        parts['Shoulder'].append(cyl((x0, 0.775, z), 0.016, 0.03, 'y', BLACK, 0.004, 12))
        parts['Shoulder'].append(cyl((x1, 0.805, z), 0.016, 0.03, 'y', BLACK, 0.004, 12))
fa = math.atan2(0.14, 0.38)
parts['Elbow'] += [
    box((-0.40, 0.67, 0), (0.15, 0.36, 0.17), WHITE, 0.05, rz=fa),
    cyl((-0.335, 0.5, 0), 0.06, 0.07, fa, (0.7, 0.72, 0.75, 1.0), 0.015),
]
for col, z in ((BLUE, 0.095), (RED, -0.095), (YELLOW, 0.105)):
    parts['Elbow'].append(cable([(-0.47, 0.8, z), (-0.43, 0.66, z * 1.15), (-0.37, 0.52, z * 0.9)], 0.007, col))
parts['Wrist'] += [
    cyl((-0.322, 0.445, 0), 0.05, 0.06, fa, GREY, 0.01),
    cyl((-0.312, 0.395, 0), 0.032, 0.06, fa, BLACK, 0.006),
    box((-0.305, 0.36, 0), (0.025, 0.018, 0.025), LED),
]

# ------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new('ArmRig')
rig = bpy.data.objects.new('ArmRig', arm_data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, h, t, parent=None):
    b = eb.new(name)
    b.head = B(*h)
    b.tail = B(*t)
    b.roll = 0
    if parent:
        b.parent = eb[parent]
    return b
bone('Root', (-0.95, 0.3, 0), (-0.95, 0.5, 0))
bone('Base', P['base'], (-0.95, 0.72, 0), 'Root')
bone('Shoulder', P['sh'], P['el'], 'Base')
bone('Elbow', P['el'], P['wr'], 'Shoulder')
bone('Wrist', P['wr'], P['tip'], 'Elbow')
bpy.ops.object.mode_set(mode='OBJECT')

# join arm parts, one vertex group per bone (weight 1)
for bname, objs in parts.items():
    for o in objs:
        vg = o.vertex_groups.new(name=bname)
        vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o
arm = join([o for v in parts.values() for o in v], 'Arm')
stat = join(static, 'Static')
mat = bpy.data.materials.new('Tile')
for o in (arm, stat):
    o.data.materials.clear()
    o.data.materials.append(mat)
arm.parent = rig
mod = arm.modifiers.new('rig', 'ARMATURE')
mod.object = rig

# ------------------------------------------------------------------ animation: Arm_Dip_Rig
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
Z3 = Vector((0, -1, 0))  # three.js +z axis in blender coords
Y3 = Vector((0, 0, 1))   # three.js +y axis

def smooth(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def key(pbname, axis, angle, f):
    pb = rig.pose.bones[pbname]
    pb.rotation_mode = 'QUATERNION'
    R = pb.bone.matrix_local.to_3x3()
    pb.rotation_quaternion = Quaternion((R.inverted() @ axis).normalized(), angle)
    pb.keyframe_insert('rotation_quaternion', frame=f)

for f in range(0, 73, 2):
    # rest (0-8) -> dip (8-30) -> hold/press (30-50) -> rise (50-66) -> rest
    dip = smooth(8, 30, f) * (1 - smooth(50, 66, f))
    press = math.sin(math.pi * smooth(30, 50, f)) * 0.25
    yaw = math.sin(2 * math.pi * f / 72) * 0.12
    key('Base', Y3, yaw, f)
    key('Shoulder', Z3, -(dip * 0.36 + press * 0.1), f)
    key('Elbow', Z3, dip * 0.30, f)
    key('Wrist', Z3, -dip * 0.35 + press * 0.4, f)
bpy.ops.object.mode_set(mode='OBJECT')
act = rig.animation_data.action
act.name = 'Arm_Dip_Rig'

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_apply=False,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_animations=True, export_animation_mode='ACTIONS', export_skins=True,
    export_force_sampling=True, export_optimize_animation_size=False,
    export_materials='EXPORT', export_draco_mesh_compression_enable=False,
    export_yup=True,
)
print('WROTE', os.path.abspath(OUT))
