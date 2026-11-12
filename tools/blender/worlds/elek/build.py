"""Elek world: the sieve rim (bent-wood drum + seam overlap + rivets + hoops). Original model.
Run: /opt/homebrew/bin/blender -b -P tools/blender/worlds/elek/build.py
Unit radius (rim inner radius = 1), mesh plane at y = 0 (Blender z = 0). Scaled at runtime.
Vertex colour RGBA: rgb = albedo (with baked AO), a = material class (1 wood, .5 metal, .25 dark hoop).
UV: u = arc length around the rim, v = height (wood grain runs along u)."""
import bpy, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../public/worlds/elek/sieve.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)

verts, faces, cols, uvs = [], [], [], []  # uvs/cols per face-corner

def add_quad(a, b, c, d, col, uva):
    i = len(verts)
    verts.extend([a, b, c, d])
    faces.append((i, i + 1, i + 2, i + 3))
    cols.extend([col] * 4)
    uvs.extend(uva)

def P(r, ang, y):  # blender coords: z up
    return (r * math.cos(ang), r * math.sin(ang), y)

def revolve(profile, a0, a1, n, colf, caps=False):
    """profile: list of (r, y) points (open polyline, traversed so the outward side is on the right)."""
    for s in range(n):
        t0, t1 = a0 + (a1 - a0) * s / n, a0 + (a1 - a0) * (s + 1) / n
        for k in range(len(profile) - 1):
            (r0, y0), (r1, y1) = profile[k], profile[k + 1]
            col = colf((t0 + t1) / 2, (y0 + y1) / 2, k)
            add_quad(P(r0, t0, y0), P(r0, t1, y0), P(r1, t1, y1), P(r1, t0, y1), col,
                     [(t0 * r0, y0), (t1 * r0, y0), (t1 * r1, y1), (t0 * r1, y1)])
    if caps:
        for ang, flip in ((a0, False), (a1, True)):
            pts = [P(r, ang, y) for r, y in profile]
            c = colf(ang, 0, 0)
            for k in range(1, len(pts) - 2):
                tri = [pts[0], pts[k], pts[k + 1], pts[k + 1]]
                if flip: tri = tri[::-1]
                add_quad(*tri, c, [(0, 0)] * 4)

def closed(pts):
    return pts + [pts[0]]

WOOD = (0.52, 0.33, 0.17)
WOOD_D = (0.40, 0.24, 0.12)
def wood(ang, y, k, base=WOOD):
    ao = 0.55 + 0.45 * min(1.0, max(0.0, (y + 0.08) / 0.3))  # darker near the mesh
    j = 0.92 + 0.08 * math.sin(ang * 7.0 + 1.3)
    return (base[0] * ao * j, base[1] * ao * j, base[2] * ao * j, 1.0)

# main band (bent wood), rectangular section with a rounded lip
main = closed([(1.0, -0.08), (1.036, -0.08), (1.036, 0.325), (1.033, 0.337), (1.024, 0.344), (1.012, 0.344),
               (1.003, 0.337), (1.0, 0.325)])
# traverse so normals face outward: profile goes CCW in (r, y) -> fine with quad order below; fixed by recalc later
revolve(main, 0, 2 * math.pi, 128, wood)
# seam overlap: a second, thinner veneer layer over ~32 degrees
SEAM0, SEAM1 = -0.28, 0.28
seam = closed([(1.036, -0.02), (1.048, -0.02), (1.048, 0.30), (1.036, 0.30)])
revolve(seam, SEAM0, SEAM1, 14, lambda a, y, k: wood(a, y, k, WOOD_D), caps=True)
# outer bottom hoop (dark, lacquered) and inner hoop that clamps the wire mesh
hoop = closed([(1.036, -0.105), (1.066, -0.105), (1.066, 0.0), (1.036, 0.0)])
revolve(hoop, 0, 2 * math.pi, 128, lambda a, y, k: (0.08, 0.075, 0.07, 0.25))
inner = closed([(0.968, -0.07), (1.0, -0.07), (1.0, 0.045), (0.968, 0.045)])
revolve(inner, 0, 2 * math.pi, 128, lambda a, y, k: wood(a, y, k, WOOD_D))

def rivet(ang, y, r0, h=0.012, rad=0.011, n=8):
    # small domed cylinder pointing outward
    ca, sa = math.cos(ang), math.sin(ang)
    tx, ty = -sa, ca
    ring = []
    for i in range(n):
        th = 2 * math.pi * i / n
        ox, oz = math.cos(th) * rad, math.sin(th) * rad
        ring.append((ox, oz))
    col = (0.62, 0.60, 0.56, 0.5)
    for i in range(n):
        (x0, z0), (x1, z1) = ring[i], ring[(i + 1) % n]
        def pt(rr, ox, oz):
            return (ca * rr + tx * ox, sa * rr + ty * ox, y + oz)
        add_quad(pt(r0, x0, z0), pt(r0, x1, z1), pt(r0 + h, x1 * 0.7, z1 * 0.7), pt(r0 + h, x0 * 0.7, z0 * 0.7), col, [(0, 0)] * 4)
        add_quad(pt(r0 + h, x0 * 0.7, z0 * 0.7), pt(r0 + h, x1 * 0.7, z1 * 0.7), pt(r0 + h * 1.4, 0, 0), pt(r0 + h * 1.4, 0, 0), col, [(0, 0)] * 4)

for col_ang in (SEAM0 + 0.05, SEAM1 - 0.05):
    for i in range(7):
        rivet(col_ang, 0.02 + i * 0.043, 1.048)
for i in range(24):
    rivet(2 * math.pi * i / 24 + 0.06, -0.052, 1.066)

me = bpy.data.meshes.new('Sieve')
me.from_pydata(verts, [], faces)
me.update()
ca = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
uvl = me.uv_layers.new(name='UVMap')
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        ca.data[li].color = cols[vi]
        uvl.data[li].uv = uvs[vi]
me.color_attributes.active_color = ca
me.color_attributes.render_color_index = 0
ob = bpy.data.objects.new('Sieve', me)
bpy.context.scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
print('verts', len(me.vertices), 'faces', len(me.polygons))
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='ACTIVE',
    export_animations=False, export_skins=False, export_materials='NONE', export_normals=True,
    export_draco_mesh_compression_enable=False, export_yup=True, export_texcoords=True,
)
print('WROTE', os.path.abspath(OUT))
