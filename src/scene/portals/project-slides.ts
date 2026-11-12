// Procedural "screenshots" for the project portals (stand-ins for real slide images).
// Every slide is drawn with Canvas 2D at SLIDE_W × SLIDE_H into one atlas per project.
import type { Project } from '../../lib/content';

export const SLIDE_W = 1008;
export const SLIDE_H = 600;
const CELL_W = 1024;
const CELL_H = 640;
export const ATLAS = 2048;

type C = CanvasRenderingContext2D;
type Draw = (c: C, p: Project) => void;

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BLACK = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const COND = 'Impact, "DIN Condensed", "Arial Narrow", sans-serif';
const MONO = 'Menlo, "SF Mono", Monaco, monospace';
const PIX = 'OffBit, Menlo, monospace';

// ------------------------------------------------------------------ helpers
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function rr(c: C, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
function fillRR(c: C, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  rr(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
}
function text(c: C, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'left', ls = 0) {
  c.font = font;
  c.fillStyle = fill;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  (c as any).letterSpacing = `${ls}px`;
  c.fillText(s, x, y);
  (c as any).letterSpacing = '0px';
}
/** paragraph of fake copy as wrapped lines */
function para(c: C, s: string, x: number, y: number, w: number, size: number, lh: number, fill: string, weight = 400) {
  c.font = `${weight} ${size}px ${SANS}`;
  c.fillStyle = fill;
  c.textAlign = 'left';
  const words = s.split(' ');
  let line = '';
  for (const word of words) {
    const t = line ? line + ' ' + word : word;
    if (c.measureText(t).width > w && line) {
      c.fillText(line, x, y);
      y += lh;
      line = word;
    } else line = t;
  }
  if (line) c.fillText(line, x, y);
  return y + lh;
}
/** grey placeholder text lines */
function lines(c: C, x: number, y: number, w: number, n: number, h: number, gap: number, fill: string) {
  c.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    const lw = i === n - 1 ? w * (0.4 + rnd() * 0.3) : w * (0.82 + rnd() * 0.18);
    fillRR(c, x, y + i * gap, lw, h, h / 2, fill);
  }
}
function grad(c: C, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function shadow(c: C, blur: number, col = 'rgba(0,0,0,.35)', oy = 0) {
  c.shadowBlur = blur;
  c.shadowColor = col;
  c.shadowOffsetY = oy;
}
function noShadow(c: C) {
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  c.shadowOffsetY = 0;
}
/** film grain so flat fills read like screen captures */
function grain(c: C, amt = 10) {
  const img = c.getImageData(0, 0, SLIDE_W, SLIDE_H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}
/** site nav bar */
function nav(c: C, logo: string, links: string[], col: string, y = 34, logoFont = `700 15px ${SANS}`) {
  text(c, logo, 44, y, logoFont, col);
  let x = SLIDE_W - 44;
  for (let i = links.length - 1; i >= 0; i--) {
    c.font = `500 12px ${SANS}`;
    const w = c.measureText(links[i]).width;
    text(c, links[i], x, y, `500 12px ${SANS}`, col, 'right');
    x -= w + 26;
  }
}
/** phone frame with a screen callback in local coords (sw × sh) */
function phone(c: C, x: number, y: number, w: number, screen: (c: C, w: number, h: number) => void, body = '#0c0c0f', tilt = 0) {
  const h = w * 2.05;
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(tilt);
  c.translate(-w / 2, -h / 2);
  shadow(c, 40, 'rgba(0,0,0,.45)', 18);
  fillRR(c, 0, 0, w, h, w * 0.16, body);
  noShadow(c);
  const b = w * 0.045;
  c.save();
  rr(c, b, b, w - 2 * b, h - 2 * b, w * 0.13);
  c.clip();
  c.translate(b, b);
  screen(c, w - 2 * b, h - 2 * b);
  c.restore();
  // dynamic island
  fillRR(c, w * 0.36, b + w * 0.035, w * 0.28, w * 0.075, w * 0.04, '#000');
  c.restore();
}
function statusBar(c: C, w: number, col: string) {
  text(c, '9:41', w * 0.1, w * 0.1, `600 ${w * 0.055}px ${SANS}`, col);
  c.fillStyle = col;
  c.fillRect(w * 0.8, w * 0.07, w * 0.08, w * 0.035);
}
function browser(c: C, x: number, y: number, w: number, h: number, url: string, dark = false) {
  shadow(c, 30, 'rgba(0,0,0,.3)', 12);
  fillRR(c, x, y, w, h, 10, dark ? '#16181d' : '#ffffff');
  noShadow(c);
  fillRR(c, x, y, w, 30, 10, dark ? '#24262c' : '#ececec');
  c.fillStyle = dark ? '#24262c' : '#ececec';
  c.fillRect(x, y + 20, w, 10);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    c.beginPath();
    c.arc(x + 16 + i * 16, y + 15, 5, 0, Math.PI * 2);
    c.fillStyle = col;
    c.fill();
  });
  fillRR(c, x + w * 0.3, y + 7, w * 0.4, 16, 8, dark ? '#33363d' : '#fff');
  text(c, url, x + w / 2, y + 19, `400 10px ${SANS}`, dark ? '#9aa' : '#666', 'center');
}
/** syntax-highlighted code; tokens: [text, colour] */
function code(c: C, x: number, y: number, rows: [string, string][][], size = 14, lh = 21) {
  c.font = `400 ${size}px ${MONO}`;
  c.textAlign = 'left';
  rows.forEach((row, i) => {
    let cx = x;
    text(c, String(i + 1).padStart(2, ' '), x - 36, y + i * lh, `400 ${size}px ${MONO}`, '#4b5263');
    for (const [t, col] of row) {
      c.font = `400 ${size}px ${MONO}`;
      c.fillStyle = col;
      c.fillText(t, cx, y + i * lh);
      cx += c.measureText(t).width;
    }
  });
}
function check(c: C, x: number, y: number, r: number, col: string, fg = '#000') {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = col;
  c.fill();
  c.strokeStyle = fg;
  c.lineWidth = r * 0.28;
  c.beginPath();
  c.moveTo(x - r * 0.45, y);
  c.lineTo(x - r * 0.1, y + r * 0.35);
  c.lineTo(x + r * 0.5, y - r * 0.35);
  c.stroke();
}

// ------------------------------------------------------------------ project 0: Flutter Riverpod template
const KW = '#c678dd', TY = '#e5c07b', FN = '#61afef', ST = '#98c379', PL = '#abb2bf', CM = '#5c6370', NU = '#d19a66';

function appScreen(c: C, w: number, h: number, accent: string, dark = false) {
  c.fillStyle = dark ? '#101418' : '#f4f8ff';
  c.fillRect(0, 0, w, h);
  statusBar(c, w, dark ? '#fff' : '#111');
  c.fillStyle = accent;
  c.fillRect(0, w * 0.16, w, w * 0.22);
  text(c, 'Todos', w * 0.08, w * 0.31, `700 ${w * 0.09}px ${SANS}`, '#fff');
  const items = ['Set up Riverpod', 'Generate Freezed models', 'Add Go Router routes', 'Cache with Hive', 'Translate strings'];
  items.forEach((t, i) => {
    const y = w * 0.45 + i * w * 0.2;
    fillRR(c, w * 0.06, y, w * 0.88, w * 0.16, w * 0.04, dark ? '#1b2128' : '#fff');
    check(c, w * 0.15, y + w * 0.08, w * 0.04, i < 2 ? accent : dark ? '#333' : '#dde', '#fff');
    text(c, t, w * 0.24, y + w * 0.095, `500 ${w * 0.05}px ${SANS}`, dark ? '#dde' : '#223');
  });
  c.beginPath();
  c.arc(w * 0.82, h - w * 0.2, w * 0.1, 0, Math.PI * 2);
  c.fillStyle = accent;
  c.fill();
  text(c, '+', w * 0.82, h - w * 0.165, `300 ${w * 0.14}px ${SANS}`, '#fff', 'center');
}

const riverpod: Draw[] = [
  // hero
  (c, p) => {
    c.fillStyle = grad(c, 0, 0, 0, SLIDE_H, [[0, '#0646e8'], [0.55, '#1d8cff'], [1, '#5fe3ff']]);
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    // soft light streaks
    for (let i = 0; i < 5; i++) {
      c.fillStyle = `rgba(255,255,255,${0.03 + i * 0.008})`;
      c.fillRect(120 + i * 190, 0, 70, SLIDE_H);
    }
    shadow(c, 0, 'rgba(0,0,40,.55)', 5);
    c.shadowOffsetX = 3;
    text(c, 'Flutter Riverpod Template', SLIDE_W / 2, 112, `900 56px ${BLACK}`, '#fff', 'center', -2);
    c.shadowOffsetX = 0;
    noShadow(c);
    para(c, 'A production-ready starter for Flutter. Riverpod 2.0, Freezed, Go Router, Hive and Easy Localization, wired together with the best practices already in place.', 70, 262, 190, 12, 16, 'rgba(255,255,255,.92)', 500);
    fillRR(c, 70, 350, 120, 32, 16, '#fff');
    text(c, 'Use template →', 130, 371, `700 12px ${SANS}`, '#0b5cff', 'center');
    phone(c, SLIDE_W / 2 - 92, 175, 184, (cc, w, h) => appScreen(cc, w, h, p.palette[0]));
    // feature ticks right
    ['Riverpod 2.0', 'Freezed', 'Go Router', 'Hive', 'Easy Localization'].forEach((t, i) => {
      check(c, 760, 268 + i * 34, 9, '#fff', '#0b5cff');
      text(c, t, 778, 273 + i * 34, `600 14px ${SANS}`, '#fff');
    });
    text(c, 'github.com/Erengun', 70, 560, `500 11px ${SANS}`, 'rgba(255,255,255,.75)');
    text(c, 'MIT licensed', SLIDE_W / 2, 572, `600 11px ${SANS}`, 'rgba(255,255,255,.85)', 'center');
  },
  // editor
  (c) => {
    c.fillStyle = '#1e2127';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = '#21252b';
    c.fillRect(0, 0, 210, SLIDE_H);
    c.fillStyle = '#181a1f';
    c.fillRect(0, 0, SLIDE_W, 34);
    ['todo_controller.dart', 'app_router.dart', 'main.dart'].forEach((t, i) => {
      fillRR(c, 220 + i * 170, 6, 160, 28, 4, i === 0 ? '#1e2127' : '#181a1f');
      text(c, t, 236 + i * 170, 25, `400 12px ${SANS}`, i === 0 ? '#e6e6e6' : '#7f848e');
    });
    const tree = ['▾ lib', '  ▾ src', '    ▾ features', '      ▾ todo', '        ▸ data', '        ▸ domain', '        ▾ presentation', '          todo_controller.dart', '          todo_page.dart', '    ▸ router', '    ▸ l10n', '  main.dart', '▸ test', '  pubspec.yaml', '  analysis_options.yaml'];
    tree.forEach((t, i) => {
      if (i === 7) fillRR(c, 6, 50 + i * 24 - 16, 198, 22, 3, '#2c313a');
      text(c, t, 16, 50 + i * 24, `400 12px ${MONO}`, i === 7 ? '#fff' : '#9da5b4');
    });
    code(c, 270, 72, [
      [['import ', KW], ["'package:riverpod_annotation/riverpod_annotation.dart'", ST], [';', PL]],
      [['part ', KW], ["'todo_controller.g.dart'", ST], [';', PL]],
      [],
      [['@riverpod', TY]],
      [['class ', KW], ['TodoController ', TY], ['extends ', KW], ['_$TodoController ', TY], ['{', PL]],
      [['  @override', TY]],
      [['  Future', TY], ['<', PL], ['List', TY], ['<', PL], ['Todo', TY], ['>> ', PL], ['build', FN], ['() ', PL], ['async ', KW], ['{', PL]],
      [['    final ', KW], ['repo ', PL], ['= ', PL], ['ref', PL], ['.', PL], ['watch', FN], ['(todoRepositoryProvider);', PL]],
      [['    return ', KW], ['repo', PL], ['.', PL], ['fetchAll', FN], ['();', PL]],
      [['  }', PL]],
      [],
      [['  Future', TY], ['<', PL], ['void', KW], ['> ', PL], ['toggle', FN], ['(', PL], ['Todo ', TY], ['todo) ', PL], ['async ', KW], ['{', PL]],
      [['    state ', PL], ['= ', PL], ['const ', KW], ['AsyncLoading', TY], ['();', PL]],
      [['    state ', PL], ['= ', PL], ['await ', KW], ['AsyncValue', TY], ['.', PL], ['guard', FN], ['(() ', PL], ['async ', KW], ['{', PL]],
      [['      await ', KW], ['ref', PL], ['.', PL], ['read', FN], ['(todoRepositoryProvider)', PL]],
      [['          .', PL], ['save', FN], ['(todo.', PL], ['copyWith', FN], ['(done: ', PL], ['!', PL], ['todo.done));', PL]],
      [['      return ', KW], ['ref', PL], ['.', PL], ['read', FN], ['(todoRepositoryProvider).', PL], ['fetchAll', FN], ['();', PL]],
      [['    });', PL]],
      [['  }', PL]],
      [['}', PL]],
      [['// ', CM], ['generated providers live in todo_controller.g.dart', CM]],
    ], 13.5, 22);
    c.fillStyle = '#0b5cff';
    c.fillRect(0, SLIDE_H - 22, SLIDE_W, 22);
    text(c, '⎇ main   ✓ 0 problems   Dart 3.5 · Flutter 3.24', 12, SLIDE_H - 7, `500 11px ${SANS}`, '#fff');
  },
  // features grid
  (c, p) => {
    c.fillStyle = p.palette[2];
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, '◆ riverpod-template', ['Docs', 'Architecture', 'Changelog', 'GitHub'], '#0b2a6b');
    text(c, 'Everything wired.', 60, 150, `900 64px ${BLACK}`, '#0b2a6b', 'left', -2);
    text(c, 'Nothing to set up.', 60, 222, `900 64px ${BLACK}`, p.palette[0], 'left', -2);
    const feats: [string, string, string][] = [
      ['Riverpod 2.0', 'Code-generated providers, async notifiers.', '#0b5cff'],
      ['Freezed', 'Immutable models, unions and JSON.', '#00b3a4'],
      ['Go Router', 'Typed routes, guards and deep links.', '#ff8a00'],
      ['Hive', 'Fast local storage and caching.', '#f2c200'],
      ['Easy Localization', 'Strings in JSON, switch at runtime.', '#8a5cff'],
      ['Lints + CI', 'Strict analysis, tests on every push.', '#ff4d6d'],
    ];
    feats.forEach(([t, d, col], i) => {
      const x = 60 + (i % 3) * 300, y = 290 + Math.floor(i / 3) * 140;
      shadow(c, 18, 'rgba(11,42,107,.12)', 6);
      fillRR(c, x, y, 280, 120, 14, '#fff');
      noShadow(c);
      fillRR(c, x + 20, y + 20, 34, 34, 9, col);
      text(c, t, x + 20, y + 80, `700 17px ${SANS}`, '#0b2a6b');
      text(c, d, x + 20, y + 102, `400 12px ${SANS}`, '#5a6b8c');
    });
  },
  // three phones
  (c, p) => {
    c.fillStyle = grad(c, 0, 0, SLIDE_W, SLIDE_H, [[0, '#062a8f'], [1, '#0b5cff']]);
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Light, dark,', 60, 120, `900 48px ${BLACK}`, '#fff', 'left', -1.5);
    text(c, 'and every locale.', 60, 176, `900 48px ${BLACK}`, p.palette[1], 'left', -1.5);
    para(c, 'Theme switching and translations are wired from day one. Add a language by dropping in a JSON file.', 60, 220, 300, 14, 20, 'rgba(255,255,255,.8)');
    phone(c, 430, 90, 160, (cc, w, h) => {
      cc.fillStyle = '#fff';
      cc.fillRect(0, 0, w, h);
      statusBar(cc, w, '#111');
      text(cc, 'Welcome back', w * 0.08, w * 0.45, `800 ${w * 0.1}px ${SANS}`, '#111');
      ['Email', 'Password'].forEach((t, i) => {
        fillRR(cc, w * 0.08, w * 0.6 + i * w * 0.24, w * 0.84, w * 0.17, w * 0.04, '#eef2f8');
        text(cc, t, w * 0.14, w * 0.71 + i * w * 0.24, `400 ${w * 0.05}px ${SANS}`, '#889');
      });
      fillRR(cc, w * 0.08, w * 1.15, w * 0.84, w * 0.17, w * 0.085, p.palette[0]);
      text(cc, 'Sign in', w / 2, w * 1.26, `700 ${w * 0.055}px ${SANS}`, '#fff', 'center');
    }, '#0c0c0f', -0.05);
    phone(c, 610, 60, 170, (cc, w, h) => appScreen(cc, w, h, p.palette[0], true));
    phone(c, 800, 90, 160, (cc, w, h) => {
      cc.fillStyle = '#f4f8ff';
      cc.fillRect(0, 0, w, h);
      statusBar(cc, w, '#111');
      text(cc, 'Ayarlar', w * 0.08, w * 0.42, `800 ${w * 0.1}px ${SANS}`, '#111');
      ['Karanlık mod', 'Dil · Türkçe', 'Bildirimler', 'Hakkında'].forEach((t, i) => {
        const y = w * 0.55 + i * w * 0.2;
        fillRR(cc, w * 0.06, y, w * 0.88, w * 0.16, w * 0.04, '#fff');
        text(cc, t, w * 0.12, y + w * 0.1, `500 ${w * 0.05}px ${SANS}`, '#223');
        if (i < 3) fillRR(cc, w * 0.72, y + w * 0.05, w * 0.15, w * 0.07, w * 0.035, i === 0 ? p.palette[0] : '#ccd');
      });
    }, '#0c0c0f', 0.05);
  },
  // repo page
  (c, p) => {
    c.fillStyle = '#0d1117';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = '#010409';
    c.fillRect(0, 0, SLIDE_W, 56);
    text(c, 'Erengun / flutter-riverpod-template', 40, 35, `600 16px ${SANS}`, '#e6edf3');
    ['☆ Star  1.1k', '⑂ Fork  210', 'Use this template'].forEach((t, i) => {
      fillRR(c, 600 + i * 120, 18, 110, 26, 6, i === 2 ? '#238636' : '#21262d');
      text(c, t, 655 + i * 120, 35, `600 11px ${SANS}`, '#e6edf3', 'center');
    });
    fillRR(c, 40, 80, 600, 490, 8, '#0d1117');
    c.strokeStyle = '#30363d';
    c.lineWidth = 1;
    rr(c, 40, 80, 600, 490, 8);
    c.stroke();
    text(c, 'README.md', 60, 108, `600 13px ${SANS}`, '#e6edf3');
    text(c, 'Flutter Riverpod', 60, 175, `900 44px ${BLACK}`, '#fff', 'left', -1);
    text(c, '2.0 Template', 60, 225, `900 44px ${BLACK}`, p.palette[1], 'left', -1);
    lines(c, 60, 260, 540, 3, 9, 20, '#30363d');
    code(c, 96, 360, [[['flutter ', FN], ['create ', PL], ['--template ', NU], ['erengun/riverpod ', ST], ['my_app', PL]], [['cd ', FN], ['my_app ', PL], ['&& ', PL], ['dart run ', FN], ['build_runner build', ST]]], 13, 22);
    lines(c, 60, 430, 540, 5, 9, 20, '#30363d');
    text(c, 'About', 670, 108, `600 14px ${SANS}`, '#e6edf3');
    para(c, p.info, 670, 135, 300, 12, 18, '#9198a1');
    ['flutter', 'riverpod', 'freezed', 'go-router', 'hive', 'template'].forEach((t, i) => {
      const x = 670 + (i % 3) * 98, y = 225 + Math.floor(i / 3) * 30;
      fillRR(c, x, y, 90, 22, 11, '#122d4f');
      text(c, t, x + 45, y + 15, `600 11px ${SANS}`, '#4493f8', 'center');
    });
    text(c, 'Languages', 670, 320, `600 14px ${SANS}`, '#e6edf3');
    fillRR(c, 670, 335, 290, 8, 4, '#00b4ab');
    c.fillStyle = '#e34c26';
    c.fillRect(930, 335, 30, 8);
    text(c, '● Dart 91.4%   ● Swift 4.1%   ● Other', 670, 362, `400 11px ${SANS}`, '#9198a1');
  },
];

// ------------------------------------------------------------------ project 1: LegalLens
const legallens: Draw[] = [
  (c, p) => {
    c.fillStyle = '#e4e4e1';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, 'LEGALLENS', ['How it works', 'Pricing', 'Extension', 'Sign in'], '#141414', 38, `400 16px ${COND}`);
    // big lens over a policy document
    c.save();
    c.translate(770, 320);
    c.rotate(-0.12);
    shadow(c, 30, 'rgba(0,0,0,.25)', 10);
    fillRR(c, -170, -230, 340, 470, 6, '#fafafa');
    noShadow(c);
    seed = 11;
    for (let i = 0; i < 20; i++) {
      const w = 260 * (0.6 + rnd() * 0.4);
      c.fillStyle = i === 6 || i === 7 || i === 13 ? p.palette[2] : '#c9c9c6';
      c.fillRect(-140, -195 + i * 21, w, 7);
    }
    c.restore();
    c.beginPath();
    c.arc(730, 290, 140, 0, Math.PI * 2);
    c.lineWidth = 32;
    c.strokeStyle = '#141414';
    c.stroke();
    c.save();
    c.beginPath();
    c.arc(730, 290, 124, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.fill();
    text(c, '7 points', 730, 284, `400 58px ${COND}`, '#141414', 'center');
    text(c, 'that matter', 730, 322, `400 26px ${COND}`, p.palette[2], 'center');
    c.restore();
    c.save();
    c.translate(828, 390);
    c.rotate(0.78);
    fillRR(c, 0, -21, 190, 42, 21, '#141414');
    c.restore();
    // headline
    shadow(c, 0, 'rgba(0,0,0,.25)', 4);
    text(c, 'READ LESS.', 56, 196, `400 104px ${COND}`, '#141414', 'left', -1);
    text(c, 'KNOW MORE.', 56, 298, `400 104px ${COND}`, '#141414', 'left', -1);
    noShadow(c);
    para(c, 'Privacy policies, summarised by AI in seconds. Know what you agree to.', 60, 352, 330, 15, 20, '#3a3a3a', 500);
    fillRR(c, 60, 395, 160, 40, 20, '#141414');
    text(c, 'TRY IT FREE  →', 140, 420, `700 12px ${SANS}`, '#fff', 'center', 1);
    text(c, 'Works with 40,000+ sites', 60, 470, `500 12px ${SANS}`, '#6a6a6a');
  },
  (c, p) => {
    c.fillStyle = '#101010';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = '#181818';
    c.fillRect(0, 0, 190, SLIDE_H);
    text(c, 'LEGALLENS', 26, 44, `400 18px ${COND}`, '#f2f2f2', 'left', 1);
    ['Summaries', 'History', 'Watchlist', 'Alerts', 'Settings'].forEach((t, i) => {
      if (i === 0) fillRR(c, 14, 76 + i * 38, 162, 30, 6, '#262626');
      text(c, t, 30, 96 + i * 38, `500 13px ${SANS}`, i === 0 ? '#fff' : '#8a8a8a');
    });
    text(c, 'Instagram Privacy Policy', 230, 70, `700 26px ${SANS}`, '#f2f2f2');
    text(c, '12,412 words  →  7 key points  ·  read time 40 s', 230, 96, `400 13px ${SANS}`, '#8a8a8a');
    // score ring
    c.lineWidth = 12;
    c.strokeStyle = '#2a2a2a';
    c.beginPath();
    c.arc(880, 120, 52, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = p.palette[2];
    c.beginPath();
    c.arc(880, 120, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.38);
    c.stroke();
    text(c, '38', 880, 134, `400 40px ${COND}`, '#fff', 'center');
    text(c, 'PRIVACY SCORE', 880, 196, `700 10px ${SANS}`, '#8a8a8a', 'center', 1);
    const pts: [string, string, string][] = [
      ['HIGH', 'Your messages may be used to train AI models.', '#ff4d2e'],
      ['HIGH', 'Location history is shared with advertising partners.', '#ff4d2e'],
      ['MED', 'Data is kept for up to 3 years after you delete your account.', '#ffae2e'],
      ['MED', 'Contacts are uploaded when you sync your phone book.', '#ffae2e'],
      ['LOW', 'You can download a copy of all your data.', '#2ecc71'],
      ['LOW', 'You can opt out of personalised ads in settings.', '#2ecc71'],
    ];
    pts.forEach(([lvl, t, col], i) => {
      const y = 140 + i * 66;
      fillRR(c, 230, y, 560, 54, 10, '#1a1a1a');
      fillRR(c, 248, y + 16, 50, 22, 11, col);
      text(c, lvl, 273, y + 31, `800 10px ${SANS}`, '#101010', 'center', 1);
      text(c, t, 316, y + 33, `500 14px ${SANS}`, '#e8e8e8');
    });
  },
  (c, p) => {
    c.fillStyle = p.palette[2];
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, '12,412 WORDS', 50, 210, `400 150px ${COND}`, '#141414', 'left', -2);
    c.fillStyle = '#141414';
    c.fillRect(40, 150, 820, 14);
    text(c, '7 THINGS THAT', 50, 360, `400 150px ${COND}`, '#fff', 'left', -2);
    text(c, 'ACTUALLY MATTER.', 50, 505, `400 150px ${COND}`, '#fff', 'left', -2);
    text(c, 'LEGALLENS  /  AI SUMMARIES', 50, 560, `700 12px ${SANS}`, '#141414', 'left', 2);
  },
  (c, p) => {
    c.fillStyle = '#efefec';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'In your pocket.', 60, 130, `400 80px ${COND}`, '#141414');
    para(c, 'Share any policy link to LegalLens and get the summary before you tap accept.', 60, 175, 320, 15, 21, '#444', 500);
    const sum = (cc: C, w: number, h: number) => {
      cc.fillStyle = '#101010';
      cc.fillRect(0, 0, w, h);
      statusBar(cc, w, '#fff');
      text(cc, 'TikTok', w * 0.08, w * 0.36, `700 ${w * 0.1}px ${SANS}`, '#fff');
      text(cc, 'Terms of Service · 9,880 words', w * 0.08, w * 0.45, `400 ${w * 0.045}px ${SANS}`, '#888');
      ['#ff4d2e', '#ff4d2e', '#ffae2e', '#2ecc71', '#2ecc71'].forEach((col, i) => {
        const y = w * 0.55 + i * w * 0.24;
        fillRR(cc, w * 0.06, y, w * 0.88, w * 0.2, w * 0.04, '#1c1c1c');
        fillRR(cc, w * 0.1, y + w * 0.06, w * 0.04, w * 0.08, w * 0.02, col);
        cc.fillStyle = '#555';
        cc.fillRect(w * 0.2, y + w * 0.06, w * 0.6, w * 0.03);
        cc.fillRect(w * 0.2, y + w * 0.11, w * 0.4, w * 0.03);
      });
    };
    phone(c, 470, 70, 200, sum, '#1a1a1a', -0.04);
    phone(c, 720, 110, 190, (cc, w, h) => {
      cc.fillStyle = '#fff';
      cc.fillRect(0, 0, w, h);
      statusBar(cc, w, '#111');
      cc.fillStyle = '#f0f0f0';
      cc.fillRect(0, h * 0.55, w, h * 0.45);
      text(cc, 'Share to', w * 0.08, h * 0.62, `700 ${w * 0.06}px ${SANS}`, '#111');
      ['#ff4d2e', '#34c759', '#0a84ff', '#141414'].forEach((col, i) => {
        fillRR(cc, w * 0.08 + i * w * 0.22, h * 0.66, w * 0.17, w * 0.17, w * 0.04, col);
      });
      text(cc, 'LegalLens', w * 0.08, h * 0.66 + w * 0.26, `500 ${w * 0.04}px ${SANS}`, '#111');
      lines(cc, w * 0.08, w * 0.4, w * 0.8, 8, w * 0.025, w * 0.07, '#ccc');
    }, '#1a1a1a', 0.05);
  },
];

// ------------------------------------------------------------------ project 2: Rider CLI
const G = '#2bff88';
function term(c: C, x: number, y: number, w: number, h: number, title: string, rows: [string, string][]) {
  shadow(c, 30, 'rgba(0,0,0,.4)', 12);
  fillRR(c, x, y, w, h, 10, '#0b0b0b');
  noShadow(c);
  fillRR(c, x, y, w, 28, 10, '#1d1d1d');
  c.fillStyle = '#1d1d1d';
  c.fillRect(x, y + 18, w, 10);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    c.beginPath();
    c.arc(x + 16 + i * 16, y + 14, 5, 0, Math.PI * 2);
    c.fillStyle = col;
    c.fill();
  });
  text(c, title, x + w / 2, y + 18, `500 11px ${SANS}`, '#888', 'center');
  rows.forEach(([t, col], i) => text(c, t, x + 18, y + 54 + i * 20, `400 13px ${MONO}`, col));
}
const rider: Draw[] = [
  (c, p) => {
    c.fillStyle = '#0c0c0c';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'RIDER', 46, 30, `700 9px ${SANS}`, '#fff', 'left', 1);
    ['DOCS', 'INSTALL', 'GITHUB'].forEach((t, i) => text(c, t, 800 + i * 64, 30, `700 9px ${SANS}`, '#fff', 'left', 1));
    shadow(c, 0, 'rgba(0,0,0,.6)', 6);
    text(c, 'RIDER', SLIDE_W / 2, 200, `400 220px ${COND}`, '#fff', 'center', 2);
    noShadow(c);
    c.fillStyle = p.palette[0];
    c.fillRect(46, 222, SLIDE_W - 92, SLIDE_H - 222);
    term(c, 120, 262, SLIDE_W - 240, 300, 'zsh — rider', [
      ['$ rider rename --name "Coffee Club" --package com.club.coffee', '#fff'],
      ['', '#fff'],
      ['  ✔ android   applicationId  → com.club.coffee', G],
      ['  ✔ ios       bundle id      → com.club.coffee', G],
      ['  ✔ macos     PRODUCT_NAME   → Coffee Club', G],
      ['  ✔ web       manifest.json  → Coffee Club', G],
      ['  ✔ icons     38 sizes generated from assets/icon.png', G],
      ['', '#fff'],
      ['  done in 1.8s · 14 files changed', '#9a9a9a'],
      ['$ ▌', '#fff'],
    ]);
  },
  (c) => {
    c.fillStyle = '#070707';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    const banner = [
      '██████╗ ██╗██████╗ ███████╗██████╗ ',
      '██╔══██╗██║██╔══██╗██╔════╝██╔══██╗',
      '██████╔╝██║██║  ██║█████╗  ██████╔╝',
      '██╔══██╗██║██║  ██║██╔══╝  ██╔══██╗',
      '██║  ██║██║██████╔╝███████╗██║  ██║',
      '╚═╝  ╚═╝╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝',
    ];
    banner.forEach((l, i) => text(c, l, 50, 70 + i * 22, `400 20px ${MONO}`, '#ffd400'));
    const rows: [string, string][] = [
      ['Reconfigure a Flutter app in one go.', '#ddd'],
      ['', ''],
      ['Usage:', '#fff'],
      ['  rider [command] [flags]', G],
      ['', ''],
      ['Available Commands:', '#fff'],
      ['  rename      Change the app name on every platform', '#bbb'],
      ['  package     Change the package / bundle identifier', '#bbb'],
      ['  icon        Generate launcher icons from one image', '#bbb'],
      ['  splash      Set up the native splash screen', '#bbb'],
      ['  doctor      Check the project for a valid setup', '#bbb'],
    ];
    rows.forEach(([t, col], i) => text(c, t, 50, 230 + i * 22, `400 14px ${MONO}`, col));
    text(c, 'Flags:  -h, --help   -v, --version   --dry-run', 50, 500, `400 14px ${MONO}`, '#777');
    text(c, '$ ▌', 50, 545, `400 14px ${MONO}`, '#fff');
  },
  (c, p) => {
    c.fillStyle = p.palette[0];
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, 'RIDER', ['Docs', 'Install', 'GitHub'], '#111', 38, `400 20px ${COND}`);
    text(c, 'ONE COMMAND.', 46, 210, `400 140px ${COND}`, '#111', 'left', -1);
    text(c, 'EVERY PLATFORM.', 46, 345, `400 140px ${COND}`, '#111', 'left', -1);
    ['Android', 'iOS', 'Web', 'macOS', 'Windows', 'Linux'].forEach((t, i) => {
      const x = 46 + i * 152;
      fillRR(c, x, 400, 140, 110, 12, '#111');
      check(c, x + 28, 430, 11, G, '#111');
      text(c, t, x + 18, 490, `400 30px ${COND}`, '#fff', 'left', 0.5);
    });
    text(c, 'Written in Go with Cobra · MIT', 46, 560, `700 12px ${SANS}`, '#111', 'left', 1);
  },
  (c, p) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    browser(c, 40, 30, SLIDE_W - 80, SLIDE_H - 60, 'rider.dev/docs/install', true);
    const x0 = 70, y0 = 90;
    c.fillStyle = '#1b1d22';
    c.fillRect(x0 - 10, y0 - 10, 180, 440);
    ['Getting started', 'Install', 'rename', 'package', 'icon', 'splash', 'CI usage'].forEach((t, i) =>
      text(c, t, x0 + 10, y0 + 20 + i * 30, `500 13px ${SANS}`, i === 1 ? p.palette[0] : '#8a8f99'));
    text(c, 'Install', 280, 130, `400 64px ${COND}`, '#fff');
    para(c, 'Rider is a single static binary. Install it with Go or grab a release for your platform.', 280, 170, 560, 15, 22, '#a9adb6');
    fillRR(c, 280, 210, 640, 60, 8, '#0b0b0b');
    text(c, '$ go install github.com/Erengun/rider@latest', 300, 246, `400 15px ${MONO}`, G);
    text(c, 'Then, in your Flutter project:', 280, 310, `600 15px ${SANS}`, '#fff');
    fillRR(c, 280, 325, 640, 84, 8, '#0b0b0b');
    text(c, '$ rider rename --name "My App"', 300, 358, `400 15px ${MONO}`, '#fff');
    text(c, '$ rider icon assets/icon.png', 300, 386, `400 15px ${MONO}`, '#fff');
    fillRR(c, 280, 430, 640, 70, 8, '#2a2400');
    fillRR(c, 280, 430, 5, 70, 2, p.palette[0]);
    para(c, 'Tip: run with --dry-run first to see every file Rider will touch.', 300, 470, 600, 14, 20, '#ffe680');
  },
];

// ------------------------------------------------------------------ project 3: Tinywall
function widget(c: C, x: number, y: number, w: number, h: number, p: Project, big = 'B14', small = 'LEVEL −2') {
  c.save();
  shadow(c, 30, 'rgba(155,123,255,.55)', 0);
  fillRR(c, x, y, w, h, Math.min(w, h) * 0.2, grad(c, x, y, x + w, y + h, [[0, '#a98cff'], [1, '#5b3bd9']]));
  noShadow(c);
  const s = Math.min(w, h);
  text(c, small, x + s * 0.14, y + s * 0.24, `700 ${s * 0.09}px ${SANS}`, 'rgba(255,255,255,.8)', 'left', 1);
  text(c, big, x + s * 0.12, y + h - s * 0.16, `800 ${s * 0.36}px ${SANS}`, '#fff', 'left', -1);
  text(c, 'P', x + w - s * 0.14, y + s * 0.24, `900 ${s * 0.12}px ${SANS}`, '#fff', 'right');
  c.restore();
}
function homeScreen(c: C, w: number, h: number, p: Project) {
  c.fillStyle = grad(c, 0, 0, w, h, [[0, '#2a1858'], [0.6, '#130b2b'], [1, '#070410']]);
  c.fillRect(0, 0, w, h);
  statusBar(c, w, '#fff');
  widget(c, w * 0.07, w * 0.2, w * 0.86, w * 0.42, p);
  const cols = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#ff8fd8', '#9b7bff', '#ffffff', '#3ddad7', '#ff9f43', '#c4c4c4', '#7d5fff', '#26de81'];
  for (let i = 0; i < 12; i++) {
    const cx = w * 0.07 + (i % 4) * w * 0.225, cy = w * 0.72 + Math.floor(i / 4) * w * 0.27;
    fillRR(c, cx, cy, w * 0.18, w * 0.18, w * 0.045, cols[i]);
  }
  fillRR(c, w * 0.05, h - w * 0.3, w * 0.9, w * 0.24, w * 0.08, 'rgba(255,255,255,.14)');
  for (let i = 0; i < 4; i++) fillRR(c, w * 0.1 + i * w * 0.215, h - w * 0.27, w * 0.17, w * 0.17, w * 0.045, ['#34c759', '#0a84ff', '#fff', '#9b7bff'][i]);
}
const tinywall: Draw[] = [
  (c, p) => {
    c.fillStyle = '#05030a';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    const g = c.createRadialGradient(SLIDE_W / 2, 310, 10, SLIDE_W / 2, 310, 330);
    g.addColorStop(0, 'rgba(155,123,255,.35)');
    g.addColorStop(1, 'rgba(155,123,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Tinywall°', 54, 50, `italic 700 17px ${SANS}`, '#fff');
    text(c, 'Studio', 142, 50, `400 13px ${SANS}`, 'rgba(255,255,255,.6)');
    phone(c, SLIDE_W / 2 - 115, 70, 230, (cc, w, h) => homeScreen(cc, w, h, p), '#1b1b20');
    // settings panel like a design tool
    fillRR(c, 770, 60, 180, 260, 6, 'rgba(30,26,44,.92)');
    text(c, 'Widget', 782, 82, `600 11px ${SANS}`, '#fff');
    [['Level', '−2'], ['Spot', 'B14'], ['Size', 'Medium'], ['Tint', '#9B7BFF'], ['Glow', '0.55'], ['Corner', '22']].forEach(([k, v], i) => {
      const y = 104 + i * 34;
      text(c, k, 782, y + 10, `400 10px ${SANS}`, '#aaa');
      fillRR(c, 840, y, 98, 16, 3, '#2d2840');
      text(c, v, 846, y + 12, `400 10px ${MONO}`, '#fff');
      if (i >= 4) {
        fillRR(c, 782, y + 18, 156, 3, 1.5, '#3c3556');
        fillRR(c, 782, y + 18, 156 * (i === 4 ? 0.55 : 0.4), 3, 1.5, p.palette[1]);
      }
    });
    text(c, 'BUILT BY', 44, 548, `700 8px ${SANS}`, 'rgba(255,255,255,.6)', 'left', 1);
    text(c, 'Eren Gün', 44, 564, `600 11px ${SANS}`, '#fff');
    text(c, 'PLATFORM', 140, 548, `700 8px ${SANS}`, 'rgba(255,255,255,.6)', 'left', 1);
    text(c, 'iOS · Android', 140, 564, `600 11px ${SANS}`, '#fff');
    text(c, 'Your parking spot, on your home screen.', SLIDE_W - 44, 564, `500 11px ${SANS}`, 'rgba(255,255,255,.7)', 'right');
  },
  (c, p) => {
    c.fillStyle = grad(c, 0, 0, SLIDE_W, SLIDE_H, [[0, '#1a1033'], [1, '#3b2479']]);
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'One glance away.', 50, 110, `800 58px ${SANS}`, '#fff', 'left', -2);
    para(c, 'Small, medium and large widgets. Lock screen too.', 52, 150, 500, 16, 22, 'rgba(255,255,255,.7)', 500);
    widget(c, 60, 220, 220, 220, p, 'B14', 'LEVEL −2');
    widget(c, 320, 220, 460, 220, p, 'C07', 'MALL · P3');
    widget(c, 820, 220, 140, 140, p, 'A2', 'STREET');
    fillRR(c, 820, 380, 140, 60, 30, 'rgba(255,255,255,.12)');
    text(c, 'P  B14 · −2', 890, 416, `700 15px ${SANS}`, '#fff', 'center');
    text(c, 'small', 60, 470, `500 13px ${SANS}`, 'rgba(255,255,255,.55)');
    text(c, 'medium', 320, 470, `500 13px ${SANS}`, 'rgba(255,255,255,.55)');
    text(c, 'lock screen', 820, 470, `500 13px ${SANS}`, 'rgba(255,255,255,.55)');
  },
  (c, p) => {
    c.fillStyle = p.palette[1];
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = grad(c, 0, 0, 0, SLIDE_H, [[0, 'rgba(26,16,51,0)'], [1, 'rgba(26,16,51,.55)']]);
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'NEVER FORGET', 46, 170, `900 86px ${BLACK}`, '#fff', 'left', -4);
    text(c, 'WHERE YOU', 46, 262, `900 86px ${BLACK}`, '#fff', 'left', -4);
    text(c, 'PARKED.', 46, 354, `900 86px ${BLACK}`, p.palette[0], 'left', -4);
    phone(c, 700, 60, 220, (cc, w, h) => {
      cc.fillStyle = grad(cc, 0, 0, 0, h, [[0, '#1a1033'], [1, '#000']]);
      cc.fillRect(0, 0, w, h);
      text(cc, 'Tuesday 12 November', w / 2, w * 0.38, `500 ${w * 0.055}px ${SANS}`, '#ddd', 'center');
      text(cc, '9:41', w / 2, w * 0.68, `700 ${w * 0.3}px ${SANS}`, '#fff', 'center');
      fillRR(cc, w * 0.12, w * 0.82, w * 0.76, w * 0.2, w * 0.1, 'rgba(155,123,255,.45)');
      text(cc, 'P   LEVEL −2 · B14', w / 2, w * 0.95, `700 ${w * 0.06}px ${SANS}`, '#fff', 'center');
    }, '#111', 0.06);
    text(c, 'Tinywall for iOS and Android', 50, 540, `700 13px ${SANS}`, '#fff', 'left', 1);
  },
  (c, p) => {
    c.fillStyle = '#f3f0fb';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Three taps.', 50, 100, `800 52px ${SANS}`, p.palette[0], 'left', -2);
    const scr = [
      (cc: C, w: number, h: number) => {
        cc.fillStyle = '#fff';
        cc.fillRect(0, 0, w, h);
        statusBar(cc, w, '#111');
        text(cc, 'Spot', w * 0.08, w * 0.38, `800 ${w * 0.1}px ${SANS}`, '#111');
        text(cc, 'B14', w / 2, w * 0.75, `800 ${w * 0.26}px ${SANS}`, p.palette[1], 'center');
        for (let i = 0; i < 12; i++) {
          fillRR(cc, w * 0.08 + (i % 3) * w * 0.29, w * 0.95 + Math.floor(i / 3) * w * 0.2, w * 0.26, w * 0.16, w * 0.04, '#f1eef9');
          text(cc, '123456789·0⌫'[i], w * 0.21 + (i % 3) * w * 0.29, w * 1.06 + Math.floor(i / 3) * w * 0.2, `600 ${w * 0.07}px ${SANS}`, '#222', 'center');
        }
      },
      (cc: C, w: number, h: number) => {
        cc.fillStyle = '#333';
        cc.fillRect(0, 0, w, h);
        cc.fillStyle = grad(cc, 0, 0, w, h, [[0, '#6a6a6a'], [1, '#2a2a2a']]);
        cc.fillRect(0, 0, w, h * 0.7);
        cc.fillStyle = '#d9c84a';
        cc.fillRect(w * 0.35, h * 0.15, w * 0.3, h * 0.5);
        text(cc, 'B14', w / 2, h * 0.42, `900 ${w * 0.14}px ${SANS}`, '#222', 'center');
        cc.beginPath();
        cc.arc(w / 2, h * 0.84, w * 0.11, 0, Math.PI * 2);
        cc.fillStyle = '#fff';
        cc.fill();
      },
      (cc: C, w: number, h: number) => homeScreen(cc, w, h, p),
    ];
    ['1  Enter the spot', '2  Snap the pillar', '3  It is on your home screen'].forEach((t, i) => {
      phone(c, 70 + i * 310, 140, 190, scr[i], '#141217');
      text(c, t, 70 + i * 310, 140 + 190 * 2.05 + 34, `700 14px ${SANS}`, p.palette[0]);
    });
  },
];

const DESIGNS: Record<string, Draw[]> = { 'riverpod-template': riverpod, legallens, rider, tinywall };

let fontsReady: Promise<void> | null = null;
function loadFonts() {
  if (!fontsReady) {
    fontsReady = (async () => {
      try {
        const f = new FontFace('OffBit', 'url(/fonts/OffBit-DotBold.ttf)');
        await f.load();
        (document.fonts as any).add(f);
      } catch { /* optional */ }
      // make sure system faces are resolved before drawing
      await Promise.all([`900 20px ${BLACK}`, `400 20px ${COND}`, `400 20px ${MONO}`, `700 20px ${SANS}`].map((f) => document.fonts.load(f).catch(() => null)));
    })();
  }
  return fontsReady;
}

export type SlideAtlas = {
  canvas: HTMLCanvasElement;
  /** uv rect per slide: [u0, v0, du, dv] in texture space (flipY = true) */
  rects: [number, number, number, number][];
  thumbs: string[];
};

/** draw all slides of a project into one atlas (2 columns × 3 rows of 1008×600 cells) */
export async function buildSlideAtlas(project: Project): Promise<SlideAtlas> {
  await loadFonts();
  const designs = DESIGNS[project.id] ?? riverpod;
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS;
  atlas.height = ATLAS;
  const a = atlas.getContext('2d')!;
  a.fillStyle = '#000';
  a.fillRect(0, 0, ATLAS, ATLAS);
  const slide = document.createElement('canvas');
  slide.width = SLIDE_W;
  slide.height = SLIDE_H;
  const c = slide.getContext('2d', { willReadFrequently: true })!;
  const thumb = document.createElement('canvas');
  thumb.width = 100;
  thumb.height = 60;
  const t = thumb.getContext('2d')!;
  const rects: SlideAtlas['rects'] = [];
  const thumbs: string[] = [];
  for (let s = 0; s < project.slides; s++) {
    seed = 1 + s * 97 + project.id.length * 13;
    c.save();
    c.clearRect(0, 0, SLIDE_W, SLIDE_H);
    designs[s % designs.length](c, project);
    c.restore();
    noShadow(c);
    grain(c, 9);
    const col = s % 2, row = Math.floor(s / 2);
    const x = col * CELL_W + (CELL_W - SLIDE_W) / 2, y = row * CELL_H + (CELL_H - SLIDE_H) / 2;
    // gutter: smear the edge pixels outward so mips don't bleed neighbouring cells
    a.drawImage(slide, x - 8, y - 8, SLIDE_W + 16, SLIDE_H + 16);
    a.drawImage(slide, x, y);
    // texture v=0 is the bottom row (flipY)
    rects.push([x / ATLAS, 1 - (y + SLIDE_H) / ATLAS, SLIDE_W / ATLAS, SLIDE_H / ATLAS]);
    t.drawImage(slide, 0, 0, 100, 60);
    thumbs.push(thumb.toDataURL('image/jpeg', 0.82));
  }
  return { canvas: atlas, rects, thumbs };
}
