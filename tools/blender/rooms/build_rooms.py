"""
Room tiles seen behind the project slides (spec-3d §6.2 "mirror space").

Usage:
  blender -b --factory-startup -P tools/blender/rooms/build_rooms.py -- gallery  public/models/gallery-tile.glb
  blender -b --factory-startup -P tools/blender/rooms/build_rooms.py -- studio   public/models/studio-corridor.glb

Each room is one tile of a corridor (open at both ends along the depth axis), so the runtime can repeat
it with alternate mirroring. Lighting (Cycles) is baked into a vertex colour attribute; the runtime material
is unlit. Blender axes: X across, Y along the corridor (tile spans y = 0..-D), Z up, floor at z = 0.
"""
import bpy, bmesh, sys, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['gallery', '/tmp/gallery.glb']
KIND, OUT = argv[0], argv[1]
random.seed(7)

# ------------------------------------------------------------------ helpers
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

MATS = {}


def mat(name, rgb, emit=0.0, rough=0.6):
    key = (name, rgb, emit)
    if key in MATS:
        return MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if emit > 0:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    MATS[key] = m
    return m


def box(name, cx, cy, cz, sx, sy, sz, m, cuts=None):
    """axis-aligned box centred at (cx,cy,cz) with full size (sx,sy,sz). cuts: subdivision density per unit."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
    if cuts:
        # subdivide long faces so the vertex-colour bake has resolution
        n = max(1, int(max(sx, sy, sz) * cuts))
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=min(n, 24), use_grid_fill=True)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(m)
    bpy.context.collection.objects.link(ob)
    return ob


def grid(name, w, h, res, m, loc, rot):
    """subdivided plane w×h with ~res cells per unit"""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=max(2, int(w * res)), y_subdivisions=max(2, int(h * res)), size=1)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (w, h, 1)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.data.materials.append(m)
    return ob


def cyl(name, x, y, z0, z1, r, m, seg=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=z1 - z0, location=(x, y, (z0 + z1) / 2))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(m)
    return ob


def area_light(x, y, z, sx, sy, power, color=(1, 1, 1)):
    d = bpy.data.lights.new('L', 'AREA')
    d.shape = 'RECTANGLE'
    d.size, d.size_y = sx, sy
    d.energy = power
    d.color = color
    o = bpy.data.objects.new('L', d)
    o.location = (x, y, z)
    bpy.context.collection.objects.link(o)
    return o


W, H, D = 10.0, 4.6, 6.0   # tile size (runtime rescales to portal width × 5)
RES = 7                    # bake vertices per unit on big surfaces

# ------------------------------------------------------------------ rooms
def build_gallery():
    wall = mat('wall', (0.8, 0.79, 0.76))
    floor = mat('floor', (0.22, 0.21, 0.2), rough=0.35)
    ceil = mat('ceil', (0.8, 0.8, 0.8))
    base = mat('base', (0.12, 0.12, 0.12))
    frame = mat('frame', (0.03, 0.03, 0.03))
    lamp = mat('lamp', (1, 0.97, 0.92), emit=6)
    wood = mat('wood', (0.45, 0.33, 0.22))
    metal = mat('metal', (0.1, 0.1, 0.1))
    plinth = mat('plinth', (0.9, 0.9, 0.9))
    arts = [mat('artA', (0.75, 0.18, 0.08)), mat('artB', (0.08, 0.2, 0.55)), mat('artC', (0.9, 0.75, 0.2)),
            mat('artD', (0.12, 0.35, 0.22)), mat('artE', (0.92, 0.9, 0.86))]

    grid('floor', W, D, RES, floor, (0, -D / 2, 0), (0, 0, 0))
    grid('ceil', W, D, 4, ceil, (0, -D / 2, H), (math.pi, 0, 0))
    grid('wallL', D, H, RES, wall, (-W / 2, -D / 2, H / 2), (math.pi / 2, 0, math.pi / 2))
    grid('wallR', D, H, RES, wall, (W / 2, -D / 2, H / 2), (math.pi / 2, 0, -math.pi / 2))
    # skirting
    box('skL', -W / 2 + 0.02, -D / 2, 0.06, 0.04, D, 0.12, base, cuts=3)
    box('skR', W / 2 - 0.02, -D / 2, 0.06, 0.04, D, 0.12, base, cuts=3)
    # ceiling light slots along the corridor (+ recessed housing)
    for x in (-2.6, 2.6):
        box('slot', x, -D / 2, H - 0.03, 0.35, D, 0.05, lamp, cuts=2)
    # cross beams at tile ends (mirroring makes them pair up)
    box('beam', 0, -0.15, H - 0.2, W, 0.3, 0.4, ceil, cuts=3)

    # artworks: left wall one big piece, right wall two smaller
    def art(xwall, side, y, z, w, h, am, kind):
        inset = side * 0.06
        box('frame', xwall - side * 0.03, y, z, 0.06, w + 0.12, h + 0.12, frame, cuts=3)
        c = box('canvas', xwall - side * 0.065, y, z, 0.01, w, h, am, cuts=6)
        # simple composition: a few colour blocks on the canvas
        if kind == 'blocks':
            for k in range(3):
                bw, bh = w * random.uniform(0.2, 0.45), h * random.uniform(0.2, 0.5)
                by = y + random.uniform(-w / 2 + bw / 2, w / 2 - bw / 2)
                bz = z + random.uniform(-h / 2 + bh / 2, h / 2 - bh / 2)
                box('blk', xwall - side * 0.072, by, bz, 0.005, bw, bh, arts[(k + 2) % len(arts)], cuts=4)
        elif kind == 'circle':
            bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=min(w, h) * 0.32, depth=0.01,
                                                location=(xwall - side * 0.075, y, z), rotation=(0, math.pi / 2, 0))
            ob = bpy.context.active_object
            ob.data.materials.append(arts[4])
        # picture light above
        box('plight', xwall - side * 0.25, y, z + h / 2 + 0.35, 0.4, 0.5, 0.06, metal, cuts=2)
        area_light(xwall - side * 0.6, y, z + h / 2 + 0.5, 0.6, w * 0.8, 120, (1, 0.93, 0.85))

    art(-W / 2, -1, -D / 2, 1.85, 2.6, 1.8, arts[1], 'blocks')
    art(W / 2, 1, -D * 0.28, 1.7, 1.2, 1.5, arts[0], 'circle')
    art(W / 2, 1, -D * 0.72, 1.7, 1.2, 1.5, arts[2], 'blocks')

    # benches
    for x in (-2.0, 2.0):
        y = -D / 2
        box('benchTop', x, y, 0.46, 0.6, 2.2, 0.08, wood, cuts=5)
        for yy in (y - 0.9, y + 0.9):
            box('benchLeg', x, yy, 0.21, 0.5, 0.06, 0.42, metal, cuts=3)
    # plinth with a sculpture
    box('plinth', 3.4, -D * 0.5, 0.55, 0.7, 0.7, 1.1, plinth, cuts=6)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.08, location=(3.4, -D * 0.5, 1.45),
                                     rotation=(0.6, 0.3, 0))
    bpy.context.active_object.data.materials.append(mat('bronze', (0.55, 0.38, 0.2), rough=0.3))

    # main light from the ceiling slots
    for x in (-2.6, 2.6):
        area_light(x, -D / 2, H - 0.1, 0.4, D, 900, (1, 0.97, 0.92))
    bpy.context.scene.world.color = (0.12, 0.12, 0.125)


def build_studio():
    conc = mat('conc', (0.05, 0.05, 0.055))
    floor = mat('floor', (0.035, 0.035, 0.04), rough=0.25)
    ceil = mat('ceil', (0.02, 0.02, 0.02))
    rib = mat('rib', (0.08, 0.08, 0.085))
    led = mat('led', (0.9, 0.95, 1.0), emit=12)
    tape = mat('tape', (0.7, 0.7, 0.65))
    case = mat('case', (0.03, 0.03, 0.03))
    alu = mat('alu', (0.5, 0.5, 0.52), rough=0.3)
    soft = mat('soft', (1, 0.96, 0.9), emit=8)
    back = mat('backdrop', (0.55, 0.55, 0.55))

    grid('floor', W, D, RES, floor, (0, -D / 2, 0), (0, 0, 0))
    grid('ceil', W, D, 4, ceil, (0, -D / 2, H), (math.pi, 0, 0))
    grid('wallL', D, H, RES, conc, (-W / 2, -D / 2, H / 2), (math.pi / 2, 0, math.pi / 2))
    grid('wallR', D, H, RES, conc, (W / 2, -D / 2, H / 2), (math.pi / 2, 0, -math.pi / 2))
    # wall ribs / pillars at the tile ends and centre
    for y in (-0.2, -D / 2, -D + 0.2):
        for s in (-1, 1):
            box('rib', s * (W / 2 - 0.2), y, H / 2, 0.4, 0.4, H, rib, cuts=6)
    # ceiling truss + LED strips running along the corridor
    for x in (-1.6, 1.6):
        box('truss', x, -D / 2, H - 0.35, 0.12, D, 0.12, alu, cuts=3)
        box('led', x, -D / 2, H - 0.43, 0.05, D, 0.03, led, cuts=2)
    box('cross', 0, -D / 2, H - 0.3, W, 0.1, 0.1, alu, cuts=3)
    box('ledX', 0, -D / 2, H - 0.36, 3.0, 0.04, 0.03, led, cuts=3)
    # floor tape (dashed centre line + side lines)
    for i in range(6):
        box('tape', 0, -0.5 - i * 1.0, 0.003, 0.06, 0.5, 0.004, tape, cuts=2)
    for s in (-1, 1):
        box('tapeS', s * 3.4, -D / 2, 0.003, 0.04, D, 0.004, tape, cuts=3)
    # flight cases along the left wall
    for i, (y, h) in enumerate([(-1.0, 0.7), (-1.9, 1.1), (-4.4, 0.8)]):
        box('case', -W / 2 + 0.75, y, h / 2 + 0.06, 0.9, 0.7, h, case, cuts=6)
        box('caseEdge', -W / 2 + 0.75, y, h + 0.07, 0.94, 0.74, 0.03, alu, cuts=3)
        for yy in (y - 0.25, y + 0.25):
            cyl('wheel', -W / 2 + 0.75, yy, 0, 0.06, 0.05, alu)
    # softbox on a stand on the right, aimed across the corridor
    sx, sy = W / 2 - 1.3, -D * 0.55
    for a in range(3):
        ang = a * 2 * math.pi / 3
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.015, depth=0.9,
                                            location=(sx + 0.3 * math.cos(ang), sy + 0.3 * math.sin(ang), 0.4),
                                            rotation=(0.35 * math.sin(ang), -0.35 * math.cos(ang), 0))
        bpy.context.active_object.data.materials.append(alu)
    cyl('pole', sx, sy, 0.4, 2.3, 0.02, alu)
    box('softbox', sx - 0.1, sy, 2.4, 0.5, 1.0, 1.0, case, cuts=5)
    box('diffuser', sx - 0.36, sy, 2.4, 0.02, 0.9, 0.9, soft, cuts=5)
    area_light(sx - 0.5, sy, 2.4, 0.9, 0.9, 260, (1, 0.95, 0.88)).rotation_euler = (0, -math.pi / 2, 0)
    # paper backdrop roll leaning in the far right corner
    cyl('roll', W / 2 - 0.5, -0.6, 0.0, 3.2, 0.1, back, seg=16)
    # cables on the floor
    for k in range(2):
        pts = [Vector((-W / 2 + 1.3 + k * 0.4, -0.2 - t * 0.6, 0.012)) for t in range(10)]
        for j in range(len(pts) - 1):
            p, q = pts[j], pts[j + 1]
            p.x += math.sin(j * 1.3 + k) * 0.15
            mid = (p + q) / 2
            box('cable', mid.x, mid.y, 0.012, 0.025, (q - p).length, 0.025, case)

    for x in (-1.6, 1.6):
        area_light(x, -D / 2, H - 0.5, 0.15, D, 380, (0.9, 0.95, 1.0))
    bpy.context.scene.world.color = (0.004, 0.004, 0.005)


(build_gallery if KIND == 'gallery' else build_studio)()

# ------------------------------------------------------------------ join + bake
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
room = bpy.context.active_object
room.name = 'room'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

me = room.data
attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
me.color_attributes.active_color = attr

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 384
sc.cycles.use_denoising = False
sc.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='COMBINED', target='VERTEX_COLORS')

# vertex bakes are noisy: a few Laplacian passes along mesh edges (stays inside each original part)
cols = [list(d.color[:3]) for d in attr.data]
nbr = [[] for _ in me.vertices]
for e in me.edges:
    a, b = e.vertices
    nbr[a].append(b)
    nbr[b].append(a)
for _ in range(3):
    new = []
    for i, c in enumerate(cols):
        if not nbr[i]:
            new.append(c)
            continue
        acc = [c[0] * 2, c[1] * 2, c[2] * 2]
        for j in nbr[i]:
            for k in range(3):
                acc[k] += cols[j][k]
        w = 2 + len(nbr[i])
        new.append([acc[0] / w, acc[1] / w, acc[2] / w])
    cols = new
# compress HDR bake into 0..1 (soft shoulder), keep blacks
for d, c in zip(attr.data, cols):
    d.color = tuple(1 - math.exp(-c[i] * 1.25) for i in range(3)) + (1.0,)

# remove materials so the exporter writes plain vertex colours
me.materials.clear()
for o in [o for o in sc.objects if o.type == 'LIGHT']:
    bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_normals=False,
                          export_texcoords=False, export_materials='NONE', export_vertex_color='ACTIVE',
                          export_all_vertex_colors=False, export_draco_mesh_compression_enable=False)
print('ROOM_DONE', KIND, len(me.vertices), 'verts', OUT)
