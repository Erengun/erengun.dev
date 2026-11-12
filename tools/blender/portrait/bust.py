"""
Glitch-portrait source asset: an original stylised bust sculpted from ellipsoid primitives
(voxel remesh union + boolean eye sockets + smoothing), animated with a slow
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
head_parts = [
    ((0, 0.010, 0.150), (0.078, 0.098, 0.095)),   # cranium
    ((0, -0.025, 0.075), (0.062, 0.070, 0.080)),  # face mass
    ((0, -0.030, 0.035), (0.058, 0.060, 0.045)),  # jaw
    ((0, -0.068, 0.012), (0.026, 0.022, 0.022)),  # chin
    ((0, -0.078, 0.128), (0.058, 0.020, 0.016)),  # brow ridge
    ((0, -0.090, 0.100), (0.011, 0.016, 0.030)),  # nose bridge
    ((0, -0.104, 0.072), (0.016, 0.017, 0.015)),  # nose tip
    ((0, -0.089, 0.046), (0.022, 0.012, 0.008)),  # upper lip
    ((0, -0.085, 0.031), (0.020, 0.012, 0.008)),  # lower lip
    ((0, 0.012, -0.050), (0.056, 0.056, 0.100)),  # neck
    ((0, -0.035, 0.205), (0.070, 0.060, 0.040)),  # hair quiff
    ((0, 0.015, 0.200), (0.085, 0.100, 0.070)),   # hair top
] + X((0.045, -0.055, 0.090), (0.026, 0.025, 0.022)) \
  + X((0.013, -0.093, 0.067), (0.010, 0.012, 0.009)) \
  + X((0.079, 0.005, 0.100), (0.012, 0.022, 0.032)) \
  + X((0.060, 0.000, 0.170), (0.030, 0.080, 0.060))
head = ellipsoids('Head', head_parts)
cut = ellipsoids('Sockets', X((0.033, -0.095, 0.108), (0.020, 0.018, 0.017)))
sculpt(head, 0.0035, 6, cut)
bpy.data.objects.remove(cut)
eyes = ellipsoids('Eyes', X((0.033, -0.071, 0.106), (0.015, 0.015, 0.015)))
eyes.data.shade_smooth()

body_parts = [
    ((0, 0.035, -0.240), (0.175, 0.100, 0.200)),  # chest
    ((0, 0.035, -0.090), (0.160, 0.065, 0.050)),  # trapezius
    ((0, -0.005, -0.075), (0.072, 0.058, 0.028)), # collar
] + X((0.170, 0.040, -0.130), (0.065, 0.065, 0.060)) + X((0.215, 0.050, -0.290), (0.055, 0.060, 0.130))
body = ellipsoids('Body', body_parts)
sculpt(body, 0.006, 30)

pivot = bpy.data.objects.new('Pivot', None)
scene.collection.objects.link(pivot)
pivot.location = (0, 0, 1.5)
head.parent = pivot
eyes.parent = pivot
body.location = (0, 0, 1.5)

# ---------------------------------------------------------------- materials
def mat_skin():
    m = bpy.data.materials.new('Skin')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.55
    # hair mask from object coords: above the hairline or behind the ears
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    # hairline z threshold drops toward the back: h = z + 0.9*y
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 0.9
    nt.links.new(sep.outputs['Y'], mul.inputs[0])
    ax = nt.nodes.new('ShaderNodeMath'); ax.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs['X'], ax.inputs[0])
    axm = nt.nodes.new('ShaderNodeMath'); axm.operation = 'MULTIPLY_ADD'
    axm.inputs[1].default_value = 0.3
    nt.links.new(ax.outputs[0], axm.inputs[0]); nt.links.new(mul.outputs[0], axm.inputs[2])
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
    nt.links.new(sep.outputs['Z'], add.inputs[0]); nt.links.new(axm.outputs[0], add.inputs[1])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.110
    ramp.color_ramp.elements[0].color = (0.62, 0.47, 0.40, 1)   # skin
    ramp.color_ramp.elements[1].position = 0.122
    ramp.color_ramp.elements[1].color = (0.05, 0.045, 0.04, 1)  # hair
    nt.links.new(add.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bsdf.inputs['Base Color'])
    return m

def mat_flat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m

head.data.materials.append(mat_skin())
eyes.data.materials.append(mat_flat('Eye', (0.12, 0.12, 0.12), 0.35))
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

area('Key', (-0.7, -0.9, 2.2), (50, 0, -35), 22, 0.8)
area('Fill', (0.9, -0.8, 1.6), (75, 0, 50), 5, 1.0)
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
    pivot.rotation_euler = (math.radians(-2.5 + 5.0 * math.sin(math.pi * t) ** 2 * 0.6),
                            0,
                            math.radians(-11 + 22 * e))
    s = 1 + 0.014 * math.sin(math.pi * t)
    body.scale = (1 + 0.006 * math.sin(math.pi * t), 1, s)
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
