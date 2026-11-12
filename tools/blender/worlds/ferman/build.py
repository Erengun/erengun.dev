# Ferman world: vaulted hall, scroll rollers, wax seal and devices (all original geometry).
# Run: /opt/homebrew/bin/blender -b -P tools/blender/worlds/ferman/build.py
# Output: public/worlds/ferman/ferman.glb with meshes
#   Bay (one 4 m hall bay, instanced along z), Back (end wall with the great arch), Tiers (device plinths),
#   RollerTop, RollerBottom, Seal, Phone, Tablet, Laptop
#
# Everything is authored in three.js coordinates (y up, the hall runs along -z toward the scroll at z = 0) and
# converted to Blender's z-up on the way in; the glTF exporter converts back (export_yup).
# Vertex colour "Col" (linear RGBA): rgb = albedo, a = material class for the runtime shader:
#   0.0 stone, 0.2 dark recess, 0.4 floor marble, 0.6 gold metal, 0.8 lacquer/glass (glossy), 1.0 emissive window
import bpy, bmesh, math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../public/worlds/ferman/ferman.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)

HW = 7.6        # hall half width (inner wall face)
BAY = 4.0       # bay length
WALL_TOP = 9.0  # springing of the vault
VAULT_UP = 5.2  # vault rise

STONE = (0.075, 0.095, 0.16, 0.0)
STONE_D = (0.04, 0.052, 0.095, 0.0)
RECESS = (0.025, 0.035, 0.075, 0.2)
FLOOR = (0.06, 0.07, 0.11, 0.4)
GOLD = (0.80, 0.50, 0.16, 0.6)
GOLD_D = (0.45, 0.27, 0.08, 0.6)
GOLD_DD = (0.22, 0.13, 0.04, 0.6)
WOOD = (0.16, 0.07, 0.035, 0.8)
WAX = (0.30, 0.025, 0.03, 0.8)
BODY = (0.035, 0.04, 0.05, 0.8)
WINDOW = (0.55, 0.70, 1.0, 1.0)

parts = {}  # mesh name -> list of (verts, faces, col, smooth)


def add(name, verts, faces, col, smooth=False):
    parts.setdefault(name, []).append((verts, faces, col, smooth))


def box(name, x0, x1, y0, y1, z0, z1, col):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    add(name, v, f, col)


def ring_strip(name, a, b, col, smooth=False):
    """quad strip between two equally long polylines a and b (three coords)"""
    n = len(a)
    v = list(a) + list(b)
    f = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    add(name, v, f, col, smooth)


def pointed(span, y0, rise_k=0.82, n=14, cx=0.0):
    """pointed (two-centred) arch polyline in the plane, from the left springing over the apex to the right"""
    R = span * rise_k
    c = -span / 2 + R  # left arc centre x (relative)
    th1 = math.acos(-c / R) if abs(c / R) <= 1 else math.pi / 2
    left = [(cx + c + R * math.cos(math.pi - (math.pi - th1) * i / n), y0 + R * math.sin(math.pi - (math.pi - th1) * i / n)) for i in range(n + 1)]
    right = [(2 * cx - x, y) for (x, y) in reversed(left[:-1])]
    return left + right


def arched_wall(name, plane, depth0, depth1, u0, u1, y0, y1, span, spring, col, rise_k=0.82, n=14):
    """wall panel (u in [u0,u1] along the wall, y in [y0,y1]) with a pointed opening from y0 up.
    plane: 'x' -> u is z, depth is x;  'z' -> u is x, depth is z."""
    cu = (u0 + u1) / 2
    arch = pointed(span, spring, rise_k, n, cu)
    inner = [(cu - span / 2, y0)] + arch + [(cu + span / 2, y0)]
    m = len(inner)
    # boundary points of the rectangle, walked the same way (left edge up, top, right edge down)
    per = 2 * (y1 - y0) + (u1 - u0)
    outer = []
    for i in range(m):
        s = per * i / (m - 1)
        if s <= (y1 - y0):
            outer.append((u0, y0 + s))
        elif s <= (y1 - y0) + (u1 - u0):
            outer.append((u0 + s - (y1 - y0), y1))
        else:
            outer.append((u1, y1 - (s - (y1 - y0) - (u1 - u0))))

    def P(u, y, d):
        return (d, y, u) if plane == 'x' else (u, y, d)
    for d in (depth0, depth1):
        ring_strip(name, [P(u, y, d) for (u, y) in outer], [P(u, y, d) for (u, y) in inner], col)
    # reveal (the opening's soffit)
    ring_strip(name, [P(u, y, depth0) for (u, y) in inner], [P(u, y, depth1) for (u, y) in inner], col)
    return inner


def arch_band(name, plane, depth0, depth1, span, spring, width, col, cu=0.0, rise_k=0.82, n=14):
    a = pointed(span, spring, rise_k, n, cu)
    b = pointed(span + 2 * width, spring, (span * rise_k + width) / (span + 2 * width), n, cu)

    def P(u, y, d):
        return (d, y, u) if plane == 'x' else (u, y, d)
    ring_strip(name, [P(u, y, depth0) for (u, y) in b], [P(u, y, depth0) for (u, y) in a], col)
    ring_strip(name, [P(u, y, depth0) for (u, y) in a], [P(u, y, depth1) for (u, y) in a], col)
    ring_strip(name, [P(u, y, depth1) for (u, y) in b], [P(u, y, depth0) for (u, y) in b], col)


def lathe(name, prof, col, axis='y', c=(0, 0, 0), segs=20, smooth=True):
    """profile [(r, h)] revolved about an axis through c"""
    v = []
    for (r, h) in prof:
        for k in range(segs):
            t = 2 * math.pi * k / segs
            a, b = r * math.cos(t), r * math.sin(t)
            if axis == 'y':
                v.append((c[0] + a, c[1] + h, c[2] + b))
            elif axis == 'x':
                v.append((c[0] + h, c[1] + a, c[2] + b))
            else:
                v.append((c[0] + a, c[1] + b, c[2] + h))
    f = []
    for i in range(len(prof) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            q = (i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k)
            f.append(q if axis != 'x' else tuple(reversed(q)))
    add(name, v, f, col, smooth)


# ------------------------------------------------------------------ hall bay (z in [-2, 2])
for s in (-1, 1):
    X = lambda x: s * x
    # niche back wall + emissive high window
    box('Bay', min(X(HW + 0.9), X(HW + 1.1)), max(X(HW + 0.9), X(HW + 1.1)), 0, WALL_TOP + 0.2, -2, 2, RECESS)
    win = pointed(0.9, 6.3, 0.75, 8, 0.0)
    wv = [(X(HW + 0.88), 5.0, -0.45)] + [(X(HW + 0.88), y, u) for (u, y) in win] + [(X(HW + 0.88), 5.0, 0.45)]
    add('Bay', wv, [tuple(range(len(wv)))] if s < 0 else [tuple(reversed(range(len(wv))))], WINDOW)
    # arched front wall between the piers
    arched_wall('Bay', 'x', X(HW), X(HW + 0.5), -2, 2, 0.0, WALL_TOP, 2.9, 5.0, STONE)
    arch_band('Bay', 'x', X(HW - 0.04), X(HW + 0.2), 2.9, 5.0, 0.12, GOLD_D)
    # columns at the bay boundary
    lathe('Bay', [(0.42, 0), (0.42, 0.35), (0.3, 0.45), (0.27, 0.6), (0.24, 4.6), (0.3, 4.75), (0.46, 5.05), (0.46, 5.2), (0.0, 5.21)],
          STONE, 'y', (X(HW - 0.2), 0, -2.0), 16)
    for hb in (0.62, 2.6, 4.45):
        lathe('Bay', [(0.0, hb - 0.001), (0.285, hb), (0.285, hb + 0.07), (0.0, hb + 0.071)], GOLD_D, 'y', (X(HW - 0.2), 0, -2.0), 16)
    box('Bay', X(HW - 0.5) if s > 0 else X(HW + 0.1), X(HW + 0.1) if s > 0 else X(HW - 0.5), 5.2, 5.4, -2.35, -1.65, GOLD_D)
    # dado + cornice
    box('Bay', X(HW - 0.12) if s > 0 else X(HW + 0.5), X(HW + 0.5) if s > 0 else X(HW - 0.12), 0, 0.55, -2, 2, STONE_D)
    box('Bay', X(HW - 0.3) if s > 0 else X(HW + 0.5), X(HW + 0.5) if s > 0 else X(HW - 0.3), WALL_TOP - 0.25, WALL_TOP, -2, 2, GOLD_D)

# floor
box('Bay', -HW - 1, HW + 1, -0.3, 0.0, -2, 2, FLOOR)
# pointed barrel vault (inside surface) + one rib per bay
vault = pointed(2 * HW, WALL_TOP, 0.56, 20, 0.0)
ring_strip('Bay', [(x, y, 2.0) for (x, y) in vault], [(x, y, -2.0) for (x, y) in vault], STONE_D, True)
rib_o = pointed(2 * HW - 0.4, WALL_TOP, (2 * HW * 0.56 - 0.2) / (2 * HW - 0.4), 20, 0.0)
for zz in (-2.0,):
    ring_strip('Bay', [(x, y, zz + 0.18) for (x, y) in rib_o], [(x, y, zz - 0.18) for (x, y) in rib_o], GOLD_D, True)
    ring_strip('Bay', [(x, y, zz - 0.18) for (x, y) in vault], [(x, y, zz - 0.18) for (x, y) in rib_o], GOLD_D)
    ring_strip('Bay', [(x, y, zz + 0.18) for (x, y) in rib_o], [(x, y, zz + 0.18) for (x, y) in vault], GOLD_D)

# ------------------------------------------------------------------ end wall with the great arch (behind the scroll)
ZB = -2.6
arched_wall('Back', 'z', ZB, ZB - 0.6, -HW - 1, HW + 1, 0.0, 19.0, 6.6, 7.2, STONE)
arch_band('Back', 'z', ZB + 0.06, ZB - 0.3, 6.6, 7.2, 0.22, GOLD)
arch_band('Back', 'z', ZB + 0.04, ZB - 0.3, 7.4, 7.2, 0.1, GOLD_D)
# deep recess
box('Back', -3.6, 3.6, 0, 13.5, ZB - 2.4, ZB - 2.2, RECESS)
box('Back', -3.6, -3.3, 0, 13.5, ZB - 2.4, ZB - 0.6, RECESS)
box('Back', 3.3, 3.6, 0, 13.5, ZB - 2.4, ZB - 0.6, RECESS)
# stepped (muqarnas-like) cornice at the springing inside the recess: three rows of little cells
for row in range(3):
    n = 12 - row * 2
    w = 6.4 - row * 0.8
    for i in range(n):
        x0 = -w / 2 + w * i / n
        box('Back', x0 + 0.03, x0 + w / n - 0.03, 7.0 + row * 0.35, 7.3 + row * 0.35, ZB - 2.2, ZB - 1.9 + row * 0.25, GOLD_D if (i + row) % 2 else GOLD)
# flanking device cabinets (niche shelves the rollout lands on). Must match CAB_* in src/scene/worlds/ferman*.ts
CAB_A, CAB_B = 1.95, 4.25      # |x| range
CAB_Y0, CAB_DY, CAB_ROWS = 3.0, 0.92, 4
CAB_Z0, CAB_Z1 = -1.35, -0.6   # back, front
for s in (-1, 1):
    xa, xb = (CAB_A, CAB_B) if s > 0 else (-CAB_B, -CAB_A)
    ytop = CAB_Y0 + CAB_DY * CAB_ROWS
    # plinth under the cabinet, with a gold band
    box('Back', xa - 0.06, xb + 0.06, 0, CAB_Y0 - 0.05, CAB_Z0 - 0.05, CAB_Z1 + 0.06, STONE)
    box('Back', xa - 0.08, xb + 0.08, CAB_Y0 - 0.5, CAB_Y0 - 0.42, CAB_Z1 + 0.04, CAB_Z1 + 0.09, GOLD_D)
    # back panel (deep navy recess)
    box('Back', xa, xb, CAB_Y0 - 0.05, ytop, CAB_Z0 - 0.08, CAB_Z0, RECESS)
    # uprights: outer two and the middle one, with gold front strips
    xm = (xa + xb) / 2
    for (u0, u1) in ((xa, xa + 0.09), (xm - 0.045, xm + 0.045), (xb - 0.09, xb)):
        box('Back', u0, u1, CAB_Y0 - 0.05, ytop, CAB_Z0, CAB_Z1, STONE_D)
        box('Back', u0 + 0.025, u1 - 0.025, CAB_Y0 - 0.05, ytop, CAB_Z1, CAB_Z1 + 0.02, GOLD_DD)
    # boards with gold nosing, and a pointed niche arch at the top of every cell
    for k in range(CAB_ROWS + 1):
        y = CAB_Y0 + CAB_DY * k
        box('Back', xa, xb, y - 0.05, y, CAB_Z0, CAB_Z1, STONE_D)
        box('Back', xa - 0.01, xb + 0.01, y - 0.06, y + 0.005, CAB_Z1, CAB_Z1 + 0.035, GOLD_D)
    cw = (xb - xa) / 2
    for k in range(CAB_ROWS):
        ytopc = CAB_Y0 + CAB_DY * (k + 1) - 0.05
        for c in range(2):
            cu = xa + cw * (c + 0.5)
            span = cw - 0.12
            spring = ytopc - span * 0.62 - 0.02
            arch_band('Back', 'z', CAB_Z1 + 0.012, CAB_Z1 - 0.05, span, spring, 0.03, GOLD_DD, cu, 0.62, 10)
    # crown: stepped cornice and a pointed gable
    box('Back', xa - 0.12, xb + 0.12, ytop, ytop + 0.14, CAB_Z0 - 0.08, CAB_Z1 + 0.1, STONE_D)
    box('Back', xa - 0.14, xb + 0.14, ytop + 0.14, ytop + 0.2, CAB_Z0 - 0.08, CAB_Z1 + 0.12, GOLD)
    for i in range(9):
        x0 = xa + (xb - xa) * i / 9
        box('Back', x0 + 0.03, x0 + (xb - xa) / 9 - 0.03, ytop + 0.2, ytop + 0.36, CAB_Z1 - 0.1, CAB_Z1 + 0.04, GOLD_D if i % 2 else GOLD)
# gilded beam the scroll hangs from
box('Back', -2.6, 2.6, 9.85, 10.1, -0.2, 0.15, GOLD_D)
for s in (-1, 1):
    lathe('Back', [(0.0, 0), (0.14, 0.05), (0.16, 0.2), (0.09, 0.32), (0.0, 0.45)], GOLD, 'x', (s * 2.6 if s > 0 else -2.6 - 0.45, 9.97, -0.02), 12)

# ------------------------------------------------------------------ tiers (device plinths)
def plinth(x0, x1, y1, z0, z1):
    box('Tiers', x0, x1, 0, y1, z0, z1, STONE_D)
    # gold nosing along the front edge facing the aisle / camera
    box('Tiers', x0 - 0.02, x1 + 0.02, y1 - 0.06, y1 + 0.02, z1 - 0.06, z1 + 0.02, GOLD_D)


for s in (-1, 1):
    # flank amphitheatre next to the scroll (3 steps rising outward and back)
    for k in range(3):
        xa, xb = 2.35 + 1.45 * k, 7.0
        x0, x1 = (xa, xb) if s > 0 else (-xb, -xa)
        plinth(x0, x1, 0.55 + 0.7 * k, -2.5, 1.2 - 0.9 * k)
    # aisle rows
    for k in range(2):
        xa, xb = 3.3 + 1.5 * k, 7.2
        x0, x1 = (xa, xb) if s > 0 else (-xb, -xa)
        box('Tiers', x0, x1, 0, 0.45 + 0.6 * k, 3.0, 23.0, STONE_D)
        e = xa if s > 0 else -xa
        box('Tiers', e - 0.04, e + 0.04, 0.39 + 0.6 * k, 0.47 + 0.6 * k, 3.0, 23.0, GOLD_D)

# ------------------------------------------------------------------ scroll rollers (paper width 3.5)
fin = [(0.0, 0), (0.1, 0.02), (0.13, 0.08), (0.085, 0.14), (0.16, 0.24), (0.17, 0.32), (0.11, 0.42), (0.05, 0.5), (0.025, 0.58), (0.0, 0.62)]
lathe('RollerTop', [(0.09, -1.8), (0.09, 1.8)], WOOD, 'x', (0, 0, 0), 20)
lathe('RollerTop', fin, GOLD, 'x', (1.8, 0, 0), 16)
lathe('RollerTop', [(r, -h) for (r, h) in fin], GOLD, 'x', (-1.8, 0, 0), 16)
for s in (-1, 1):  # cords up to the beam
    lathe('RollerTop', [(0.018, 0), (0.018, 1.5)], GOLD_D, 'y', (s * 1.95, 0.0, 0.0), 6)
lathe('RollerBottom', [(0.075, -1.8), (0.075, 1.8)], WOOD, 'x', (0, 0, 0), 20)
fin2 = [(r * 0.85, h * 0.8) for (r, h) in fin]
lathe('RollerBottom', fin2, GOLD, 'x', (1.8, 0, 0), 16)
lathe('RollerBottom', [(r, -h) for (r, h) in fin2], GOLD, 'x', (-1.8, 0, 0), 16)

# ------------------------------------------------------------------ seal: wax disc with an eight-fold relief, gold rim, ribbons
# local frame: disc faces +z, centre at origin
lathe('Seal', [(0.0, 0.07), (0.1, 0.075), (0.2, 0.06), (0.27, 0.05), (0.3, 0.035), (0.31, 0.0)], WAX, 'z', (0, 0, 0), 32)
lathe('Seal', [(0.2, 0.062), (0.215, 0.075), (0.23, 0.062)], GOLD, 'z', (0, 0, 0), 32)
for k in range(8):
    a = k * math.pi / 4
    ca, sa = math.cos(a), math.sin(a)
    pts = [(0.0, 0.0), (0.07, 0.03), (0.17, 0.0), (0.07, -0.03)]
    v = [(px * ca - py * sa, px * sa + py * ca, 0.085) for (px, py) in pts] + [(0, 0, 0.075)]
    add('Seal', v, [(0, 1, 2, 3)], GOLD)
for (dy, ex, ey) in ((0.08, 0.62, 0.0), (-0.06, 0.55, -0.22)):
    add('Seal', [(0.12, dy + 0.05, -0.01), (0.12, dy - 0.05, -0.01), (ex, ey - 0.06, -0.01), (ex - 0.05, ey + 0.05, -0.01)],
        [(3, 2, 1, 0)], GOLD_D)

# ------------------------------------------------------------------ devices (screen faces +z; screens are added at runtime)
def rbox(name, w, h, d, cx, cy, cz, col, r=0.04, n=4):
    """box rounded in its xy outline (rounded-rect prism along z)"""
    out = []
    for (qx, qy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            out.append((cx + qx + r * math.cos(a), cy + qy + r * math.sin(a)))
    m = len(out)
    v = [(x, y, cz + d / 2) for (x, y) in out] + [(x, y, cz - d / 2) for (x, y) in out]
    f = [tuple(range(m)), tuple(reversed(range(m, 2 * m)))]
    f += [(i, m + i, m + (i + 1) % m, (i + 1) % m) for i in range(m)]
    add(name, v, f, col)


# phone 0.5 x 1.0 on a little gold easel
rbox('Phone', 0.5, 1.0, 0.05, 0, 0.62, 0, BODY, 0.07)
box('Phone', -0.2, 0.2, 0.0, 0.06, -0.2, 0.12, GOLD_D)
box('Phone', -0.04, 0.04, 0.0, 0.7, -0.12, -0.03, GOLD_D)
# tablet 1.05 x 0.76
rbox('Tablet', 1.06, 0.76, 0.045, 0, 0.5, 0, BODY, 0.05)
box('Tablet', -0.35, 0.35, 0.0, 0.06, -0.25, 0.1, GOLD_D)
box('Tablet', -0.05, 0.05, 0.0, 0.55, -0.16, -0.03, GOLD_D)
# laptop: base 1.2 x 0.82, lid 1.2 x 0.8 hinged at z = -0.4, leaning back 15 deg
box('Laptop', -0.6, 0.6, 0.0, 0.04, -0.4, 0.42, BODY)
box('Laptop', -0.5, 0.5, 0.04, 0.045, -0.3, 0.1, (0.07, 0.075, 0.09, 0.8))
t = math.radians(15)
rbox('Laptop', 1.2, 0.8, 0.03, 0, 0.42, 0, BODY, 0.03)
lv, lf, lc, ls = parts['Laptop'][-1]
vv = []
for (x, y, z) in lv:  # hinge about x at (y = .04, z = -.4), leaning back by t
    yy = y - 0.02
    vv.append((x, 0.04 + yy * math.cos(t) + z * math.sin(t), -0.4 - yy * math.sin(t) + z * math.cos(t)))
parts['Laptop'][-1] = (vv, lf, lc, ls)

# ------------------------------------------------------------------ build the meshes
def B(p):
    return (p[0], -p[2], p[1])


mat = bpy.data.materials.new('Ferman')
for name, plist in parts.items():
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    cl = bm.loops.layers.float_color.new('Col')
    for (verts, faces, col, smooth) in plist:
        bv = [bm.verts.new(B(p)) for p in verts]
        for f in faces:
            try:
                face = bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            face.smooth = smooth
            for l in face.loops:
                l[cl] = col
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = 0
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    print(name, 'tris', len(me.polygons))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT), export_format='GLB', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_animations=False, export_skins=False, export_materials='EXPORT', export_normals=True, export_texcoords=False,
    export_draco_mesh_compression_enable=False, export_yup=True,
)
print('WROTE', os.path.abspath(OUT), os.path.getsize(OUT))
