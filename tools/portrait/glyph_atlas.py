"""
Bake the dot-font glyph atlas for the dot-matrix intro from the site's own OffBit-DotBold font.
  python glyph_atlas.py <font.ttf> <out.png>
Layout: 8 x 4 cells of 48 px; index 0..9 = luma ramp (dark → bright), 10..31 = letters/symbols used for scramble
and the "EREN GÜN" fragments. Alpha = glyph coverage (white on transparent).
"""
import sys
from PIL import Image, ImageDraw, ImageFont
GLYPHS = list(" .:-=+*#%@") + list("ERENGÜN<>/{}[]01;$&?!XZ")
CELL, COLS, ROWS = 48, 8, 4
font = ImageFont.truetype(sys.argv[1], 40)
im = Image.new('LA', (CELL * COLS, CELL * ROWS), (255, 0))
d = ImageDraw.Draw(im)
for i, ch in enumerate(GLYPHS[:COLS * ROWS]):
    cx, cy = (i % COLS) * CELL + CELL / 2, (i // COLS) * CELL + CELL / 2
    d.text((cx, cy), ch, font=font, fill=(255, 255), anchor='mm')
im.save(sys.argv[2])
print(len(GLYPHS), ''.join(GLYPHS))
