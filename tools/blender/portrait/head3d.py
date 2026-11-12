"""
3D head of Eren for the glitch portrait (spec-3d §5 "depth video" stand-in), built LOCALLY from face_prep.py outputs:

  blender -b -P tools/blender/portrait/head3d.py -- <fit_dir> <out_dir> [--preview] [--res 221] [--frames 68]

<fit_dir> = landmarks.json + texture.png from tools/portrait/face_prep.py (derived from the private photo: keep it
in scratch). Steps:
  1. sculpted bust (ellipsoid union + voxel remesh + smoothing): skull, ears, neck, curly hair mass (noise displaced),
     jacket + tee
  2. face fit: the MediaPipe 3D landmark surface (Delaunay in the frontal plane) is ray-projected onto the head front
     with a smooth falloff to the face oval, so the face shape is his; the head is scaled to his chin/brow height
  3. texture: frontal projection of the (background-filled, glasses-removed) photo; hair gets its own dark material
  4. glasses: thin bright metal frames (lens rims, bridge, temples) as curve geometry from the eye landmarks
  5. animation: slow head turn (±26° around a 3/4 pose) + pitch + breathing, ping-pong friendly; rendered as
     colour + depth (near = bright, 16-bit) frames at 221² for tools/blender/portrait/pack.py
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import delaunay_2d_cdt
from mathutils.interpolate import poly_3d_calc

argv = sys.argv[sys.argv.index('--') + 1:]
FIT, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
PREVIEW = '--preview' in argv
RES = int(argv[argv.index('--res') + 1]) if '--res' in argv else (512 if PREVIEW else 221)
FRAMES = int(argv[argv.index('--frames') + 1]) if '--frames' in argv else (1 if PREVIEW else 68)
ANGLES = [float(x) for x in argv[argv.index('--angles') + 1].split(',')] if '--angles' in argv else None
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ sculpt helpers
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

def sculpt(ob, voxel, smooth_iter, extra=None):
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    if extra:
        extra(ob)
    sm = ob.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.8
    sm.iterations = smooth_iter
    bake(ob)

X = lambda c, r: [((c[0], c[1], c[2]), r), ((-c[0], c[1], c[2]), r)]

# ------------------------------------------------------------------ landmarks → face patch (metres, face toward -Y)
L = json.load(open(os.path.join(FIT, 'landmarks.json')))
P = [Vector(p) for p in L['points'][:468]]  # drop the 10 iris points
NOSE = Vector((0.0, -0.112, 0.073))
n = P[1]
s = 0.140 / (P[234] - P[454]).length
def to3(p):
    return Vector(((p.x - n.x) * s, (p.z - n.z) * s, -(p.y - n.y) * s)) + NOSE
patch_pts = [to3(p) for p in P]
oval = set(L['oval'])
chin_z = patch_pts[152].z
brow_z = patch_pts[10].z

# ------------------------------------------------------------------ head (bust head scaled to his proportions)
head_parts = [
    ((0, 0.015, 0.150), (0.077, 0.097, 0.092)),   # cranium
    ((0, -0.055, 0.160), (0.062, 0.045, 0.052)),  # forehead
    ((0, -0.030, 0.085), (0.068, 0.070, 0.082)),  # face mass
    ((0, -0.025, 0.032), (0.060, 0.062, 0.044)),  # jaw
    ((0, -0.068, 0.013), (0.025, 0.021, 0.021)),  # chin
    ((0, 0.018, -0.050), (0.056, 0.056, 0.100)),  # neck
] + X((0.036, -0.054, 0.082), (0.026, 0.024, 0.028)) \
  + X((0.042, -0.004, 0.036), (0.020, 0.030, 0.026)) \
  + X((0.078, 0.008, 0.100), (0.012, 0.022, 0.030))
head = ellipsoids('Head', head_parts)
sculpt(head, 0.0025, 12)

hair_parts = [
    ((0, 0.010, 0.200), (0.088, 0.106, 0.082)),   # top volume (curly)
    ((0, -0.050, 0.212), (0.074, 0.050, 0.048)),  # front curls
    ((0, 0.072, 0.135), (0.074, 0.052, 0.090)),   # back
] + X((0.068, 0.010, 0.168), (0.028, 0.082, 0.060))
hair = ellipsoids('Hair', hair_parts)
def curls(ob):
    tex = bpy.data.textures.new('curls', 'VORONOI')
    tex.noise_scale = 0.012
    tex.distance_metric = 'DISTANCE'
    d = ob.modifiers.new('curls', 'DISPLACE')
    d.texture = tex
    d.strength = 0.010
    d.mid_level = 0.6
sculpt(hair, 0.003, 3, curls)

# scale the bust head + hair vertically so its chin/brow land on his (about the nose height)
bust_chin, bust_brow = -0.008, 0.180
kz = (NOSE.z - chin_z) / (NOSE.z - bust_chin)
for ob in (head, hair):
    for v in ob.data.vertices:
        v.co.z = NOSE.z + (v.co.z - NOSE.z) * (kz if v.co.z < NOSE.z else 1.0 + (kz - 1) * 0.5)

# ------------------------------------------------------------------ face fit: project the landmark surface onto the head
xy = [(p.x, p.z) for p in patch_pts]
cdt = delaunay_2d_cdt([Vector(q) for q in xy], [], [], 0, 1e-6)
cverts, _, cfaces, orig_verts, _, _ = cdt
vmap = [ov[0] if ov else None for ov in orig_verts]
pbm = bmesh.new()
pv = [pbm.verts.new(patch_pts[vmap[i]] if vmap[i] is not None else Vector((cverts[i].x, 0, cverts[i].y))) for i in range(len(cverts))]
pbm.verts.ensure_lookup_table()
for f in cfaces:
    try:
        pbm.faces.new([pv[i] for i in f])
    except ValueError:
        pass
pbm.faces.ensure_lookup_table()
weights = [0.0 if (vmap[i] is None or vmap[i] in oval) else 1.0 for i in range(len(cverts))]
patch_bvh = BVHTree.FromBMesh(pbm)
head_bvh = BVHTree.FromObject(head, bpy.context.evaluated_depsgraph_get())

# offset so the patch's oval sits on the head surface
offs = []
for i in oval:
    p = patch_pts[i]
    hit = head_bvh.ray_cast(Vector((p.x, -1.0, p.z)), Vector((0, 1, 0)))
    if hit[0] is not None:
        offs.append(hit[0].y - p.y)
offs.sort()
OFF = offs[len(offs) // 2] if offs else 0.0

def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

me = head.data
for v in me.vertices:
    if v.co.y > 0.03 or v.normal.y > 0.35:
        continue
    hit = patch_bvh.ray_cast(Vector((v.co.x, -1.0, v.co.z)), Vector((0, 1, 0)))
    if hit[0] is None:
        continue
    face = pbm.faces[hit[2]]
    cos = [fv.co for fv in face.verts]
    bw = poly_3d_calc(cos, hit[0])
    w = sum(weights[fv.index] * b for fv, b in zip(face.verts, bw))
    w = smooth01(w / 0.55)
    target = hit[0].y + OFF
    v.co.y = v.co.y + (target - v.co.y) * w
sm = head.modifiers.new('blend', 'SMOOTH'); sm.factor = 0.5; sm.iterations = 3
bake(head)

# ------------------------------------------------------------------ frontal-projection UVs (photo pixel space)
W, H = L['w'], L['h']
uvl = head.data.uv_layers.new(name='photo')
for loop in head.data.loops:
    co = head.data.vertices[loop.vertex_index].co
    px = co.x / s + n.x
    py = n.y - (co.z - NOSE.z) / s
    uvl.data[loop.index].uv = (px / W, 1 - py / H)

# ------------------------------------------------------------------ body: jacket + tee
body_parts = [
    ((0, 0.035, -0.250), (0.175, 0.105, 0.200)),
    ((0, 0.030, -0.095), (0.155, 0.065, 0.052)),
] + X((0.165, 0.040, -0.135), (0.072, 0.068, 0.062)) + X((0.210, 0.050, -0.300), (0.058, 0.062, 0.130)) \
  + X((0.058, -0.030, -0.085), (0.030, 0.045, 0.040))   # jacket collar
body = ellipsoids('Body', body_parts)
sculpt(body, 0.006, 30)
tee = ellipsoids('Tee', [((0, -0.030, -0.120), (0.075, 0.060, 0.060)), ((0, 0.010, -0.070), (0.062, 0.058, 0.030))])
sculpt(tee, 0.005, 10)

# ------------------------------------------------------------------ glasses (thin bright metal)
def eye_frame(ids):
    pts = [patch_pts[i] for i in ids]
    cx = sum(p.x for p in pts) / len(pts); cz = sum(p.z for p in pts) / len(pts)
    w = max(p.x for p in pts) - min(p.x for p in pts)
    y = min(p.y for p in pts) + OFF
    return cx, cz, w, y
def rim(name, cx, cz, a, b, y, npts=48, ex=3.2):
    pts = []
    for k in range(npts):
        t = 2 * math.pi * k / npts
        c, si = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / ex), c)
        z = b * math.copysign(abs(si) ** (2 / ex), si)
        pts.append((cx + x, y - 0.002 * (1 - abs(c)), cz + z))
    return pts
def curve(name, pts, cyclic, mat):
    cd = bpy.data.curves.new(name, 'CURVE')
    cd.dimensions = '3D'
    cd.bevel_depth = 0.0009
    cd.bevel_resolution = 2
    sp = cd.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1)
    sp.use_cyclic_u = cyclic
    ob = bpy.data.objects.new(name, cd)
    ob.data.materials.append(mat)
    scene.collection.objects.link(ob)
    return ob
metal = bpy.data.materials.new('Metal'); metal.use_nodes = True
mb = metal.node_tree.nodes['Principled BSDF']
mb.inputs['Base Color'].default_value = (0.80, 0.76, 0.66, 1)
mb.inputs['Roughness'].default_value = 0.35
mb.inputs['Emission Color'].default_value = (0.80, 0.76, 0.66, 1)
mb.inputs['Emission Strength'].default_value = 0.6
glasses = []
lens = []
for ids in (L['left_eye'], L['right_eye']):
    cx, cz, w, y = eye_frame(ids)
    a, b = 0.80 * w, 0.62 * w
    gy = y - 0.010
    lens.append((cx, cz + 0.08 * w, a, b, gy))
    glasses.append(curve('Rim', rim('rim', cx, cz + 0.08 * w, a, b, gy), True, metal))
(lx, lz, la, lb, ly), (rx, rz, ra, rb, ry) = sorted(lens, key=lambda q: q[0])
glasses.append(curve('Bridge', [(lx + la * 0.92, ly - 0.001, lz + lb * 0.45),
                                ((lx + rx) / 2, min(ly, ry) - 0.004, (lz + rz) / 2 + lb * 0.62),
                                (rx - ra * 0.92, ry - 0.001, rz + rb * 0.45)], False, metal))
for (cx, cz, a, b, gy), sgn in (((lx, lz, la, lb, ly), -1), ((rx, rz, ra, rb, ry), 1)):
    ox = cx + sgn * a
    glasses.append(curve('Temple', [(ox, gy, cz + b * 0.35), (ox + sgn * 0.010, gy + 0.03, cz + b * 0.45),
                                    (sgn * 0.079, 0.012, cz + b * 0.40)], False, metal))

# ------------------------------------------------------------------ rig
root = bpy.data.objects.new('Root', None); scene.collection.objects.link(root)
root.location = (0, 0, 1.5)
pivot = bpy.data.objects.new('Pivot', None); scene.collection.objects.link(pivot)
pivot.parent = root
for ob in [head, hair] + glasses:
    ob.parent = pivot
body.parent = root
tee.parent = root

# ------------------------------------------------------------------ materials
def principled(name, rgb, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m, b
skin, sb = principled('Skin', (0.6, 0.5, 0.45), 0.6)
img = bpy.data.images.load(os.path.join(FIT, 'texture.png'))
tn = skin.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img; tn.extension = 'EXTEND'
uvn = skin.node_tree.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'photo'
skin.node_tree.links.new(uvn.outputs[0], tn.inputs['Vector'])
skin.node_tree.links.new(tn.outputs['Color'], sb.inputs['Base Color'])
head.data.materials.append(skin)
hairm, hb = principled('Hair', (0.035, 0.03, 0.028), 0.6)
nz = hairm.node_tree.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 180
ramp = hairm.node_tree.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.015, 0.013, 0.012, 1); ramp.color_ramp.elements[1].color = (0.09, 0.08, 0.07, 1)
hairm.node_tree.links.new(nz.outputs['Fac'], ramp.inputs[0]); hairm.node_tree.links.new(ramp.outputs[0], hb.inputs['Base Color'])
hair.data.materials.append(hairm)
body.data.materials.append(principled('Jacket', (0.03, 0.03, 0.035), 0.8)[0])
tee.data.materials.append(principled('Tee', (0.72, 0.68, 0.60), 0.8)[0])

# ------------------------------------------------------------------ camera + lights
cam_d = bpy.data.cameras.new('Cam'); cam_d.lens = 115; cam_d.sensor_width = 36
cam = bpy.data.objects.new('Cam', cam_d); scene.collection.objects.link(cam)
cam.location = (0, -1.40, 1.56); cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
def area(name, loc, rot, energy, size):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size
    o = bpy.data.objects.new(name, d); o.location = loc
    o.rotation_euler = [math.radians(q) for q in rot]; scene.collection.objects.link(o)
area('Key', (-0.6, -1.0, 2.0), (55, 0, -30), 30, 1.4)
area('Fill', (0.8, -0.9, 1.6), (75, 0, 45), 14, 1.6)
area('Rim', (0.4, 0.9, 2.0), (-60, 0, 160), 25, 0.6)
world = bpy.data.worlds.new('W'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
scene.world = world

# depth override: emission = 1 at NEAR → 0 at FAR (view Z), rendered Raw 16-bit
NEAR, FAR = 1.27, 1.60
dm = bpy.data.materials.new('Depth'); dm.use_nodes = True
nt = dm.node_tree
for q in list(nt.nodes): nt.nodes.remove(q)
cd = nt.nodes.new('ShaderNodeCameraData'); mr = nt.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = NEAR; mr.inputs['From Max'].default_value = FAR
mr.inputs['To Min'].default_value = 1.0; mr.inputs['To Max'].default_value = 0.0; mr.clamp = True
em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(cd.outputs['View Z Depth'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], em.inputs['Color'])
nt.links.new(em.outputs[0], out.inputs['Surface'])

r = scene.render
r.engine = 'CYCLES'; scene.cycles.device = 'CPU'
r.resolution_x = r.resolution_y = RES; r.resolution_percentage = 100
r.film_transparent = False
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGB'

YAW0, YAW_AMP = 12.0, 26.0
def pose(yaw_deg, t):
    pivot.rotation_euler = (math.radians(-2 + 3 * math.sin(math.pi * t)), 0, math.radians(yaw_deg))
    root.rotation_euler = (0, 0, math.radians(10 + 0.25 * (yaw_deg - YAW0)))
    sc = 1 + 0.010 * math.sin(math.pi * t)
    body.scale = (1 + 0.004 * math.sin(math.pi * t), 1, sc)
    scene.frame_set(1); bpy.context.view_layer.update()

vl = bpy.context.view_layer
jobs = []
if ANGLES:
    jobs = [(a_, 0.5) for a_ in ANGLES]
else:
    for i in range(FRAMES):
        t = i / max(FRAMES - 1, 1)
        e = 0.5 - 0.5 * math.cos(math.pi * t)
        jobs.append((YAW0 - YAW_AMP + 2 * YAW_AMP * e, t))
for i, (yaw, t) in enumerate(jobs):
    pose(yaw, t)
    vl.material_override = None
    scene.cycles.samples = 40; scene.cycles.use_denoising = False; scene.cycles.filter_width = 1.5
    scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
    r.image_settings.color_depth = '8'
    r.filepath = os.path.join(OUT, f'color_{i:03d}.png'); bpy.ops.render.render(write_still=True)
    vl.material_override = dm
    scene.cycles.samples = 1; scene.cycles.filter_width = 0.01; scene.cycles.seed = 0
    scene.view_settings.view_transform = 'Raw'
    r.image_settings.color_depth = '16'
    r.filepath = os.path.join(OUT, f'depth_{i:03d}.png'); bpy.ops.render.render(write_still=True)
    print('frame', i, 'yaw', round(yaw, 1))
