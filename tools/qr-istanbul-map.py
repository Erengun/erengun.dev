"""
Bakes the map the /qr/ page draws its Istanbul from: public/qr/istanbul.png, 256 × 256, north up, covering
lon 28.945–29.045, lat 40.987–41.063 (about 8.4 km square).
  R  signed distance to the real coastline (128 = the shore, above = land; 2.5 units per pixel)
  G  parks, woods and cemeteries
  B  terrain height in metres × 2 (0 at sea)
Sources (© OpenStreetMap contributors, ODbL; SRTM 30 m via opentopodata.org):
  coast.json   Overpass: way["natural"="coastline"](40.96,28.92,41.09,29.07); out geom;
  parks.json   Overpass: way/relation leisure=park, way landuse~cemetery|forest, way natural=wood in the box; out geom;
  elev.json    {"G": 26, "elev": [...]}: SRTM heights on a 26 × 26 grid of the box, row by row from the north-west
Run: python3 tools/qr-istanbul-map.py <dir with the three files> public/qr/istanbul.png
"""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

LON0, LON1, LAT0, LAT1 = 28.945, 29.045, 40.987, 41.063
N = 256
src, out = sys.argv[1], sys.argv[2]

segs = []
for w in json.load(open(f'{src}/coast.json'))['elements']:
    g = w['geometry']
    segs += [(a['lon'], a['lat'], b['lon'], b['lat']) for a, b in zip(g, g[1:])]
S = np.array(segs)
cx = math.cos(math.radians(41.02))
ax, ay, bx, by = S[:, 0] * cx, S[:, 1], S[:, 2] * cx, S[:, 3]
dx, dy = bx - ax, by - ay
L2 = dx * dx + dy * dy + 1e-18
px_deg = (LAT1 - LAT0) / N  # one pixel, in degrees of latitude
sdf = np.zeros((N, N))
for r in range(N):
    lat = LAT1 - (r + .5) / N * (LAT1 - LAT0)
    for c in range(N):
        px = (LON0 + (c + .5) / N * (LON1 - LON0)) * cx
        t = np.clip(((px - ax) * dx + (lat - ay) * dy) / L2, 0, 1)
        dist = (px - (ax + t * dx)) ** 2 + (lat - (ay + t * dy)) ** 2
        i = int(np.argmin(dist))
        # at a shared vertex, the segment whose side the point is most clearly on decides
        near = np.where(dist <= dist[i] * 1.0000001 + 1e-16)[0]
        j = max(near, key=lambda k: abs(dx[k] * (lat - ay[k]) - dy[k] * (px - ax[k])) / math.sqrt(L2[k]))
        land = dx[j] * (lat - ay[j]) - dy[j] * (px - ax[j]) > 0  # OSM coastlines keep the land on their left
        sdf[r, c] = (1 if land else -1) * math.sqrt(dist[i]) / px_deg
R = np.clip(128 + sdf * 2.5, 0, 255).astype('uint8')

X = lambda lon: (lon - LON0) / (LON1 - LON0) * N
Y = lambda lat: (LAT1 - lat) / (LAT1 - LAT0) * N
parks = Image.new('L', (N, N), 0)
draw = ImageDraw.Draw(parks)
for e in json.load(open(f'{src}/parks.json'))['elements']:
    rings = [e['geometry']] if e['type'] == 'way' else [m['geometry'] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
    for g in rings:
        if len(g) >= 3: draw.polygon([(X(p['lon']), Y(p['lat'])) for p in g], fill=255)
G = np.array(parks.filter(ImageFilter.GaussianBlur(0.6))) * (sdf > 0)

e = json.load(open(f'{src}/elev.json'))
grid = np.array([max(0, v or 0) for v in e['elev']], dtype='float32').reshape(e['G'], e['G'])
B = np.array(Image.fromarray(grid).resize((N, N), Image.BICUBIC))
B = np.clip(B * 2, 0, 255) * np.clip(sdf / 6, 0, 1)  # down to the water at the shore

Image.fromarray(np.dstack([R, G.astype('uint8'), B.astype('uint8')])).save(out, optimize=True)
print('land', round(float((sdf > 0).mean()), 3), 'parks', round(float((G > 127).mean()), 3), 'highest', float(B.max()) / 2, 'm')
