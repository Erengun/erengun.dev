"""
Bakes what runs across the /qr/ page's Istanbul (same box as tools/qr-istanbul-map.py):
  public/qr/istanbul-roads.png   512 × 512, grey: the real main roads and squares (brighter = more of a road there)
  public/qr/istanbul-lines.json  {"roads": [...], "tram": [...], "ferries": [...]}: lines as [lon, lat] lists, for the
                                 taxis, the T1 tram and the ferries to follow
Sources (© OpenStreetMap contributors, ODbL), all Overpass, bbox 40.987,28.945,41.063,29.045:
  roads.json  way highway ~ motorway|trunk|primary|secondary|tertiary; out geom tags;
  tram.json   way railway=tram; out geom tags;
  ferry.json  way route=ferry (a wider box); out geom tags;
  open.json   place=square, pedestrian areas; out geom tags;
Run: python3 tools/qr-istanbul-lines.py <dir with the four files> public/qr
"""
import json, math, sys
from PIL import Image, ImageDraw, ImageFilter

LON0, LON1, LAT0, LAT1 = 28.945, 29.045, 40.987, 41.063
N = 512
src, out = sys.argv[1], sys.argv[2]
X = lambda lon: (lon - LON0) / (LON1 - LON0) * N
Y = lambda lat: (LAT1 - lat) / (LAT1 - LAT0) * N
KX = 111320 * math.cos(math.radians(41.02)); KY = 110540  # metres per degree
metres = lambda a, b: math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)
inside = lambda p, pad=0.0: LON0 - pad <= p[0] <= LON1 + pad and LAT0 - pad <= p[1] <= LAT1 + pad
length = lambda line: sum(metres(a, b) for a, b in zip(line, line[1:]))

def simplify(line, tol):
    if len(line) < 3: return line
    a, b = line[0], line[-1]
    ax, ay, bx, by = a[0] * KX, a[1] * KY, b[0] * KX, b[1] * KY
    L = math.hypot(bx - ax, by - ay)
    worst, at = 0, 0
    for i in range(1, len(line) - 1):
        px, py = line[i][0] * KX, line[i][1] * KY
        t = max(0, min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (L * L))) if L > 1 else 0
        d = math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
        if d > worst: worst, at = d, i
    if worst <= tol: return [a, b]
    return simplify(line[:at + 1], tol)[:-1] + simplify(line[at:], tol)

def chain(ways, snap=25, directed=False):
    """join ways end to end into as long lines as they make (directed: only an end onto a start, as one-way tracks run)"""
    lines = [list(w) for w in ways if len(w) > 1]
    joined = True
    while joined:
        joined = False
        for i in range(len(lines)):
            for j in range(len(lines)):
                if i == j: continue
                a, b = lines[i], lines[j]
                ahead = (a[-1][0] - a[-2][0]) * (b[1][0] - b[0][0]) * KX * KX + (a[-1][1] - a[-2][1]) * (b[1][1] - b[0][1]) * KY * KY > 0
                if metres(a[-1], b[0]) < snap and (ahead or not directed): lines[i] = a + b[1:]  # (a track does not turn back on itself)
                elif directed: continue
                elif metres(a[-1], b[-1]) < snap: lines[i] = a + b[::-1][1:]
                elif metres(a[0], b[-1]) < snap: lines[i] = b + a[1:]
                elif metres(a[0], b[0]) < snap: lines[i] = b[::-1] + a[1:]
                else: continue
                del lines[j]; joined = True; break
            if joined: break
    return lines
def clip(line, pad=0.0):
    """the longest run of the line that is inside the box"""
    best, run = [], []
    for p in line:
        if inside(p, pad): run.append(p)
        else:
            if len(run) > len(best): best = run
            run = []
    return run if len(run) > len(best) else best
geom = lambda e: [(p['lon'], p['lat']) for p in e['geometry']]

# ---- the picture of the roads
img = Image.new('L', (N, N), 0)
d = ImageDraw.Draw(img)
roads = json.load(open(f'{src}/roads.json'))['elements']
W = {'motorway': 5, 'trunk': 5, 'primary': 4, 'secondary': 3, 'tertiary': 2}
V = {'motorway': 255, 'trunk': 255, 'primary': 255, 'secondary': 215, 'tertiary': 170}
for kind in ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']:
    for e in roads:
        t = e['tags']
        if t['highway'] != kind or t.get('tunnel') in ('yes', 'building_passage'): continue
        d.line([(X(a), Y(b)) for a, b in geom(e)], fill=V[kind], width=W[kind], joint='curve')
for e in json.load(open(f'{src}/open.json'))['elements']:
    t = e.get('tags', {})
    if e['type'] == 'way' and (t.get('place') == 'square' or t.get('highway') == 'pedestrian') and len(e['geometry']) > 2:
        d.polygon([(X(a), Y(b)) for a, b in geom(e)], fill=235)
img.filter(ImageFilter.GaussianBlur(0.7)).save(f'{out}/istanbul-roads.png', optimize=True)

# ---- lines to drive, ride and sail along
by_name = {}
for e in roads:
    t = e['tags']
    if t['highway'] in ('motorway', 'trunk', 'primary', 'secondary') and t.get('name') and t.get('tunnel') != 'yes':
        by_name.setdefault(t['name'], []).append(geom(e))
drive = []
for name, ways in by_name.items():
    for line in chain(ways, 25, True):  # one carriageway at a time
        line = clip(line)
        if len(line) > 1 and length(line) > 900: drive.append((length(line), name, simplify(line, 12)))
drive.sort(reverse=True)
picked, seen = [], {}
for L, name, line in drive:  # the longest stretch of each street, the 16 longest streets
    if seen.get(name): continue
    seen[name] = 1; picked.append((name, line))
    if len(picked) == 16: break

tram = json.load(open(f'{src}/tram.json'))['elements']
# the T1 line (Kabataş – Sultanahmet – Bağcılar): its tracks, one direction, as far as the box goes
tracks = [l for l in (clip(l) for l in chain([geom(e) for e in tram if e['type'] == 'way' and e['tags'].get('name', '').startswith('T1')], 40, True)) if len(l) > 1]
t1 = max(tracks, key=length)

ferries = []
for e in json.load(open(f'{src}/ferry.json'))['elements']:
    if e['type'] != 'way': continue
    line = clip(geom(e), 0.0)
    if len(line) > 1 and length(line) > 1200: ferries.append((length(line), e['tags'].get('name', ''), simplify(line, 25)))
ferries.sort(reverse=True)
kept = []
for L, name, line in ferries:  # not two that run side by side
    mid = line[len(line) // 2]
    if all(metres(mid, k[1][len(k[1]) // 2]) > 500 for k in kept): kept.append((name, line))
    if len(kept) == 8: break

rnd = lambda line: [[round(a, 5), round(b, 5)] for a, b in line]
json.dump({'roads': [rnd(l) for _, l in picked], 'tram': rnd(simplify(t1, 8)), 'ferries': [rnd(l) for _, l in kept]}, open(f'{out}/istanbul-lines.json', 'w'), separators=(',', ':'))
print('roads:', [(n, round(length(l))) for n, l in picked])
print('tram T1:', round(length(t1)), 'm,', len(simplify(t1, 8)), 'points')
print('ferries:', [(n[:28], round(length(l))) for n, l in kept])
