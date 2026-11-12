"""Procedural sign / poster / lantern textures for the alley scene (original text and art).
Run with system python: python3 -I tools/blender/alley/make_textures.py"""
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex')
os.makedirs(OUT, exist_ok=True)
GOTHIC = '/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc'
GOTHIC_M = '/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc'
MINCHO = '/System/Library/Fonts/ヒラギノ明朝 ProN.ttc'
MARU = '/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc'
rng = random.Random(7)


def font(path, size):
    return ImageFont.truetype(path, size)


def grime(img, amount=40, seed=0):
    r = random.Random(seed)
    w, h = img.size
    g = Image.new('L', (w // 8, h // 8))
    gd = g.load()
    for y in range(h // 8):
        for x in range(w // 8):
            gd[x, y] = int(r.random() * amount)
    g = g.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))
    dark = Image.new('RGB', (w, h), (30, 20, 10))
    return Image.composite(dark, img, g)


def vtext(d, x, y, s, f, fill, step=None):
    step = step or int(f.size * 1.08)
    for i, ch in enumerate(s):
        d.text((x, y + i * step), ch, font=f, fill=fill, anchor='mt')


def save(img, name):
    img.save(os.path.join(OUT, name + '.png'))


# 1 big horizontal board (cream, red + black text) -----------------------------------------
im = Image.new('RGB', (1024, 384), (236, 222, 190))
d = ImageDraw.Draw(im)
d.rectangle([10, 10, 1013, 373], outline=(150, 30, 20), width=10)
d.text((60, 70), '炭火焼', font=font(MINCHO, 120), fill=(170, 25, 20))
d.text((470, 40), '鳥げん', font=font(GOTHIC, 190), fill=(30, 20, 15))
d.text((70, 260), 'TEL 03-0000-1192   創業 昭和三十八年', font=font(GOTHIC_M, 48), fill=(60, 40, 30))
save(grime(im, 70, 1), 'board_a')

# 2 vertical light boxes ----------------------------------------------------------------------
for name, txt, bg, fg, sz in [('vbox_a', '居酒屋', (245, 240, 228), (200, 20, 20), 200),
                              ('vbox_b', '立ち呑み', (250, 205, 60), (30, 20, 10), 150),
                              ('vbox_c', 'おでん', (240, 236, 226), (20, 20, 90), 190),
                              ('vbox_d', '餃子', (220, 40, 30), (255, 245, 220), 230)]:
    im = Image.new('RGB', (256, 1024), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([6, 6, 249, 1017], outline=tuple(int(c * .6) for c in fg), width=8)
    f = font(GOTHIC, sz)
    step = int((1000 - 40) / len(txt))
    vtext(d, 128, 40 + (step - sz) // 2, txt, f, fg, step)
    save(grime(im, 35, hash(name) & 255), name)

# 3 standing menu board (orange, ramen) -------------------------------------------------------
im = Image.new('RGB', (512, 768), (240, 120, 30))
d = ImageDraw.Draw(im)
d.rectangle([12, 12, 499, 755], outline=(120, 30, 10), width=12)
d.text((256, 70), 'らーめん', font=font(GOTHIC, 110), fill=(120, 15, 10), anchor='mt')
d.ellipse([110, 270, 400, 470], fill=(250, 235, 200), outline=(110, 30, 10), width=10)  # bowl
d.chord([90, 330, 420, 600], 0, 180, fill=(170, 30, 20), outline=(90, 20, 10), width=8)
for i in range(4):
    d.arc([150 + i * 25, 290, 330 + i * 15, 420], 200, 320, fill=(200, 140, 40), width=6)
d.text((256, 620), '七八〇円', font=font(GOTHIC, 90), fill=(255, 245, 220), anchor='mt')
save(grime(im, 50, 3), 'stand_a')

# 4 wooden menu plaques -----------------------------------------------------------------------
items = ['生ビール 五〇〇', '焼鳥 一二〇', '枝豆 三〇〇', 'ハイボール 四五〇', '冷奴 二八〇', '熱燗 四〇〇', 'もつ煮 三五〇', '唐揚げ 四八〇']
im = Image.new('RGB', (1024, 512), (110, 70, 40))
d = ImageDraw.Draw(im)
for i in range(1024):
    if rng.random() < .08:
        d.line([(i, 0), (i, 511)], fill=(90 + rng.randint(0, 30), 55, 30), width=1)
f = font(MINCHO, 60)
for i, it in enumerate(items):
    x = 960 - i * 122
    w = 104
    d.rectangle([x - w // 2, 20, x + w // 2, 492], fill=(232, 220, 190))
    name, price = it.split(' ')
    vtext(d, x, 34, name[:5], font(MINCHO, 62), (20, 15, 10), 66)
    vtext(d, x, 370, price[:3], font(MINCHO, 34), (170, 20, 15), 38)
save(grime(im, 50, 4), 'menu_a')

# 5 noren curtain (red with white text, 3 panels) --------------------------------------------
im = Image.new('RGB', (768, 512), (165, 18, 22))
d = ImageDraw.Draw(im)
for i, ch in enumerate('やきとり'[:3]):
    d.text((128 + i * 256, 140), ch, font=font(MARU, 220), fill=(245, 238, 225), anchor='mt')
for i in (256, 512):
    d.line([(i, 60), (i, 511)], fill=(90, 8, 10), width=10)
save(grime(im, 40, 5), 'noren_a')
im = Image.new('RGB', (768, 512), (25, 30, 70))
d = ImageDraw.Draw(im)
for i, ch in enumerate('呑処ゆ'):
    d.text((128 + i * 256, 150), ch, font=font(MINCHO, 210), fill=(235, 230, 215), anchor='mt')
for i in (256, 512):
    d.line([(i, 60), (i, 511)], fill=(10, 10, 30), width=10)
save(grime(im, 30, 6), 'noren_b')

# 6 lanterns (wrap texture, u around, v top->bottom) -----------------------------------------
im = Image.new('RGB', (1024, 512), (215, 30, 20))
d = ImageDraw.Draw(im)
for y in range(40, 470, 22):
    d.line([(0, y), (1023, y)], fill=(170, 18, 12), width=3)
for cx in (256, 768):
    d.text((cx, 120), '酒', font=font(MINCHO, 270), fill=(25, 10, 8), anchor='mt')
d.rectangle([0, 0, 1023, 40], fill=(30, 20, 15)); d.rectangle([0, 472, 1023, 511], fill=(30, 20, 15))
save(im, 'lantern_red')
im = Image.new('RGB', (1024, 512), (245, 240, 225))
d = ImageDraw.Draw(im)
for y in range(40, 470, 22):
    d.line([(0, y), (1023, y)], fill=(215, 205, 190), width=3)
d.rectangle([0, 190, 1023, 330], fill=(40, 90, 190))
for cx in (256, 768):
    d.text((cx, 196), '祭', font=font(GOTHIC, 125), fill=(250, 245, 235), anchor='mt')
d.rectangle([0, 60, 1023, 90], fill=(220, 40, 30)); d.rectangle([0, 420, 1023, 450], fill=(220, 40, 30))
d.rectangle([0, 0, 1023, 40], fill=(30, 20, 15)); d.rectangle([0, 472, 1023, 511], fill=(30, 20, 15))
save(im, 'lantern_white')

# 7 posters ---------------------------------------------------------------------------------
im = Image.new('RGB', (512, 720), (250, 215, 70))
d = ImageDraw.Draw(im)
d.rectangle([0, 0, 511, 150], fill=(210, 30, 30))
d.text((256, 30), '営業中', font=font(GOTHIC, 100), fill=(255, 250, 235), anchor='mt')
d.ellipse([120, 200, 390, 470], fill=(255, 235, 200), outline=(60, 30, 10), width=8)  # abstract face
d.ellipse([190, 290, 220, 320], fill=(40, 20, 10)); d.ellipse([290, 290, 320, 320], fill=(40, 20, 10))
d.arc([200, 330, 310, 420], 20, 160, fill=(170, 30, 20), width=8)
d.text((256, 520), '本日のおすすめ', font=font(GOTHIC, 56), fill=(120, 20, 10), anchor='mt')
d.text((256, 610), '五〇〇円より', font=font(GOTHIC_M, 52), fill=(40, 20, 10), anchor='mt')
save(grime(im, 50, 7), 'poster_a')
im = Image.new('RGB', (512, 720), (235, 235, 230))
d = ImageDraw.Draw(im)
for i in range(9):
    d.rectangle([0, i * 80, 511, i * 80 + 36], fill=(40 + i * 20, 60, 150 - i * 10))
d.text((256, 280), 'OPEN', font=font(GOTHIC, 140), fill=(255, 255, 255), anchor='mt', stroke_width=6, stroke_fill=(20, 20, 40))
save(grime(im, 40, 8), 'poster_b')
im = Image.new('RGB', (768, 512), (30, 30, 30))
d = ImageDraw.Draw(im)
d.text((384, 60), '駐輪禁止', font=font(GOTHIC, 150), fill=(240, 60, 40), anchor='mt')
d.text((384, 300), 'NO PARKING', font=font(GOTHIC, 90), fill=(240, 240, 230), anchor='mt')
save(grime(im, 40, 9), 'poster_c')

# 8 small screen (blue/white abstract star burst) --------------------------------------------
im = Image.new('RGB', (256, 256), (20, 60, 160))
d = ImageDraw.Draw(im)
import math
for i in range(16):
    a = i * math.pi / 8
    d.line([(128, 128), (128 + 140 * math.cos(a), 128 + 140 * math.sin(a))], fill=(120, 190, 255), width=6)
d.ellipse([88, 88, 168, 168], fill=(245, 250, 255))
save(im, 'screen_a')

# 9 shutter graffiti-ish stickers strip and wall plaster --------------------------------------
im = Image.new('RGB', (1024, 1024), (205, 195, 180))
d = ImageDraw.Draw(im)
for i in range(60):
    x, y = rng.randint(0, 1000), rng.randint(0, 1000)
    w, h = rng.randint(30, 160), rng.randint(20, 120)
    c = rng.choice([(230, 220, 200), (200, 60, 40), (240, 200, 70), (60, 60, 60), (240, 240, 235), (120, 140, 180)])
    d.rectangle([x, y, x + w, y + h], fill=c)
    if rng.random() < .5:
        d.text((x + 6, y + 4), rng.choice(['酒', '焼', '鳥', '麺', '安', '旨', '本', '店']), font=font(GOTHIC, max(16, h - 12)), fill=(30, 20, 15))
save(grime(im.filter(ImageFilter.GaussianBlur(1)), 90, 10), 'collage_a')
print('ok', sorted(os.listdir(OUT)))
