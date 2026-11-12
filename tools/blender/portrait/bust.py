"""
Glitch-portrait source asset: an original generic bust sculpted from ellipsoid primitives
(voxel remesh union + smoothing), posed in a 3/4 view, animated with a slow
head turn + breathing, rendered as colour + normalized depth (near = bright) frames.

  blender -b -P tools/blender/portrait/bust.py -- <out_dir> [--preview] [--res 151] [--frames 54]

Writes <out_dir>/color_XXX.png and <out_dir>/depth_XXX.png (16-bit, linear). pack.py turns them into
the runtime atlases in public/portrait/.
"""
import bpy, sys, math, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'frames')
PREVIEW = '--preview' in argv
RES = int(argv[argv.index('--res') + 1]) if '--res' in argv else (512 if PREVIEW else 151)
FRAMES = int(argv[argv.index('--frames') + 1]) if '--frames' in argv else (1 if PREVIEW else 54)
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- sculpt-like modelling
# Each part is an ellipsoid (centre, radii). Parts are unioned with a voxel remesh, eye sockets carved with a
# boolean, then smoothed: the result reads as one sculpted surface.
import bmesh
from mathutils import Matrix

def ellipsoids(name, parts, segs=32):
    bm = bmesh.new()
    for c, r in parts:
        m = Matrix.Translation(c) @ Matrix.Diagonal((r[0], r[1], r[2], 1))
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1, matrix=m)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob

def bake(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    me.materials.clear()
    me.shade_smooth()

def sculpt(ob, voxel, smooth_iter, cutters=None):
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    if cutters:
        bo = ob.modifiers.new('carve', 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        bo.operand_type = 'OBJECT'
        bo.object = cutters
        bo.solver = 'EXACT'
        rm2 = ob.modifiers.new('remesh2', 'REMESH')
        rm2.mode = 'VOXEL'
        rm2.voxel_size = voxel
    sm = ob.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.8
    sm.iterations = smooth_iter
    bake(ob)

X = lambda c, r: [((c[0], c[1], c[2]), r), ((-c[0], c[1], c[2]), r)]
# Coordinates: metres, camera looks along +Y, face points to -Y. Head local origin = neck pivot.
# A generic adult head: fuller face/cheeks, shallow eye areas with closed lids (no carved sockets).
head_parts = [
    ((0, 0.015, 0.150), (0.077, 0.097, 0.092)),   # cranium
    ((0, -0.055, 0.160), (0.062, 0.045, 0.052)),  # forehead
    ((0, -0.030, 0.085), (0.066, 0.068, 0.080)),  # face mass
    ((0, -0.025, 0.032), (0.060, 0.062, 0.044)),  # jaw
    ((0, -0.068, 0.013), (0.025, 0.021, 0.021)),  # chin
    ((0, -0.079, 0.127), (0.055, 0.017, 0.013)),  # brow ridge (soft)
    ((0, -0.087, 0.100), (0.010, 0.014, 0.028)),  # nose bridge
    ((0, -0.099, 0.073), (0.014, 0.015, 0.013)),  # nose tip
    ((0, -0.087, 0.046), (0.021, 0.010, 0.007)),  # upper lip
    ((0, -0.084, 0.033), (0.019, 0.011, 0.007)),  # lower lip
    ((0, 0.018, -0.050), (0.056, 0.056, 0.100)),  # neck
] + X((0.042, -0.050, 0.075), (0.032, 0.032, 0.035)) \
  + X((0.048, -0.008, 0.032), (0.022, 0.032, 0.030)) \
  + X((0.012, -0.089, 0.069), (0.009, 0.010, 0.008)) \
  + X((0.032, -0.074, 0.107), (0.017, 0.012, 0.010)) \
  + X((0.078, 0.008, 0.100), (0.012, 0.022, 0.030))
head = ellipsoids('Head', head_parts)
sculpt(head, 0.003, 10)

hair_parts = [
    ((0, 0.012, 0.192), (0.084, 0.104, 0.074)),   # top
    ((0, -0.040, 0.200), (0.066, 0.050, 0.036)),  # front quiff
    ((0, 0.070, 0.130), (0.072, 0.050, 0.085)),   # back
] + X((0.066, 0.012, 0.160), (0.024, 0.080, 0.058))
hair = ellipsoids('Hair', hair_parts)
sculpt(hair, 0.004, 14)

body_parts = [
    ((0, 0.035, -0.240), (0.170, 0.100, 0.200)),  # chest
    ((0, 0.030, -0.085), (0.150, 0.060, 0.050)),  # trapezius
    ((0, 0.000, -0.078), (0.072, 0.062, 0.026)),  # collar
] + X((0.160, 0.040, -0.125), (0.070, 0.065, 0.060)) + X((0.205, 0.050, -0.290), (0.055, 0.060, 0.130))
body = ellipsoids('Body', body_parts)
sculpt(body, 0.006, 40)

# rig: Root (3/4 yaw of the whole bust) -> Pivot (neck: subtle turn/nod) -> head + hair
root = bpy.data.objects.new('Root', None)
scene.collection.objects.link(root)
root.location = (0, 0, 1.5)
root.rotation_euler = (0, 0, math.radians(-24))
pivot = bpy.data.objects.new('Pivot', None)
scene.collection.objects.link(pivot)
pivot.parent = root
head.parent = pivot
hair.parent = pivot
body.parent = root

# ---------------------------------------------------------------- materials
def mat_flat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m

head.data.materials.append(mat_flat('Skin', (0.55, 0.43, 0.37), 0.6))
hair.data.materials.append(mat_flat('Hair', (0.06, 0.05, 0.045), 0.7))
body.data.materials.append(mat_flat('Shirt', (0.16, 0.17, 0.19)))

# ---------------------------------------------------------------- camera + lights
cam_d = bpy.data.cameras.new('Cam')
cam_d.lens = 135
cam_d.sensor_width = 36
cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam)
CAM_DIST = 1.40
cam.location = (0, -CAM_DIST, 1.595)
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam

def area(name, loc, rot, energy, size):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    scene.collection.objects.link(o)

area('Key', (-0.7, -0.9, 2.2), (50, 0, -35), 18, 1.2)
area('Fill', (0.9, -0.8, 1.6), (75, 0, 50), 8, 1.4)
area('Rim', (0.4, 0.9, 2.0), (-60, 0, 160), 30, 0.5)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
scene.world = world

# ---------------------------------------------------------------- depth override material
# emission = 1 at NEAR, 0 at FAR (linear in view Z) -> rendered with the Raw view transform
NEAR, FAR = 1.27, 1.55
dm = bpy.data.materials.new('Depth')
dm.use_nodes = True
nt = dm.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
cd = nt.nodes.new('ShaderNodeCameraData')
mr = nt.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = NEAR
mr.inputs['From Max'].default_value = FAR
mr.inputs['To Min'].default_value = 1.0
mr.inputs['To Max'].default_value = 0.0
mr.clamp = True
em = nt.nodes.new('ShaderNodeEmission')
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(cd.outputs['View Z Depth'], mr.inputs['Value'])
nt.links.new(mr.outputs['Result'], em.inputs['Color'])
nt.links.new(em.outputs[0], out.inputs['Surface'])

# ---------------------------------------------------------------- render settings
r = scene.render
r.engine = 'CYCLES'
scene.cycles.device = 'CPU'
r.resolution_x = r.resolution_y = RES
r.resolution_percentage = 100
r.film_transparent = False
r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGB'

def animate(i):
    t = i / max(FRAMES - 1, 1)
    e = 0.5 - 0.5 * math.cos(math.pi * t)             # zero velocity at both ends (ping-pong friendly)
    pivot.rotation_euler = (math.radians(-1.5 + 2.5 * math.sin(math.pi * t)), 0, math.radians(-4 + 8 * e))
    s = 1 + 0.012 * math.sin(math.pi * t)
    body.scale = (1 + 0.005 * math.sin(math.pi * t), 1, s)
    scene.frame_set(1)
    bpy.context.view_layer.update()

vl = bpy.context.view_layer
for i in range(FRAMES):
    animate(i)
    # colour
    vl.material_override = None
    scene.cycles.samples = 48 if not PREVIEW else 64
    scene.cycles.use_denoising = False
    scene.cycles.filter_width = 1.5
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    r.image_settings.color_depth = '8'
    r.filepath = os.path.join(OUT, f'color_{i:03d}.png')
    bpy.ops.render.render(write_still=True)
    # depth: one centred sample per pixel, no filtering (no blended silhouettes)
    vl.material_override = dm
    scene.cycles.samples = 1
    scene.cycles.filter_width = 0.01
    scene.cycles.seed = 0
    scene.view_settings.view_transform = 'Raw'
    r.image_settings.color_depth = '16'
    r.filepath = os.path.join(OUT, f'depth_{i:03d}.png')
    bpy.ops.render.render(write_still=True)
    print('frame', i, 'done')
