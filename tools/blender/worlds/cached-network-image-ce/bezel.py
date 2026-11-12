"""Hero bezel (exported Z-up on purpose: the ring lies in glTF XY, thickness along +Z) for the CNI CE world: a rounded, bevelled 2x2 frame ring (opening 1.76) with a back plate.
Every vertex has |x|,|y| >= 0.8 or sits on a corner, so the shader 9-slices it to any size by shifting
x,y by sign()*(halfSize-1). Run: blender -b -P bezel.py"""
import bpy, bmesh
bpy.ops.wm.read_factory_settings(use_empty=True)
OUT = '/Users/egun/dev/erengun-lab/public/worlds/cached-network-image-ce/bezel.glb'

def box(name, sx, sy, sz, z=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return o

def round_vertical_edges(o, width, seg):
    bm = bmesh.new(); bm.from_mesh(o.data)
    edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-4]
    bmesh.ops.bevel(bm, geom=edges, offset=width, segments=seg, affect='EDGES', profile=0.5)
    bm.to_mesh(o.data); bm.free()

outer = box('Bezel', 2.0, 2.0, 0.10)
round_vertical_edges(outer, 0.09, 6)
hole = box('Hole', 1.76, 1.76, 1.0)
round_vertical_edges(hole, 0.035, 4)
m = outer.modifiers.new('cut', 'BOOLEAN'); m.object = hole; m.operation = 'DIFFERENCE'; m.solver = 'EXACT'
bpy.context.view_layer.objects.active = outer
bpy.ops.object.modifier_apply(modifier='cut')
bpy.data.objects.remove(hole)
bv = outer.modifiers.new('bev', 'BEVEL'); bv.width = 0.018; bv.segments = 3; bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier='bev')
# back plate (closes the frame, sits behind the screenshot)
back = box('Back', 1.9, 1.9, 0.02, z=-0.045)
round_vertical_edges(back, 0.07, 4)
for o in (outer, back): o.select_set(True)
bpy.context.view_layer.objects.active = outer
bpy.ops.object.join()
bpy.ops.object.shade_auto_smooth(angle=0.6)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False, export_yup=False)
print('verts', len(outer.data.vertices))
