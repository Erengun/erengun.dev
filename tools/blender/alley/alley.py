"""Original night-alley scene → gaussian splats.

Usage (Blender 5.x, headless):
  blender -b -P tools/blender/alley/alley.py -- build            # build scene, save work/alley.blend
  blender -b work/alley.blend -P tools/blender/alley/alley.py -- preview   # quick hero render (tuning)
  blender -b work/alley.blend -P tools/blender/alley/alley.py -- render    # hero + cube-face colour/position renders
  blender -b work/alley.blend -P tools/blender/alley/alley.py -- splat [N]  # sample, project, write public/splats/alley.splat

Blender coordinates: z up, alley runs along +y; the hero eye is at (0, 0, EYE) looking +y.
Output (.splat) coordinates: three.js, y up, metres, hero eye at the origin looking down -z:
  three = (bx, bz - EYE, -by)
"""
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
TEX = os.path.join(HERE, 'tex')
WORK = os.environ.get('ALLEY_WORK', os.path.join(HERE, 'work'))
os.makedirs(WORK, exist_ok=True)
EYE = 1.45
HERO_FOV_Y = 62.0  # degrees, hero render (with margin below)
HERO_MARGIN = 1.18
HERO_PITCH = 9.0   # degrees up
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['build']
STAGE = ARGS[0]
rng = random.Random(11)

# ------------------------------------------------------------------------------------------------ helpers
_mats = {}


def node_mat(name, build):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    build(nt, bsdf)
    _mats[name] = m
    return m


def coord(nt, kind='Object'):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    return tc.outputs[kind]


def noise(nt, scale, detail=4.0, vec=None):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    if vec is not None:
        nt.links.new(vec, n.inputs['Vector'])
    return n


def ramp(nt, fac, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], (*stops[0][1], 1)
    el[1].position, el[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = el.new(p)
        e.color = (*c, 1)
    nt.links.new(fac, r.inputs[0])
    return r


def srgb(c):
    return tuple(((x / 255) if x > 1 else x) ** 2.2 for x in c)


def mat_rough(name, c0, c1, scale=6.0, rough=(0.55, 0.85), metal=0.0, bump=0.0, wave=None):
    def b(nt, bsdf):
        n = noise(nt, scale, 6.0, coord(nt))
        r = ramp(nt, n.outputs['Fac'], [(0.3, srgb(c0)), (0.7, srgb(c1))])
        nt.links.new(r.outputs[0], bsdf.inputs['Base Color'])
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['To Min'].default_value, rr.inputs['To Max'].default_value = rough
        nt.links.new(n.outputs['Fac'], rr.inputs['Value'])
        nt.links.new(rr.outputs[0], bsdf.inputs['Roughness'])
        bsdf.inputs['Metallic'].default_value = metal
        if wave or bump:
            bm = nt.nodes.new('ShaderNodeBump')
            bm.inputs['Strength'].default_value = 0.6
            if wave:
                w = nt.nodes.new('ShaderNodeTexWave')
                w.wave_type = 'BANDS'
                w.bands_direction = wave[0]
                w.inputs['Scale'].default_value = wave[1]
                nt.links.new(coord(nt), w.inputs['Vector'])
                nt.links.new(w.outputs['Fac'], bm.inputs['Height'])
            else:
                nt.links.new(n.outputs['Fac'], bm.inputs['Height'])
            nt.links.new(bm.outputs[0], bsdf.inputs['Normal'])
    return node_mat(name, b)


def mat_img(name, img, emit=0.0, rough=0.6, tint=(1, 1, 1)):
    def b(nt, bsdf):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, img + '.png'), check_existing=True)
        t.extension = 'EXTEND'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(t.outputs['Color'], mix.inputs['A'])
        mix.inputs['B'].default_value = (*tint, 1)
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = rough
        if emit > 0:
            nt.links.new(mix.outputs['Result'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emit
    return node_mat(name, b)


def mat_flat(name, c, rough=0.6, metal=0.0, emit=0.0, ecol=None):
    def b(nt, bsdf):
        bsdf.inputs['Base Color'].default_value = (*srgb(c), 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emit > 0:
            bsdf.inputs['Emission Color'].default_value = (*srgb(ecol or c), 1)
            bsdf.inputs['Emission Strength'].default_value = emit
    return node_mat(name, b)


def mat_emit(name, c, strength):
    def b(nt, bsdf):
        out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (*srgb(c), 1)
        e.inputs['Strength'].default_value = strength
        nt.links.new(e.outputs[0], out.inputs[0])
    return node_mat(name, b)


COL = bpy.data.collections.get('Alley')


def link(ob):
    COL.objects.link(ob)
    return ob


def mesh_obj(name, verts, faces, mat, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        k = 0
        for f in me.polygons:
            for li in f.loop_indices:
                uvl.data[li].uv = uvs[k]
                k += 1
    me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    return link(ob)


def box(name, c, s, mat, rot=None):
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_obj(name, v, f, mat)
    ob.location = c
    if rot:
        ob.rotation_euler = rot
    return ob


def quad(name, corners, mat, flip_u=False):
    """corners: bottom-left, bottom-right, top-right, top-left (seen from the front)."""
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
    if flip_u:
        uv = [(1 - u, v) for u, v in uv]
    return mesh_obj(name, corners, [(0, 1, 2, 3)], mat, uv)


def face(name, c, n, w, h, mat):
    """Textured rectangle centred at c facing direction n (horizontal), text reads correctly from the front."""
    n = Vector(n).normalized()
    up = Vector((0, 0, 1))
    r = up.cross(n).normalized()
    c = Vector(c)
    pts = [c - r * w / 2 - up * h / 2, c + r * w / 2 - up * h / 2, c + r * w / 2 + up * h / 2, c - r * w / 2 + up * h / 2]
    return quad(name, pts, mat)


def cyl(name, p0, p1, r, mat, seg=10):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=L)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = link(bpy.data.objects.new(name, me))
    ob.location = (p0 + p1) / 2
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def point_light(name, loc, color, power, radius=0.1):
    L = bpy.data.lights.new(name, 'POINT')
    L.color = color
    L.energy = power
    L.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    return link(ob)


def area_light(name, loc, rot, size, color, power, shape='RECTANGLE', size_y=None):
    L = bpy.data.lights.new(name, 'AREA')
    L.shape = shape
    L.size = size
    if size_y:
        L.size_y = size_y
    L.color = color
    L.energy = power
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob)


# ------------------------------------------------------------------------------------------------ scene
LANTERNS = []  # (center, radius, height, rgb glow)


def lantern(c, r, h, kind):
    me = bpy.data.meshes.new('Lantern')
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0, calc_uvs=True)
    bm.to_mesh(me)
    bm.free()
    if kind == 'red':
        m = mat_img('lantern_red', 'lantern_red', emit=4.0, rough=0.7)
        glow = (1.0, 0.16, 0.05)
    else:
        m = mat_img('lantern_white', 'lantern_white', emit=2.2, rough=0.7, tint=(1, .62, .38))
        glow = (1.0, 0.45, 0.22)
    me.materials.append(m)
    ob = link(bpy.data.objects.new('Lantern', me))
    ob.location = c
    ob.scale = (r, r, h / 2)
    ob.rotation_euler = (0, 0, rng.uniform(0, 6.28))
    dark = mat_flat('lantern_cap', (25, 18, 12), 0.5)
    cyl('LanternCap', (c[0], c[1], c[2] + h / 2 - 0.03), (c[0], c[1], c[2] + h / 2 + 0.03), r * 0.55, dark)
    cyl('LanternCap', (c[0], c[1], c[2] - h / 2 - 0.03), (c[0], c[1], c[2] - h / 2 + 0.03), r * 0.55, dark)
    point_light('LanternLight', c, glow, 30 if kind == 'red' else 10, r * 0.6)
    LANTERNS.append((tuple(c), r, h, glow, kind))


def build():
    global COL
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    COL = bpy.data.collections.new('Alley')
    bpy.context.scene.collection.children.link(COL)

    W = 1.35  # half width at the ground-floor facades
    Y0, Y1 = -6.0, 36.0

    floor = mat_rough('floor', (22, 19, 18), (48, 42, 38), 3.0, (0.15, 0.7), bump=1)
    plaster = mat_rough('plaster', (150, 135, 115), (205, 190, 165), 4.0, (0.7, 0.95))
    plaster2 = mat_rough('plaster2', (120, 105, 95), (170, 150, 130), 7.0, (0.7, 0.95))
    wood = mat_rough('wood', (70, 38, 20), (125, 75, 40), 12.0, (0.5, 0.8))
    wood_dark = mat_rough('wood_dark', (35, 20, 12), (70, 42, 25), 10.0, (0.5, 0.8))
    shutter = mat_rough('shutter', (120, 118, 112), (165, 160, 150), 5.0, (0.35, 0.6), metal=0.4, wave=('Z', 55.0))
    siding = mat_rough('siding', (90, 92, 90), (130, 125, 115), 3.0, (0.4, 0.7), metal=0.5, wave=('X', 18.0))
    siding_y = mat_rough('siding_y', (90, 92, 90), (130, 125, 115), 3.0, (0.4, 0.7), metal=0.5, wave=('Y', 18.0))
    awning_red = mat_rough('awning_red', (140, 20, 15), (190, 40, 25), 5.0, (0.5, 0.8))
    metal_dark = mat_flat('metal_dark', (30, 30, 32), 0.5, 0.6)
    pipe = mat_flat('pipe', (150, 145, 135), 0.45, 0.5)
    black = mat_flat('black', (10, 9, 8), 0.8)
    ac = mat_rough('ac', (180, 178, 170), (210, 205, 195), 8.0, (0.5, 0.7))
    crate_r = mat_flat('crate_r', (180, 30, 25), 0.6)
    crate_b = mat_flat('crate_b', (30, 70, 160), 0.6)
    bottle = mat_flat('bottle', (40, 90, 40), 0.15, 0.0)
    bottle2 = mat_flat('bottle2', (120, 60, 20), 0.15, 0.0)
    interior = mat_rough('interior', (150, 110, 70), (200, 160, 110), 5.0, (0.6, 0.9))
    collage = mat_img('collage', 'collage_a', rough=0.8)
    bulb = mat_emit('bulb', (255, 190, 120), 20.0)
    neon_red = mat_emit('neon_red', (255, 40, 30), 14.0)
    glow_end = mat_emit('end_glow', (255, 90, 30), 0.8)

    # floor + gutter
    quad('Floor', [(-2.2, Y0, 0), (2.2, Y0, 0), (2.2, Y1, 0), (-2.2, Y1, 0)], floor)
    for s in (-1, 1):
        box('Gutter', (s * (W - 0.12), (Y0 + Y1) / 2, 0.015), (0.18, Y1 - Y0, 0.03), metal_dark)
    for y in (4.5, 13.0, 22.0):
        box('Manhole', (0.2, y, 0.004), (0.6, 0.6, 0.008), metal_dark)

    # end of the alley: a lit cross street
    quad('EndGlow', [(-2.2, Y1, 0), (2.2, Y1, 0), (2.2, Y1, 7), (-2.2, Y1, 7)], glow_end)
    area_light('EndLight', (0, Y1 - 0.5, 3.0), (math.radians(90), 0, math.radians(180)), 4.0, (1.0, 0.25, 0.08), 400, size_y=6)
    # behind the hero: closed end wall
    quad('BackWall', [(2.2, Y0, 0), (-2.2, Y0, 0), (-2.2, Y0, 7), (2.2, Y0, 7)], plaster2)

    signs_v = ['vbox_a', 'vbox_b', 'vbox_c', 'vbox_d']
    posters = ['poster_a', 'poster_b', 'poster_c']
    for side in (-1, 1):
        y = Y0
        k = 0
        while y < Y1:
            wmod = rng.uniform(2.4, 3.8)
            y1 = min(y + wmod, Y1)
            yc = (y + y1) / 2
            kind = rng.choice(['shutter', 'open', 'wood', 'open', 'shutter'])
            if side == -1 and -1.0 < yc < 3.0:
                kind = 'shutter'  # near-left closed shutters (composition)
            if side == 1 and -1.0 < yc < 3.0:
                kind = 'wood'
            x = side * W
            xin = side * (W + 0.02)
            # columns between shops
            box('Column', (side * (W - 0.05), y + 0.08, 1.4), (0.22, 0.16, 2.8), wood_dark)
            if kind == 'shutter':
                # recessed corrugated shutter + housing box
                quad('Shutter', [(x, y1, 0), (x, y, 0), (x, y, 2.35)][::1] + [(x, y1, 2.35)], shutter) if side == -1 else \
                    quad('Shutter', [(x, y, 0), (x, y1, 0), (x, y1, 2.35), (x, y, 2.35)], shutter)
                box('ShutterBox', (side * (W - 0.12), yc, 2.47), (0.25, y1 - y, 0.24), siding_y)
                if rng.random() < 0.7:
                    p = rng.choice(posters)
                    pw, ph = 0.5, 0.7
                    py, pz = rng.uniform(y + 0.4, y1 - 0.9), rng.uniform(0.9, 1.4)
                    face('Poster', (side * (W - 0.01), py + pw / 2, pz + ph / 2), (-side, 0, 0), pw, ph, mat_img(p, p, 0.0, 0.6))
            elif kind == 'open':
                d = 1.3  # interior depth
                xb = side * (W + d)
                quad('ShopFloor', [(x, y, 0.01), (xb, y, 0.01), (xb, y1, 0.01), (x, y1, 0.01)], floor)
                quad('ShopBack', [(xb, y, 0), (xb, y1, 0), (xb, y1, 2.4), (xb, y, 2.4)], interior)
                quad('ShopCeil', [(x, y, 2.4), (xb, y, 2.4), (xb, y1, 2.4), (x, y1, 2.4)], interior)
                for yy in (y, y1):
                    quad('ShopSide', [(x, yy, 0), (xb, yy, 0), (xb, yy, 2.4), (x, yy, 2.4)], interior)
                # counter, shelves, bottles
                box('Counter', (side * (W + 0.35), yc, 0.5), (0.45, (y1 - y) * 0.8, 1.0), wood)
                box('CounterTop', (side * (W + 0.3), yc, 1.02), (0.6, (y1 - y) * 0.82, 0.05), wood_dark)
                for sh in (1.3, 1.7):
                    box('Shelf', (side * (W + d - 0.15), yc, sh), (0.3, (y1 - y) * 0.9, 0.03), wood_dark)
                    for i in range(int((y1 - y) * 6)):
                        by = y + 0.15 + i / 6
                        cyl('Bottle', (side * (W + d - 0.15), by, sh + 0.015), (side * (W + d - 0.15), by, sh + 0.015 + rng.uniform(.18, .3)),
                            0.035, bottle if rng.random() < .5 else bottle2, 8)
                face('Menu', (xb - side * 0.01, yc, 2.05), (-side, 0, 0), y1 - y - 0.4, 0.5, mat_img('menu_a', 'menu_a', 0.3, 0.7))
                area_light('ShopLight', (side * (W + d / 2), yc, 2.3), (0, 0, 0), 0.8, (1.0, 0.22, 0.07), 45, size_y=(y1 - y) * 0.7)
                cyl('Bulb', (side * (W + 0.6), yc, 2.2), (side * (W + 0.6), yc, 2.28), 0.05, bulb, 8)
                # noren across the entrance top
                n = rng.choice(['noren_a', 'noren_b'])
                face('Noren', (side * (W - 0.02), yc, 2.0), (-side, 0, 0), 1.5, 0.6, mat_img(n, n, 0.15, 0.9))
            else:  # wooden lattice facade with lit paper windows
                quad('WoodWall', [(x, y, 0), (x, y1, 0), (x, y1, 2.45), (x, y, 2.45)][::(1 if side == 1 else -1)], wood)
                paper = mat_flat('paper', (150, 100, 70), 0.9, 0, 0.18, (255, 90, 40))
                wy0, wy1 = y + 0.3, y1 - 0.3
                xs = side * (W - 0.01)
                c4 = [(xs, wy0, 0.9), (xs, wy1, 0.9), (xs, wy1, 2.0), (xs, wy0, 2.0)]
                quad('PaperWin', c4 if side == 1 else c4[::-1], paper)
                n = int((wy1 - wy0) / 0.12)
                for i in range(n + 1):
                    yy = wy0 + i * (wy1 - wy0) / n
                    box('Lattice', (side * (W - 0.03), yy, 1.45), (0.03, 0.025, 1.1), wood_dark)
                for zz in (0.9, 1.25, 1.62, 2.0):
                    box('Lattice', (side * (W - 0.03), (wy0 + wy1) / 2, zz), (0.03, wy1 - wy0, 0.025), wood_dark)
                if rng.random() < 0.6:
                    box('Crate', (side * (W - 0.3), y + 0.5, 0.18), (0.4, 0.5, 0.36), crate_r if rng.random() < .5 else crate_b)
                    box('Crate', (side * (W - 0.3), y + 0.5, 0.54), (0.4, 0.5, 0.36), crate_b if rng.random() < .5 else crate_r)

            # ---- eave / awning over the ground floor
            ez = rng.uniform(2.5, 2.75)
            proj = rng.uniform(0.45, 0.75)
            amat = awning_red if rng.random() < 0.35 else (wood_dark if rng.random() < .5 else siding_y)
            box('Eave', (side * (W - proj / 2), yc, ez), (proj, y1 - y + 0.02, 0.06), amat, (side * math.radians(-12), 0, 0) if False else (0, side * math.radians(10), 0))
            box('Fascia', (side * (W - proj), yc, ez - 0.12), (0.04, y1 - y, 0.26), wood_dark)
            # signboard on some fascias (facing the alley)
            if rng.random() < 0.55 or (side == -1 and -1 < yc < 3):
                bw = min(y1 - y - 0.3, 2.2)
                bx = side * (W - proj - 0.03)
                bz0, bz1 = ez - 0.05, ez + 0.65 if (side == -1 and -1 < yc < 3) else ez + 0.45
                face('Board', (bx, yc, (bz0 + bz1) / 2), (-side, 0, 0), bw, bz1 - bz0, mat_img('board_a', 'board_a', 0.25, 0.6))
                box('BoardBack', (bx + side * 0.03, yc, (bz0 + bz1) / 2), (0.05, bw, bz1 - bz0), wood_dark)
            # warm downlight under the eave
            point_light('EaveLight', (side * (W - 0.35), yc, ez - 0.25), (1.0, 0.09, 0.03), 26, 0.15)
            if rng.random() < 0.5:
                cyl('Bulb', (side * (W - 0.4), yc + 0.3, ez - 0.2), (side * (W - 0.4), yc + 0.3, ez - 0.12), 0.05, bulb, 8)

            # ---- upper storey
            uw = W + rng.uniform(-0.15, 0.1)
            ux = side * uw
            umat = rng.choice([plaster, plaster2, siding, collage if rng.random() < .3 else plaster2])
            c = [(ux, y, ez), (ux, y1, ez), (ux, y1, 6.6), (ux, y, 6.6)]
            quad('Upper', c if side == 1 else c[::-1], umat)
            # windows
            for wy in np.arange(y + 0.5, y1 - 0.8, 1.3):
                wz = rng.uniform(3.6, 4.3)
                lit = rng.random() < 0.35
                wm = mat_flat('win_lit', (200, 120, 80), 0.3, 0, 0.5, (255, 110, 50)) if lit else mat_flat('win_dark', (12, 10, 10), 0.15)
                xs = side * (uw - 0.01)
                cw = [(xs, wy, wz), (xs, wy + 0.7, wz), (xs, wy + 0.7, wz + 0.9), (xs, wy, wz + 0.9)]
                quad('Window', cw if side == 1 else cw[::-1], wm)
                if rng.random() < 0.4:
                    box('AC', (side * (uw - 0.2), wy + 0.35, wz - 0.4), (0.35, 0.75, 0.55), ac)
            # protruding vertical lightbox signs
            if rng.random() < 0.65 or (side == -1 and 3 < yc < 9):
                sz0 = rng.uniform(2.9, 3.4)
                sh = rng.uniform(1.1, 1.6)
                sy = rng.uniform(y + 0.3, y1 - 0.3)
                img = rng.choice(signs_v)
                m = mat_img(img + '_lit', img, 1.3, 0.4)
                x0, x1 = side * (uw - 0.05), side * (uw - 0.5)
                box('SignBox', ((x0 + x1) / 2, sy, sz0 + sh / 2), (0.45, 0.12, sh), metal_dark)
                face('SignFace', ((x0 + x1) / 2, sy - 0.062, sz0 + sh / 2), (0, -1, 0), 0.45, sh, m)
                face('SignFace', ((x0 + x1) / 2, sy + 0.062, sz0 + sh / 2), (0, 1, 0), 0.45, sh, m)
            # vertical pipe
            if rng.random() < 0.5:
                py = rng.uniform(y, y1)
                cyl('Pipe', (side * (uw - 0.08), py, 0), (side * (uw - 0.08), py, 6.6), 0.04, pipe, 8)
            # upper eave (nearly closes the sky)
            box('RoofEave', (side * (uw - 0.45), yc, 6.65), (1.0, y1 - y + 0.05, 0.08), wood_dark, (0, side * math.radians(-14), 0))
            # neon strip
            if rng.random() < 0.3:
                cyl('Neon', (side * (uw - 0.06), y + 0.2, ez + 0.4), (side * (uw - 0.06), y1 - 0.2, ez + 0.4), 0.012, neon_red, 6)
            y = y1
            k += 1

    # ---- overhead cables, beams, ducts
    for i in range(22):
        yy = rng.uniform(Y0 + 2, Y1 - 2)
        z0, z1 = rng.uniform(3.4, 5.6), rng.uniform(3.4, 5.6)
        sag = rng.uniform(0.1, 0.35)
        pts = [Vector((-W + 0.1 + t * (2 * W - 0.2), yy + rng.uniform(-.3, .3) * t, z0 + (z1 - z0) * t - sag * 4 * t * (1 - t))) for t in np.linspace(0, 1, 7)]
        for a, b in zip(pts[:-1], pts[1:]):
            cyl('Cable', a, b, 0.012, black, 5)
    for yy in np.arange(-2.0, Y1, 5.5):
        box('Beam', (0, yy + rng.uniform(-.5, .5), rng.uniform(5.2, 6.0)), (2 * W + 0.4, 0.14, 0.18), wood_dark)
    # duct along the upper left (like an exhaust run)
    cyl('Duct', (-W + 0.35, -3, 3.3), (-W + 0.35, 9, 3.3), 0.16, pipe, 14)
    cyl('Duct', (-W + 0.35, 9, 3.3), (-0.2, 11, 3.9), 0.16, pipe, 14)

    # ---- hanging cross banners mid-alley
    for yy in (8.0, 15.0, 23.0):
        for i, xx in enumerate(np.linspace(-0.9, 0.9, 4)):
            n = 'noren_a' if (i % 2 == 0) else 'noren_b'
            face('Banner', (xx, yy, 2.78), (0, -1, 0), 0.4, 0.45, mat_img(n + '_b', n, 0.1, 0.9))
        cyl('BannerRope', (-W, yy, 3.02), (W, yy, 3.02), 0.01, black, 5)

    # ---- lanterns: strings under the eaves on both sides + hero cluster upper right
    for (x, y, z, r, h, k) in [(0.72, 2.9, 2.3, 0.3, 0.8, 'red'), (0.92, 2.45, 2.42, 0.15, 0.36, 'red'),
                               (1.02, 2.1, 2.55, 0.15, 0.38, 'white'), (1.12, 1.8, 2.68, 0.15, 0.38, 'white'),
                               (1.22, 1.5, 2.8, 0.14, 0.36, 'white'), (0.85, 3.9, 2.2, 0.16, 0.4, 'white')]:
        lantern((x, y, z), r, h, k)
    for side in (-1, 1):
        for yy in np.arange(5.0 if side == 1 else 3.0, Y1 - 2, rng.uniform(2.2, 3.0)):
            k = 'red' if rng.random() < 0.6 else 'white'
            r = 0.2 if k == 'red' else 0.15
            lantern((side * rng.uniform(0.8, 0.95), yy, rng.uniform(2.25, 2.45)), r, r * 2.5, k)

    # ---- big tilted signboard upper-left near the hero, and a red shelf on the right
    bn = Vector((1, -0.35, -0.25)).normalized()
    bb = face('BigBoard', (-1.08, 1.9, 2.55), (1, -0.35, 0), 2.2, 0.95, mat_img('board_big', 'board_a', 0.0, 0.6))
    box('ShelfR', (1.15, 3.2, 1.25), (0.4, 1.6, 0.05), awning_red)
    box('ShelfR', (1.15, 3.2, 1.75), (0.4, 1.6, 0.05), awning_red)
    face('PosterR', (1.33, 4.6, 1.6), (-1, 0, 0), 0.6, 0.85, mat_img('poster_a_r', 'poster_a', 0.0, 0.6))
    face('PosterL', (-1.33, 1.2, 1.2), (1, 0, 0), 0.7, 1.0, mat_img('poster_b_l', 'poster_b', 0.0, 0.6))
    face('MenuR', (1.33, 6.2, 2.0), (-1, 0, 0), 1.6, 0.6, mat_img('menu_r', 'menu_a', 0.2, 0.6))

    # ---- props near the hero view
    sn = Vector((0.6, -1, 0)).normalized()
    box('Stand', (-0.85, 3.4, 0.55), (0.6, 0.1, 1.1), wood_dark, (0, 0, math.atan2(sn.x, -sn.y)))
    face('StandFace', Vector((-0.85, 3.4, 0.58)) + sn * 0.055, sn, 0.56, 0.95, mat_img('stand_a', 'stand_a', 1.0, 0.5))
    point_light('StandLight', (-0.6, 3.4, 0.6), (1.0, 0.5, 0.2), 6, 0.1)
    box('ScreenBox', (0.55, 5.2, 0.35), (0.35, 0.12, 0.4), metal_dark)
    face('Screen', (0.55, 5.13, 0.35), (0, -1, 0), 0.3, 0.34, mat_img('screen_a', 'screen_a', 3.0, 0.3))
    for (sx, sy) in [(0.95, 2.6), (0.9, 3.4), (-0.7, 6.5), (0.8, 9.5)]:
        cyl('Stool', (sx, sy, 0), (sx, sy, 0.45), 0.16, crate_r, 12)
    box('Table', (1.0, 4.4, 0.7), (0.45, 0.8, 0.05), wood)
    for dy in (-0.3, 0.3):
        box('TableLeg', (1.0, 4.4 + dy, 0.35), (0.05, 0.05, 0.7), metal_dark)
    # a bicycle-ish silhouette and a scooter stand-in further down
    box('Scooter', (-0.8, 7.5, 0.45), (0.35, 1.2, 0.6), metal_dark)
    cyl('Wheel', (-0.88, 7.0, 0.22), (-0.72, 7.0, 0.22), 0.22, black, 16)
    cyl('Wheel', (-0.88, 8.0, 0.22), (-0.72, 8.0, 0.22), 0.22, black, 16)
    # people silhouettes (simple) in the distance
    for (px, py) in [(-0.2, 16.0), (0.35, 19.5), (-0.4, 24.0), (0.1, 27.5)]:
        cyl('Person', (px, py, 0), (px, py, 1.45), 0.18, black, 10)
        cyl('Head', (px, py, 1.45), (px, py, 1.7), 0.11, black, 10)
    # red fill from above (alley glow) + world
    area_light('RedFill', (0, 15, 6.2), (0, 0, 0), 2.0, (1.0, 0.06, 0.02), 380, size_y=40)
    area_light('NearFill', (0, 1.5, 3.4), (0, 0, 0), 1.4, (1.0, 0.08, 0.03), 35, size_y=3)
    # warm bare bulbs near the hero (bright spots like the reference)
    for (bx, by, bz) in [(0.55, 6.5, 2.35), (-0.6, 9.0, 2.4)]:
        cyl('Bulb', (bx, by, bz), (bx, by, bz + 0.09), 0.055, bulb, 8)
        point_light('BulbLight', (bx, by, bz - 0.05), (1.0, 0.55, 0.25), 25, 0.05)
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.004, 0.0015, 0.001, 1)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    # store lantern data for the splat stage
    bpy.context.scene['lanterns'] = [list(c) + [r, h] + list(g) + [1 if k == 'red' else 0] for (c, r, h, g, k) in LANTERNS]
    setup_render()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'alley.blend'))
    print('built', len(bpy.data.objects), 'objects')


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('GPU setup failed', e)
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.sample_clamp_indirect = 8.0
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -1.0
    sc.render.film_transparent = False


# ------------------------------------------------------------------------------------------------ cameras
def make_camera(name, loc, rot, fov_deg, w, h, sensor_fit='VERTICAL'):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = sensor_fit
    cd.angle = math.radians(fov_deg)
    cd.clip_start = 0.02
    cd.clip_end = 200
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    ob.rotation_euler = rot
    bpy.context.scene.collection.objects.link(ob)
    return ob


def views():
    """[(name, loc, euler, fov_y, w, h, priority)]"""
    hero_fov = 2 * math.degrees(math.atan(math.tan(math.radians(HERO_FOV_Y / 2)) * HERO_MARGIN))
    v = [('hero', (0, 0, EYE), (math.radians(90 + HERO_PITCH), 0, 0), hero_fov, 1800, 1125, 2)]
    faces = {'f': (90, 0, 0), 'b': (90, 0, 180), 'l': (90, 0, 90), 'r': (90, 0, -90), 'u': (180, 0, 0), 'd': (0, 0, 0)}
    for i, (x, y, z) in enumerate([(0, -1.2, EYE), (0, 3.0, EYE), (0, 7.5, 1.8), (0, 13.0, 1.8), (0, 20.0, 1.8),
                                   (0, 28.0, 1.8), (0, 1.0, 2.4)]):
        for f, e in faces.items():
            if f == 'b' and i > 0:
                continue
            res = 640 if i == 0 else 512
            v.append((f'c{i}{f}', (x, y, z), tuple(math.radians(a) for a in e), 90.0, res, res, 1))
    return v


def render_views(preview=False):
    sc = bpy.context.scene
    setup_render()
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_depth = '8'
    vs = views()
    if preview:
        vs = vs[:1]
    # position override material (encoded: (pos + OFF)/SCALE so values stay positive)
    pm = bpy.data.materials.new('posmat')
    pm.use_nodes = True
    nt = pm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    add = nt.nodes.new('ShaderNodeVectorMath')
    add.operation = 'ADD'
    add.inputs[1].default_value = (5.0, 10.0, 2.0)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(geo.outputs['Position'], add.inputs[0])
    nt.links.new(add.outputs[0], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs[0])

    for (name, loc, rot, fov, w, h, pri) in vs:
        cam = make_camera(name, loc, rot, fov, w, h, 'VERTICAL' if w >= h else 'HORIZONTAL')
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = (w // 2, h // 2) if preview else (w, h)
        col_path = os.path.join(WORK, f'{name}_col.png')
        pos_path = os.path.join(WORK, f'{name}_pos.exr')
        if preview or not os.path.exists(col_path):
            sc.view_layers[0].material_override = None
            sc.cycles.samples = 64 if preview else (160 if pri == 2 else 40)
            sc.cycles.use_denoising = True
            sc.cycles.filter_width = 1.5
            sc.render.image_settings.file_format = 'PNG'
            sc.render.image_settings.color_depth = '8'
            sc.render.filepath = col_path
            bpy.ops.render.render(write_still=True)
        if not preview and not os.path.exists(pos_path):
            sc.view_layers[0].material_override = pm
            for L in sc.objects:
                if L.type == 'LIGHT':
                    L.visible_camera = False
            sc.cycles.samples = 1
            sc.cycles.use_denoising = False
            sc.cycles.filter_width = 0.01
            sc.render.image_settings.file_format = 'OPEN_EXR'
            sc.render.image_settings.color_depth = '32'
            sc.render.filepath = pos_path
            bpy.ops.render.render(write_still=True)
            sc.render.image_settings.file_format = 'PNG'
            sc.render.image_settings.color_depth = '8'
            for L in sc.objects:
                if L.type == 'LIGHT':
                    L.visible_camera = True
            sc.view_layers[0].material_override = None
        print('rendered', name, flush=True)


# ------------------------------------------------------------------------------------------------ splats
def load_pixels(path, non_color=True):
    img = bpy.data.images.load(path)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)  # row 0 = bottom


def gather_triangles():
    dg = bpy.context.evaluated_depsgraph_get()
    tris, nrm, tri_obj = [], [], []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        if ob.name.startswith(('EndGlow',)):
            pass
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        nv = len(me.vertices)
        co = np.empty(nv * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        M = np.array(ob.matrix_world, np.float32)
        co = co @ M[:3, :3].T + M[:3, 3]
        nt = len(me.loop_triangles)
        vi = np.empty(nt * 3, np.int32)
        me.loop_triangles.foreach_get('vertices', vi)
        t = co[vi.reshape(-1, 3)]
        tris.append(t)
        tri_obj += [ob.name] * nt
        ev.to_mesh_clear()
    tris = np.concatenate(tris)
    return tris, np.array(tri_obj)


def cam_project(cam_loc, cam_rot, fov_y, w, h, P):
    """Project world points P (n,3) → pixel coords (px, py from bottom), depth; blender camera looks -Z local."""
    R = np.array(Euler(cam_rot, 'XYZ').to_matrix(), np.float64)
    q = (P - np.array(cam_loc)) @ R  # camera-local coords
    z = -q[:, 2]
    if w >= h:
        f = (h / 2) / math.tan(math.radians(fov_y) / 2)
    else:
        f = (w / 2) / math.tan(math.radians(fov_y) / 2)
    with np.errstate(divide='ignore', invalid='ignore'):
        px = q[:, 0] / z * f + w / 2
        py = q[:, 1] / z * f + h / 2
    return px, py, z, f, R


def make_splats(N):
    t_rng = np.random.default_rng(5)
    tris, tobj = gather_triangles()
    a = np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1) * 0.5
    keep = a > 1e-9
    tris, tobj, a = tris[keep], tobj[keep], a[keep]
    nrm = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    A = a.sum()
    print('triangles', len(tris), 'area', A)
    eye = np.array([0, 0, EYE])

    def weight(P):
        d = np.linalg.norm(P - eye, axis=1)
        w = 1.0 / np.maximum(d, 1.1) ** 2
        w = np.maximum(w, 1.0 / 14.0 ** 2)
        w = np.where(P[:, 1] < -0.3, w * 0.25, w)  # behind the hero
        return w

    # uniform candidates with rejection by weight → density rho_u * p
    rho_u = 80000.0  # candidates per m² before rejection (max density)
    cands, cn, cdens = [], [], []
    cdf = np.cumsum(a) / A
    total = int(rho_u * A)
    batch = 4_000_000
    done = 0
    while done < total:
        m = min(batch, total - done)
        ti = np.searchsorted(cdf, t_rng.random(m))
        ti = np.minimum(ti, len(tris) - 1)
        r1, r2 = t_rng.random(m), t_rng.random(m)
        s = np.sqrt(r1)
        bc = np.stack([1 - s, s * (1 - r2), s * r2], 1)
        P = np.einsum('ij,ijk->ik', bc, tris[ti])
        p = np.minimum(weight(P) / 1.0 * 1.0 / (1.0 / 1.1 ** 2), 1.0)
        acc = t_rng.random(m) < p
        cands.append(P[acc]); cn.append(nrm[ti[acc]]); cdens.append(rho_u * p[acc])
        done += m
    P = np.concatenate(cands); Nn = np.concatenate(cn); dens = np.concatenate(cdens)
    print('candidates', len(P))

    # ---- visibility + colour from the rendered views
    best_score = np.full(len(P), -1.0)
    colour = np.zeros((len(P), 3), np.float32)
    seen_hero = np.zeros(len(P), bool)
    for (name, loc, rot, fov, w, h, pri) in views():
        col = load_pixels(os.path.join(WORK, f'{name}_col.png'))
        pos = load_pixels(os.path.join(WORK, f'{name}_pos.exr'))
        px, py, z, f, R = cam_project(loc, rot, fov, w, h, P)
        ix, iy = np.floor(px).astype(np.int64), np.floor(py).astype(np.int64)
        inb = (z > 0.02) & (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        idx = np.where(inb)[0]
        rp = pos[iy[idx], ix[idx], :3] - np.array([5.0, 10.0, 2.0])
        dist = np.linalg.norm(P[idx] - np.array(loc), axis=1)
        foot = dist / f  # metres per pixel
        err = np.linalg.norm(rp - P[idx], axis=1)
        vis = err < (0.008 + 2.5 * foot + 0.004 * dist)
        idx = idx[vis]
        vdir = (np.array(loc) - P[idx]) / dist[vis][:, None]
        cosn = np.abs(np.sum(vdir * Nn[idx], 1))
        score = (0.15 + cosn) / foot[vis] * (50.0 if pri == 2 else 1.0)
        better = score > best_score[idx]
        j = idx[better]
        best_score[j] = score[better]
        colour[j] = col[iy[j], ix[j], :3]
        if pri == 2:
            seen_hero[idx] = True
        print(name, 'visible', len(idx))
    vis = best_score > 0
    print('visible', vis.sum(), 'of', len(P), 'hero', seen_hero.sum())
    P, Nn, dens, colour, hero = P[vis], Nn[vis], dens[vis], colour[vis], seen_hero[vis]

    # subsample to N: most of the budget goes to surfaces the hero view sees; density scales accordingly
    nh = min(int(hero.sum()), int(0.82 * N))
    no = min(int((~hero).sum()), N - nh)
    parts = []
    for mask, k in ((hero, nh), (~hero, no)):
        ids = np.where(mask)[0]
        sel = t_rng.choice(len(ids), k, replace=False)
        parts.append((ids[sel], k / len(ids)))
    sel = np.concatenate([p[0] for p in parts])
    dens = np.concatenate([dens[p[0]] * p[1] for p in parts])
    P, Nn, colour = P[sel], Nn[sel], colour[sel]
    print('hero splats', nh, 'other', no)
    n = len(P)
    sig_t = 0.72 / np.sqrt(dens)
    sig_n = np.maximum(sig_t * 0.12, 0.0008)

    # ---- lantern glow halos (soft, bright, low alpha) ≈ baked bloom
    halos_P, halos_c, halos_s, halos_a = [], [], [], []
    for L in bpy.context.scene['lanterns']:
        c = np.array(L[:3]); r, h = L[3], L[4]; g = np.array(L[5:8]); red = L[8]
        for k in range(40):
            v = t_rng.normal(size=3); v /= np.linalg.norm(v)
            halos_P.append(c + v * np.array([r, r, h / 2]) * t_rng.uniform(0.9, 1.6))
            halos_c.append(np.clip(g * (1.0 if red else 0.95) * 1.0, 0, 1))
            halos_s.append(t_rng.uniform(0.6, 1.1) * r)
            halos_a.append(0.07 if red else 0.05)
    hp = np.array(halos_P); hc = np.array(halos_c); hs = np.array(halos_s); ha = np.array(halos_a)

    # ---- blender → three frame; build orthonormal frames from normals
    def to_three(v, point=True):
        out = np.stack([v[:, 0], v[:, 2] - (EYE if point else 0), -v[:, 1]], 1)
        return out
    Pt = to_three(P)
    nt3 = to_three(Nn, False)
    helper = np.where(np.abs(nt3[:, 1:2]) < 0.9, np.array([[0, 1, 0]]), np.array([[1, 0, 0]]))
    t1 = np.cross(helper, nt3); t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(nt3, t1)
    # random in-plane rotation
    ang = t_rng.uniform(0, 2 * np.pi, n)[:, None]
    t1r = t1 * np.cos(ang) + t2 * np.sin(ang)
    t2r = np.cross(nt3, t1r)
    Rm = np.stack([t1r, t2r, nt3], 2)  # columns
    q = mat_to_quat(Rm)
    scale = np.stack([sig_t, sig_t, sig_n], 1)
    rgba = np.zeros((n, 4), np.uint8)
    rgba[:, :3] = np.clip(np.round(colour * 255), 0, 255)
    rgba[:, 3] = 250

    hpt = to_three(hp)
    hq = np.tile([[1, 0, 0, 0]], (len(hp), 1)).astype(np.float64)
    hscale = np.stack([hs, hs, hs], 1)
    hrgba = np.zeros((len(hp), 4), np.uint8)
    hrgba[:, :3] = np.round(hc * 255); hrgba[:, 3] = np.round(ha * 255)

    allP = np.concatenate([Pt, hpt]).astype(np.float32)
    allS = np.concatenate([scale, hscale]).astype(np.float32)
    allC = np.concatenate([rgba, hrgba])
    allQ = np.concatenate([q, hq]).astype(np.float32)
    perm = t_rng.permutation(len(allP))  # shuffled so any prefix is a uniform subsample (phones)
    sys.path.insert(0, HERE)
    from splatio import write_splat
    out = os.path.join(ROOT, 'public', 'splats', ARGS[2] if len(ARGS) > 2 else 'alley.splat')
    write_splat(out, allP[perm], allS[perm], allC[perm], allQ[perm])
    print('wrote', out, len(allP), 'splats', os.path.getsize(out) / 1e6, 'MB')
    print('bounds', allP.min(0), allP.max(0))


def mat_to_quat(R):
    """R (n,3,3) rotation matrices → quaternions (w,x,y,z)."""
    m00, m11, m22 = R[:, 0, 0], R[:, 1, 1], R[:, 2, 2]
    tr = m00 + m11 + m22
    q = np.zeros((len(R), 4))
    c0 = tr > 0
    s = np.sqrt(np.maximum(tr + 1, 1e-12)) * 2
    q[c0] = np.stack([0.25 * s, (R[:, 2, 1] - R[:, 1, 2]) / s, (R[:, 0, 2] - R[:, 2, 0]) / s, (R[:, 1, 0] - R[:, 0, 1]) / s], 1)[c0]
    c1 = (~c0) & (m00 > m11) & (m00 > m22)
    s = np.sqrt(np.maximum(1 + m00 - m11 - m22, 1e-12)) * 2
    q[c1] = np.stack([(R[:, 2, 1] - R[:, 1, 2]) / s, 0.25 * s, (R[:, 0, 1] + R[:, 1, 0]) / s, (R[:, 0, 2] + R[:, 2, 0]) / s], 1)[c1]
    c2 = (~c0) & (~c1) & (m11 > m22)
    s = np.sqrt(np.maximum(1 + m11 - m00 - m22, 1e-12)) * 2
    q[c2] = np.stack([(R[:, 0, 2] - R[:, 2, 0]) / s, (R[:, 0, 1] + R[:, 1, 0]) / s, 0.25 * s, (R[:, 1, 2] + R[:, 2, 1]) / s], 1)[c2]
    c3 = (~c0) & (~c1) & (~c2)
    s = np.sqrt(np.maximum(1 + m22 - m00 - m11, 1e-12)) * 2
    q[c3] = np.stack([(R[:, 1, 0] - R[:, 0, 1]) / s, (R[:, 0, 2] + R[:, 2, 0]) / s, (R[:, 1, 2] + R[:, 2, 1]) / s, 0.25 * s], 1)[c3]
    # self-check against R
    w, x, y, z = q.T
    R2 = np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
                   2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
                   2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], 1).reshape(-1, 3, 3)
    assert np.abs(R2 - R).max() < 1e-4, np.abs(R2 - R).max()
    return q


if STAGE == 'build':
    build()
elif STAGE == 'preview':
    render_views(preview=True)
elif STAGE == 'render':
    render_views()
elif STAGE == 'splat':
    make_splats(int(ARGS[1]) if len(ARGS) > 1 else 450_000)
