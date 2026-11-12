# Subara world hero geometry (original): a giant phone body and a rounded "liquid glass" card slab.
# Run: /opt/homebrew/bin/blender -b -P tools/blender/worlds/subara/build.py
# Output: public/worlds/subara/subara.glb  (meshes: Phone, Card; Y-up after glTF export, front faces +Z)
import bpy, bmesh, os
from math import radians

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../public/worlds/subara/subara.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)

def rounded_slab(name, w, h, d, r_corner, r_edge, seg_corner=10, seg_edge=4):
    """box w (x) × h (blender y → gltf -z… we build in blender Z-up as x=w, z=h, y=d so glTF gets x=w, y=h, z=-y)"""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w; v.co.z *= h; v.co.y *= d
    # corner radius: bevel the 4 edges parallel to the depth axis (Y)
    vert_edges = [e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > d * 0.5]
    bmesh.ops.bevel(bm, geom=vert_edges, offset=r_corner, segments=seg_corner, profile=0.5, affect='EDGES', clamp_overlap=True)
    # round the front/back rims
    rim = [e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6 and abs(abs(e.verts[0].co.y) - d / 2) < 1e-5]
    bmesh.ops.bevel(bm, geom=rim, offset=r_edge, segments=seg_edge, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return ob

def add_box(target, x, z, y, w, h, d, r):
    """small rounded side button merged into target"""
    b = rounded_slab('tmp', w, h, d, r, r * 0.6, 4, 2)
    b.location = (x, y, z)
    bpy.context.view_layer.objects.active = target
    target.select_set(True); b.select_set(True)
    bpy.ops.object.join()

phone = rounded_slab('Phone', 1.0, 2.06, 0.1, 0.165, 0.035)
# side buttons (blender x = phone width axis, z = height, y = depth)
add_box(phone, -0.505, 0.62, 0, 0.02, 0.09, 0.045, 0.009)   # action button
add_box(phone, -0.505, 0.42, 0, 0.02, 0.2, 0.045, 0.009)    # volume up
add_box(phone, -0.505, 0.16, 0, 0.02, 0.2, 0.045, 0.009)    # volume down
add_box(phone, 0.505, 0.35, 0, 0.02, 0.32, 0.045, 0.009)    # side button
# camera plateau on the back (blender +y = back after export? glTF z = -blender y, so front is blender -y)
add_box(phone, -0.23, 0.74, 0.06, 0.42, 0.42, 0.025, 0.1)

card = rounded_slab('Card', 1.2, 0.76, 0.045, 0.1, 0.018, 10, 4)

for ob in bpy.data.objects:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.select_set(False)
    ob.location = (0, 0, 0)

bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_yup=True,
                          export_apply=True, export_normals=True, export_texcoords=False, export_materials='NONE')
print('wrote', os.path.abspath(OUT))
