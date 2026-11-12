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
  text(c, logo, 64, y, logoFont, col);
  let x = SLIDE_W - 64;
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

// ------------------------------------------------------------------ shared pieces
const KW = '#c678dd', TY = '#e5c07b', FN = '#61afef', ST = '#98c379', PL = '#abb2bf', NU = '#d19a66';
const TERM_G = '#5ef08a';

function term(c: C, x: number, y: number, w: number, h: number, title: string, rows: [string, string][], bg = '#0b0b0b', size = 13, lh = 20) {
  shadow(c, 30, 'rgba(0,0,0,.4)', 12);
  fillRR(c, x, y, w, h, 10, bg);
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
  rows.forEach(([t, col], i) => text(c, t, x + 18, y + 54 + i * lh, `400 ${size}px ${MONO}`, col));
}
/** rotated rubber stamp */
function stamp(c: C, x: number, y: number, s: string, col: string, size = 40, rot = -0.18) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.font = `900 ${size}px ${BLACK}`;
  const w = c.measureText(s).width + size * 0.8;
  const h = size * 1.45;
  c.strokeStyle = col;
  c.lineWidth = size * 0.1;
  rr(c, -w / 2, -h / 2, w, h, size * 0.18);
  c.stroke();
  c.lineWidth = size * 0.04;
  rr(c, -w / 2 + size * 0.14, -h / 2 + size * 0.14, w - size * 0.28, h - size * 0.28, size * 0.12);
  c.stroke();
  text(c, s, 0, size * 0.36, `900 ${size}px ${BLACK}`, col, 'center', 1);
  c.restore();
}
function pill(c: C, x: number, y: number, s: string, bg: string, fg: string, size = 11, pad = 10) {
  c.font = `700 ${size}px ${SANS}`;
  (c as any).letterSpacing = '1px';
  const w = c.measureText(s).width + pad * 2;
  (c as any).letterSpacing = '0px';
  fillRR(c, x, y, w, size + 12, (size + 12) / 2, bg);
  text(c, s, x + pad, y + size + 4, `700 ${size}px ${SANS}`, fg, 'left', 1);
  return w;
}

// ------------------------------------------------------------------ Öge: supervision layer for coding agents
const OGE_O = '#ff5a1f', OGE_K = '#0d0d0d', OGE_C = '#f4f1ea';
function receiptCard(c: C, x: number, y: number, w: number, h: number, small = false) {
  shadow(c, 34, 'rgba(0,0,0,.35)', 14);
  fillRR(c, x, y, w, h, 4, OGE_C);
  noShadow(c);
  const k = small ? 0.8 : 1;
  text(c, 'RECEIPT', x + 22, y + 34 * k, `900 ${16 * k}px ${BLACK}`, OGE_K, 'left', 2);
  text(c, 'oge receipt --md', x + w - 22, y + 32 * k, `400 ${10 * k}px ${MONO}`, '#8a857a', 'right');
  c.fillStyle = OGE_K;
  c.fillRect(x + 22, y + 46 * k, w - 44, 2);
  const rows: [string, string, string][] = [
    ['CHECKED', 'retry backoff on 502/503', '✓'],
    ['CHECKED', 'idempotency key reused', '✓'],
    ['PASSED', 'held-out tests (QA agent)', '✓'],
    ['PASSED', 'repair loop · 1 round', '✓'],
    ['NOT COVERED', 'webhook replay under load', '–'],
  ];
  rows.forEach(([k1, v, m], i) => {
    const yy = y + (72 + i * 30) * k;
    text(c, k1, x + 22, yy, `700 ${9 * k}px ${SANS}`, k1 === 'NOT COVERED' ? OGE_O : '#8a857a', 'left', 1);
    text(c, v, x + 22 + 98 * k, yy, `500 ${12 * k}px ${MONO}`, OGE_K);
    text(c, m, x + w - 26, yy, `800 ${14 * k}px ${SANS}`, m === '✓' ? OGE_K : OGE_O, 'right');
    c.fillStyle = 'rgba(13,13,13,.12)';
    c.fillRect(x + 22, yy + 10 * k, w - 44, 1);
  });
}
const oge: Draw[] = [
  // cover: orange block, one-desk headline, receipt with the Accepted stamp
  (c) => {
    c.fillStyle = OGE_O;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, 'öge', ['How it works', 'Receipts', 'Docs', 'GitHub'], OGE_K, 40, `900 22px ${BLACK}`);
    shadow(c, 0, 'rgba(0,0,0,.18)', 4);
    text(c, 'ONE DESK', 72, 170, `900 92px ${BLACK}`, OGE_K, 'left', -4);
    text(c, 'FOR EVERYTHING', 72, 248, `900 50px ${BLACK}`, OGE_K, 'left', -2);
    text(c, "YOU'RE BUILDING.", 72, 312, `900 50px ${BLACK}`, OGE_C, 'left', -2);
    noShadow(c);
    para(c, 'AI multiplied execution. Your attention is the bottleneck now.', 76, 384, 330, 16, 21, OGE_K, 600);
    fillRR(c, 76, 440, 286, 44, 8, OGE_K);
    text(c, '$ oge "fix the payment retry bug"', 92, 467, `400 12px ${MONO}`, OGE_C);
    text(c, 'PRE-ALPHA · GO · CLAUDE CODE / CODEX / ANTIGRAVITY', 76, 556, `700 10px ${SANS}`, OGE_K, 'left', 1.5);
    c.save();
    c.translate(790, 300);
    c.rotate(0.05);
    receiptCard(c, -150, -190, 300, 360, true);
    c.restore();
    stamp(c, 790, 410, 'ACCEPTED', OGE_O, 32, -0.2);
  },
  // TUI chat
  (c) => {
    c.fillStyle = '#151412';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    fillRR(c, 40, 30, SLIDE_W - 80, SLIDE_H - 60, 10, OGE_K);
    text(c, 'öge', 64, 66, `900 18px ${BLACK}`, OGE_O);
    text(c, 'desk · payments-service · standard mode', 110, 64, `400 12px ${MONO}`, '#77736b');
    pill(c, SLIDE_W - 190, 48, 'QA ON', OGE_O, OGE_K, 10);
    pill(c, SLIDE_W - 120, 48, 'CLAUDE CODE', '#2a2825', OGE_C, 10, 8);
    c.fillStyle = '#2a2825';
    c.fillRect(64, 84, SLIDE_W - 128, 1);
    const rows: [string, string][] = [
      ['you   fix the payment retry bug', OGE_C],
      ['', ''],
      ['agent ▸ claude-code    reading src/payments/retry.go', '#b9b4aa'],
      ['agent ▸ claude-code    patch ready · 3 files', '#b9b4aa'],
      ['qa    ▸ independent    running held-out tests …', '#b9b4aa'],
      ['qa    ▸ 1 failing      timeout not retried on 503', OGE_O],
      ['loop  ▸ repair 1/3     agent fixing with QA evidence', '#b9b4aa'],
      ['qa    ▸ held-out tests passed', TERM_G],
      ['', ''],
      ['result  ACCEPTED  · evidence attached · receipt #42', OGE_C],
    ];
    rows.forEach(([t, col], i) => text(c, t, 70, 124 + i * 26, `400 15px ${MONO}`, col));
    fillRR(c, 136, 340, 92, 24, 4, OGE_O);
    text(c, 'ACCEPTED', 182, 357, `800 15px ${MONO}`, OGE_K, 'center');
    // input + slash commands
    fillRR(c, 64, 470, SLIDE_W - 128, 46, 8, '#1c1b19');
    text(c, '› /receipt', 84, 499, `400 15px ${MONO}`, OGE_C);
    c.fillStyle = OGE_O;
    c.fillRect(176, 485, 9, 20);
    ['/diff', '/apply', '/receipt'].forEach((t, i) => text(c, t, 84 + i * 90, 542, `400 12px ${MONO}`, i === 2 ? OGE_O : '#77736b'));
  },
  // attention headline + three roles
  (c) => {
    c.fillStyle = OGE_C;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'AI multiplied execution.', 52, 130, `900 50px ${BLACK}`, OGE_K, 'left', -2);
    text(c, 'Your attention is', 52, 196, `900 50px ${BLACK}`, OGE_O, 'left', -2);
    text(c, 'the bottleneck now.', 52, 262, `900 50px ${BLACK}`, OGE_O, 'left', -2);
    const cards: [string, string, string][] = [
      ['01  AGENT', 'Claude Code, Codex or Google Antigravity does the work.', OGE_K],
      ['02  QA', 'An independent agent checks it with held-out tests. Bounded repair loop.', OGE_K],
      ['03  YOU', 'Brought in only when your judgment is needed.', OGE_O],
    ];
    cards.forEach(([h, d, bg], i) => {
      const x = 52 + i * 308;
      fillRR(c, x, 320, 292, 200, 6, bg);
      text(c, h, x + 22, 360, `900 20px ${BLACK}`, bg === OGE_O ? OGE_K : OGE_C, 'left', 1);
      para(c, d, x + 22, 410, 240, 16, 22, bg === OGE_O ? OGE_K : '#cfcac0', 500);
    });
    text(c, '“Accepted” only on evidence.', 52, 560, `700 13px ${SANS}`, OGE_K, 'left', 0.5);
  },
  // receipt document
  (c) => {
    c.fillStyle = OGE_K;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Every run', 52, 120, `900 54px ${BLACK}`, OGE_C, 'left', -2);
    text(c, 'gets a receipt.', 52, 186, `900 54px ${BLACK}`, OGE_O, 'left', -2);
    para(c, 'What was checked, what passed, and what was not covered. Nothing is "done" without evidence.', 56, 236, 340, 16, 23, '#bdb8ae', 500);
    term(c, 56, 360, 360, 160, 'zsh', [
      ['$ oge diff', OGE_C],
      ['$ oge receipt --md > receipt.md', OGE_C],
      ['$ oge apply', OGE_C],
      ['  ✔ applied 3 files', TERM_G],
    ], '#111');
    c.save();
    c.translate(720, 300);
    c.rotate(-0.03);
    receiptCard(c, -200, -240, 400, 470);
    c.restore();
    stamp(c, 760, 470, 'ACCEPTED', OGE_O, 40, -0.16);
  },
  // commands + modes
  (c) => {
    c.fillStyle = OGE_K;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'öge', 52, 80, `900 40px ${BLACK}`, OGE_O);
    pill(c, 140, 54, 'PRE-ALPHA', '#2a2825', OGE_C, 10);
    const cmds: [string, string][] = [
      ['oge "fix the payment retry bug"', 'hand a task to the desk'],
      ['oge diff', 'see exactly what changed'],
      ['oge receipt --md', 'export the evidence'],
      ['oge apply', 'land it when you agree'],
    ];
    cmds.forEach(([cmd, d], i) => {
      const y = 140 + i * 82;
      c.fillStyle = '#2a2825';
      c.fillRect(52, y + 52, SLIDE_W - 104, 1);
      text(c, '$', 52, y + 34, `400 24px ${MONO}`, OGE_O);
      text(c, cmd, 84, y + 34, `400 24px ${MONO}`, OGE_C);
      text(c, d, SLIDE_W - 52, y + 32, `500 14px ${SANS}`, '#77736b', 'right');
    });
    fillRR(c, 52, 480, 420, 64, 32, '#1c1b19');
    fillRR(c, 58, 486, 200, 52, 26, OGE_O);
    text(c, 'STANDARD', 158, 518, `800 14px ${SANS}`, OGE_K, 'center', 1.5);
    text(c, '--fast', 365, 518, `400 15px ${MONO}`, '#b9b4aa', 'center');
    text(c, 'Standard runs full QA. --fast trades checks for speed.', 500, 518, `500 13px ${SANS}`, '#77736b');
  },
];

// ------------------------------------------------------------------ Ferman: self-hosted live updates
const FE_N = '#0a0f1a', FE_G = '#e8b04a', FE_L = '#d9e2ef', FE_P = '#121a2b';
function rolloutPanel(c: C, x: number, y: number, w: number, k = 1) {
  const rows: [string, string, string, number, string][] = [
    ['#3', 'beta', 'Android · Flutter', 10, 'rolling out'],
    ['#2', 'stable', 'Windows', 50, 'rolling out'],
    ['#1', 'stable', 'iOS (internal)', 100, 'complete'],
    ['#4', 'beta', 'React Native', 0, 'paused'],
  ];
  rows.forEach(([id, ch, plat, pct, st], i) => {
    const yy = y + i * 62 * k;
    fillRR(c, x, yy, w, 52 * k, 8, FE_P);
    text(c, id, x + 16, yy + 32 * k, `800 ${16 * k}px ${SANS}`, FE_L);
    pill(c, x + 52 * k, yy + 15 * k, ch.toUpperCase(), ch === 'beta' ? '#3b2f12' : '#14324a', ch === 'beta' ? FE_G : '#7fc4ff', 9 * k, 8);
    text(c, plat, x + 140 * k, yy + 32 * k, `500 ${12 * k}px ${SANS}`, '#8d9ab0');
    const bx = x + w * 0.6, bw = w * 0.24;
    fillRR(c, bx, yy + 22 * k, bw, 8 * k, 4, '#1f2a40');
    if (pct > 0) fillRR(c, bx, yy + 22 * k, Math.max(8, bw * pct / 100), 8 * k, 4, st === 'paused' ? '#5b6577' : FE_G);
    text(c, `${pct}%`, x + w - 16, yy + 32 * k, `800 ${15 * k}px ${MONO}`, st === 'paused' ? '#5b6577' : FE_L, 'right');
  });
}
const ferman: Draw[] = [
  // cover: navy, gold wordmark, rollout card
  (c) => {
    c.fillStyle = FE_N;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    const g = c.createRadialGradient(780, 340, 20, 780, 340, 420);
    g.addColorStop(0, 'rgba(232,176,74,.22)');
    g.addColorStop(1, 'rgba(232,176,74,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, '◆ FERMAN', ['Docs', 'Self-host', 'CLI', 'GitHub'], FE_L, 40, `800 14px ${SANS}`);
    shadow(c, 0, 'rgba(0,0,0,.5)', 5);
    text(c, 'FERMAN', 66, 220, `400 190px ${COND}`, FE_G, 'left', 2);
    noShadow(c);
    text(c, 'Self-hosted live updates.', 72, 280, `800 32px ${SANS}`, FE_L, 'left', -1);
    para(c, 'An update engine and server in Rust for sideloaded and enterprise apps. Signed patches, channels and staged rollouts.', 74, 322, 380, 15, 22, '#8d9ab0', 500);
    fillRR(c, 74, 400, 300, 44, 8, '#05080f');
    text(c, '$ ferman patch --channel beta --rollout 10', 90, 427, `400 11px ${MONO}`, FE_G);
    ['Android', 'Windows', 'iOS', 'Flutter', 'React Native'].forEach((t, i, a) => {
      let x = 74;
      for (let j = 0; j < i; j++) { c.font = `700 10px ${SANS}`; x += c.measureText(a[j].toUpperCase()).width + 30; }
      pill(c, x, 520, t.toUpperCase(), '#16203a', FE_L, 10, 9);
    });
    shadow(c, 40, 'rgba(0,0,0,.5)', 16);
    fillRR(c, 520, 262, 440, 292, 12, '#0e1524');
    noShadow(c);
    text(c, 'ROLLOUTS', 542, 294, `800 11px ${SANS}`, FE_G, 'left', 2);
    text(c, 'acme / field-app', 940, 294, `400 11px ${MONO}`, '#5b6577', 'right');
    rolloutPanel(c, 536, 312, 408, 0.92);
  },
  // dashboard
  (c) => {
    c.fillStyle = '#0c1220';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = '#080c16';
    c.fillRect(0, 0, 200, SLIDE_H);
    text(c, '◆ FERMAN', 24, 46, `800 15px ${SANS}`, FE_G, 'left', 1);
    ['Apps', 'Releases', 'Channels', 'Signing keys', 'Tenants', 'Settings'].forEach((t, i) => {
      if (i === 1) fillRR(c, 12, 74 + i * 38, 176, 30, 6, '#16203a');
      text(c, t, 28, 94 + i * 38, `500 13px ${SANS}`, i === 1 ? '#fff' : '#6c7891');
    });
    fillRR(c, 16, SLIDE_H - 70, 168, 50, 8, '#111a2c');
    text(c, 'TENANT', 30, SLIDE_H - 50, `700 9px ${SANS}`, '#5b6577', 'left', 1);
    text(c, 'acme-logistics', 30, SLIDE_H - 32, `500 12px ${MONO}`, FE_L);
    text(c, 'Releases', 236, 72, `800 28px ${SANS}`, '#fff', 'left', -0.5);
    text(c, 'field-app · com.acme.field', 236, 98, `400 13px ${MONO}`, '#6c7891');
    fillRR(c, SLIDE_W - 190, 50, 150, 36, 8, FE_G);
    text(c, '+ New release', SLIDE_W - 115, 73, `800 13px ${SANS}`, FE_N, 'center');
    ['ID', 'CHANNEL', 'PLATFORM', 'ROLLOUT', ''].forEach((t, i) => text(c, t, [252, 288, 376, 675, 0][i], 140, `700 9px ${SANS}`, '#5b6577', 'left', 1.5));
    rolloutPanel(c, 236, 156, SLIDE_W - 276, 1);
    fillRR(c, 236, 420, SLIDE_W - 276, 120, 8, FE_P);
    text(c, 'PATCH #3 · SIGNED', 256, 450, `800 11px ${SANS}`, FE_G, 'left', 1.5);
    text(c, 'Rollout 10% → next: ferman rollout 3 50', 256, 478, `400 13px ${MONO}`, FE_L);
    ['Pause', 'Promote to stable', 'Rollback'].forEach((t, i) => {
      const x = 256 + i * 150;
      fillRR(c, x, 496, 138, 30, 6, i === 1 ? FE_G : '#1f2a40');
      text(c, t, x + 69, 516, `700 12px ${SANS}`, i === 1 ? FE_N : FE_L, 'center');
    });
  },
  // CLI
  (c) => {
    c.fillStyle = FE_G;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'SHIP. STAGE.', 46, 120, `400 104px ${COND}`, FE_N, 'left', 1);
    text(c, 'ROLL BACK.', 46, 218, `400 104px ${COND}`, FE_N, 'left', 1);
    term(c, 46, 250, SLIDE_W - 92, 310, 'ferman — zsh', [
      ['$ ferman keygen', FE_L],
      ['$ ferman app-create field-app', FE_L],
      ['$ ferman release', FE_L],
      ['$ ferman patch --channel beta --rollout 10', FE_G],
      ['  ✔ patch #3 signed · beta · 10%', TERM_G],
      ['$ ferman rollout 3 50', FE_L],
      ['$ ferman promote 3 --channel stable', FE_L],
      ['$ ferman pause 3          # or: ferman rollback', '#8d9ab0'],
    ], '#070b14', 15, 30);
  },
  // platforms + C ABI + deploy
  (c) => {
    c.fillStyle = FE_N;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'One engine.', 46, 110, `800 54px ${SANS}`, '#fff', 'left', -2);
    text(c, 'Every sideloaded app.', 46, 172, `800 54px ${SANS}`, FE_G, 'left', -2);
    const plats = ['Android', 'Windows', 'iOS (internal)', 'Flutter', 'React Native'];
    plats.forEach((t, i) => {
      const x = 46 + i * 184;
      fillRR(c, x, 214, 170, 96, 10, FE_P);
      check(c, x + 26, 242, 10, FE_G, FE_N);
      text(c, t, x + 18, 290, `700 17px ${SANS}`, FE_L);
    });
    fillRR(c, 46, 340, 440, 210, 10, '#070b14');
    text(c, 'C ABI', 66, 372, `800 11px ${SANS}`, FE_G, 'left', 2);
    code(c, 102, 406, [
      [['#include ', KW], ['"ferman.h"', ST]],
      [],
      [['// link against libferman', '#5c6370']],
      [['ferman_check_update', FN], ['(ctx);', PL]],
      [['ferman_apply_patch', FN], ['(ctx);', PL]],
    ], 13, 26);
    fillRR(c, 512, 340, 450, 210, 10, '#070b14');
    text(c, 'DEPLOY · DOCKER + CADDY', 532, 372, `800 11px ${SANS}`, FE_G, 'left', 2);
    code(c, 568, 406, [
      [['$ ', PL], ['docker compose ', FN], ['up -d', PL]],
      [['  ✔ ', TERM_G], ['ferman-server', PL], ['  running', TERM_G]],
      [['  ✔ ', TERM_G], ['caddy', PL], ['          https on', TERM_G]],
      [],
      [['your server, your keys, your rollout', '#5c6370']],
    ], 13, 26);
  },
];

// ------------------------------------------------------------------ Cached Network Image CE
const CN_B = '#02569b', CN_A = '#ffb300', CN_L = '#f5f9ff';
/** procedural "photo": gradient landscape blocks */
function photo(c: C, x: number, y: number, w: number, h: number, k: number) {
  const pal = [['#ff9a62', '#ffd27a', '#5a3d7a'], ['#4fb3ff', '#cdeeff', '#1d6b4f'], ['#ff6f91', '#ffc3a0', '#2d2a5a'], ['#76e4c3', '#e9fff6', '#126a73'],
    ['#ffcf5c', '#fff3c9', '#a1452b'], ['#9b8cff', '#e3dcff', '#2b2d6e'], ['#ff8a5c', '#ffe0c2', '#344b5e'], ['#5ad1ff', '#fff', '#2f5d3a']][k % 8];
  c.save();
  rr(c, x, y, w, h, Math.min(w, h) * 0.06);
  c.clip();
  c.fillStyle = grad(c, x, y, x, y + h, [[0, pal[0]], [1, pal[1]]]);
  c.fillRect(x, y, w, h);
  c.beginPath();
  c.arc(x + w * (0.3 + (k % 3) * 0.2), y + h * 0.42, Math.min(w, h) * 0.12, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,.75)';
  c.fill();
  c.fillStyle = pal[2];
  c.beginPath();
  c.moveTo(x, y + h);
  c.lineTo(x, y + h * 0.7);
  c.lineTo(x + w * 0.35, y + h * (0.45 + (k % 2) * 0.1));
  c.lineTo(x + w * 0.6, y + h * 0.68);
  c.lineTo(x + w * 0.8, y + h * 0.55);
  c.lineTo(x + w, y + h * 0.72);
  c.lineTo(x + w, y + h);
  c.fill();
  c.restore();
}
function galleryScreen(c: C, w: number, h: number) {
  c.fillStyle = '#fff';
  c.fillRect(0, 0, w, h);
  statusBar(c, w, '#111');
  text(c, 'Explore', w * 0.07, w * 0.33, `800 ${w * 0.1}px ${SANS}`, '#111');
  const g = w * 0.03, cw = (w - g * 3) / 2;
  for (let i = 0; i < 8; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const ch = cw * (row % 2 === col ? 1.25 : 0.95);
    let yy = w * 0.42;
    for (let r = 0; r < row; r++) yy += cw * (r % 2 === col ? 1.25 : 0.95) + g;
    photo(c, g + col * (cw + g), yy, cw, ch, i);
  }
}
const cni: Draw[] = [
  // cover: flutter blue, headline, phone with an image grid, 8× chip
  (c) => {
    c.fillStyle = grad(c, 0, 0, SLIDE_W, SLIDE_H, [[0, '#0466c8'], [1, CN_B]]);
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, 'cached_network_image_ce', ['pub.dev', 'Docs', 'Migration', 'GitHub'], '#fff', 40, `700 14px ${MONO}`);
    shadow(c, 0, 'rgba(0,20,60,.45)', 5);
    text(c, 'Zero-jank', 72, 160, `900 74px ${BLACK}`, '#fff', 'left', -3);
    text(c, 'image caching', 72, 240, `900 74px ${BLACK}`, '#fff', 'left', -3);
    text(c, 'for Flutter.', 72, 320, `900 74px ${BLACK}`, CN_A, 'left', -3);
    noShadow(c);
    para(c, 'The maintained fork of cached_network_image. Rebuilt on hive_ce. Same API.', 76, 370, 380, 16, 22, 'rgba(255,255,255,.88)', 500);
    fillRR(c, 76, 424, 330, 44, 8, 'rgba(0,0,0,.28)');
    text(c, '$ flutter pub add cached_network_image_ce', 92, 451, `400 12px ${MONO}`, '#fff');
    phone(c, 660, 80, 230, (cc, w, h) => galleryScreen(cc, w, h), '#0c0c0f', 0.04);
    c.save();
    c.translate(600, 470);
    c.rotate(-0.08);
    shadow(c, 24, 'rgba(0,0,0,.3)', 8);
    fillRR(c, 0, 0, 230, 74, 14, CN_A);
    noShadow(c);
    text(c, '8×', 18, 56, `900 50px ${BLACK}`, '#111', 'left', -2);
    text(c, 'faster', 106, 34, `800 15px ${SANS}`, '#111');
    text(c, 'cache reads', 106, 54, `800 15px ${SANS}`, '#111');
    c.restore();
  },
  // pub.dev style package page
  (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    c.fillStyle = '#132030';
    c.fillRect(0, 0, SLIDE_W, 60);
    text(c, 'pub.dev', 44, 38, `800 18px ${SANS}`, '#fff');
    fillRR(c, 300, 16, 420, 28, 14, '#1f3247');
    text(c, 'Search packages', 320, 35, `400 12px ${SANS}`, '#7d93ab');
    c.fillStyle = '#f5f7fa';
    c.fillRect(0, 60, SLIDE_W, 150);
    text(c, 'cached_network_image_ce', 44, 118, `700 34px ${SANS}`, '#1a2733', 'left', -0.5);
    text(c, 'Zero-jank image caching for Flutter. Maintained fork of cached_network_image.', 44, 148, `400 14px ${SANS}`, '#4a5866');
    ['ANDROID', 'IOS', 'WEB', 'MACOS', 'WINDOWS', 'LINUX'].forEach((t, i) => {
      fillRR(c, 44 + i * 82, 166, 74, 22, 4, '#e3edf8');
      text(c, t, 81 + i * 82, 181, `700 10px ${SANS}`, CN_B, 'center', 1);
    });
    ['Readme', 'Changelog', 'Example', 'Installing', 'Versions', 'Scores'].forEach((t, i) => {
      text(c, t, 44 + i * 110, 240, `600 13px ${SANS}`, i === 0 ? CN_B : '#6b7785');
      if (i === 0) { c.fillStyle = CN_B; c.fillRect(44, 250, 50, 3); }
    });
    text(c, 'Drop-in replacement', 44, 300, `800 22px ${SANS}`, '#1a2733');
    para(c, 'Same widget and provider API. Swaps sqflite for hive_ce: pure Dart, no platform channel.', 44, 330, 520, 14, 21, '#4a5866');
    fillRR(c, 44, 368, 560, 170, 8, '#0f1720');
    code(c, 84, 404, [
      [['CachedNetworkImage', TY], ['(', PL]],
      [['  imageUrl: ', PL], ["'https://picsum.photos/400'", ST], [',', PL]],
      [['  placeholder: ', PL], ['(_, __) => ', PL], ['const ', KW], ['Shimmer', TY], ['(),', PL]],
      [['  errorWidget: ', PL], ['(_, __, ___) => ', PL], ['const ', KW], ['Icon', TY], ['(Icons.error),', PL]],
      [[');', PL]],
    ], 13, 25);
    fillRR(c, 650, 280, 314, 258, 10, '#f5f7fa');
    text(c, '★ 74', 676, 326, `800 30px ${SANS}`, '#1a2733');
    text(c, 'GITHUB STARS', 676, 348, `700 10px ${SANS}`, '#6b7785', 'left', 1);
    fillRR(c, 676, 372, 262, 46, 8, '#fff');
    text(c, '◆ Featured on Flutter Gems', 692, 401, `700 13px ${SANS}`, CN_B);
    text(c, 'STORAGE', 676, 452, `700 10px ${SANS}`, '#6b7785', 'left', 1);
    text(c, 'hive_ce · pure Dart', 676, 474, `500 14px ${MONO}`, '#1a2733');
    text(c, 'PLATFORMS', 676, 506, `700 10px ${SANS}`, '#6b7785', 'left', 1);
    text(c, 'all six', 676, 526, `500 14px ${MONO}`, '#1a2733');
  },
  // before / after table
  (c) => {
    c.fillStyle = CN_L;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Same API.', 52, 108, `900 54px ${BLACK}`, '#0b2a4a', 'left', -2);
    text(c, 'Maintained again.', 52, 172, `900 54px ${BLACK}`, CN_B, 'left', -2);
    const x0 = 52, w = SLIDE_W - 104;
    shadow(c, 24, 'rgba(2,86,155,.12)', 8);
    fillRR(c, x0, 214, w, 340, 12, '#fff');
    noShadow(c);
    fillRR(c, x0 + w * 0.68, 214, w * 0.32, 340, 12, CN_B);
    text(c, 'cached_network_image', x0 + w * 0.36, 252, `700 14px ${MONO}`, '#6b7785');
    text(c, '_ce', x0 + w * 0.7, 252, `800 16px ${MONO}`, '#fff');
    const rows: [string, string, string][] = [
      ['Maintenance', 'unmaintained since Aug 2024', 'active'],
      ['Open issues', '300+', 'triaged'],
      ['Cache store', 'sqflite (platform channel)', 'hive_ce (pure Dart)'],
      ['Cache reads', '1×', '8× faster'],
      ['Platforms', 'partial', 'android · ios · web · desktop'],
      ['API', '—', 'same widgets & providers'],
    ];
    rows.forEach(([k, a, b], i) => {
      const y = 296 + i * 42;
      c.fillStyle = 'rgba(11,42,74,.08)';
      c.fillRect(x0 + 20, y - 28, w * 0.66, 1);
      text(c, k, x0 + 22, y, `700 14px ${SANS}`, '#0b2a4a');
      text(c, a, x0 + w * 0.36, y, `500 13px ${SANS}`, '#8a96a3');
      text(c, b, x0 + w * 0.7, y, `800 14px ${SANS}`, i === 3 ? CN_A : '#fff');
    });
  },
  // big 8× + phones
  (c) => {
    c.fillStyle = '#081a2e';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, '8×', 40, 330, `900 300px ${BLACK}`, CN_A, 'left', -16);
    text(c, 'faster cache reads.', 52, 390, `800 36px ${SANS}`, '#fff', 'left', -1);
    para(c, 'No platform channel on the hot path, so scrolling a long image feed stays smooth.', 54, 432, 380, 16, 23, '#8fb1d3', 500);
    phone(c, 560, 80, 190, (cc, w, h) => galleryScreen(cc, w, h), '#0c0c0f', -0.05);
    phone(c, 770, 110, 190, (cc, w, h) => {
      cc.fillStyle = '#0d0d10';
      cc.fillRect(0, 0, w, h);
      statusBar(cc, w, '#fff');
      for (let i = 0; i < 4; i++) {
        const y = w * 0.25 + i * w * 0.62;
        photo(cc, w * 0.05, y, w * 0.9, w * 0.5, i + 3);
        cc.fillStyle = '#333';
        cc.fillRect(w * 0.05, y + w * 0.53, w * 0.5, w * 0.03);
      }
    }, '#0c0c0f', 0.05);
  },
];

// ------------------------------------------------------------------ Elek: incremental test runner
const EL_L = '#c8ff00', EL_K = '#101010';
function sieve(c: C, cx: number, cy: number, r: number, col: string, hole: string) {
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = col;
  c.fill();
  c.lineWidth = r * 0.06;
  c.strokeStyle = hole;
  c.stroke();
  const s = r * 0.13;
  for (let y = -r; y <= r; y += s) for (let x = -r; x <= r; x += s) {
    if (x * x + y * y > (r * 0.86) ** 2) continue;
    c.beginPath();
    c.arc(cx + x, cy + y, s * 0.28, 0, Math.PI * 2);
    c.fillStyle = hole;
    c.fill();
  }
}
const elek: Draw[] = [
  // cover: lime block, 107×
  (c) => {
    c.fillStyle = EL_L;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    nav(c, 'elek', ['Docs', 'Benchmarks', 'pub.dev', 'GitHub'], EL_K, 40, `900 22px ${BLACK}`);
    text(c, '107×', 60, 300, `900 236px ${BLACK}`, EL_K, 'left', -14);
    text(c, 'Your coding agent is fast.', 72, 372, `800 30px ${SANS}`, EL_K, 'left', -1);
    text(c, "Your test suite isn't.", 72, 410, `800 30px ${SANS}`, EL_K, 'left', -1);
    fillRR(c, 72, 446, 236, 44, 8, EL_K);
    text(c, '$ dart pub add dev:elek', 88, 473, `400 13px ${MONO}`, EL_L);
    text(c, 'INCREMENTAL TEST RUNNER · DART & FLUTTER · 0.1 EXPERIMENTAL', 72, 556, `700 10px ${SANS}`, EL_K, 'left', 1.5);
    sieve(c, 820, 330, 140, EL_K, EL_L);
    // a few "test files" falling through
    for (let i = 0; i < 6; i++) fillRR(c, 740 + i * 30, 500 + (i % 3) * 18, 18, 22, 3, EL_K);
  },
  // benchmark bars
  (c) => {
    c.fillStyle = EL_K;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Benchmarks', 52, 86, `900 44px ${BLACK}`, '#fff', 'left', -2);
    text(c, '265 test files · 2230 tests · full run 192.5 s', 54, 118, `500 15px ${MONO}`, '#8a8a8a');
    const rows: [string, number, string][] = [
      ['test file changed', 3.9, '49×'],
      ['controller changed (17 files)', 16.1, '12×'],
      ['nothing changed', 1.8, '107×'],
    ];
    const bx = 330, bw = SLIDE_W - bx - 160;
    rows.forEach(([lbl, t, x], i) => {
      const y = 180 + i * 128;
      text(c, lbl, 52, y + 26, `700 16px ${SANS}`, '#fff');
      text(c, 'dart test', 52, y + 72, `500 12px ${MONO}`, '#6a6a6a');
      text(c, 'elek', 52, y + 100, `500 12px ${MONO}`, EL_L);
      fillRR(c, bx, y + 58, bw, 20, 4, '#2c2c2c');
      text(c, '192.5 s', bx + bw + 12, y + 74, `500 13px ${MONO}`, '#8a8a8a');
      fillRR(c, bx, y + 86, Math.max(6, (bw * t) / 192.5), 20, 4, EL_L);
      text(c, `${t} s`, bx + Math.max(6, (bw * t) / 192.5) + 12, y + 102, `700 13px ${MONO}`, EL_L);
      text(c, x, SLIDE_W - 52, y + 34, `900 44px ${BLACK}`, EL_L, 'right', -2);
    });
  },
  // terminal run
  (c) => {
    c.fillStyle = EL_L;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Run only what changed.', 46, 96, `900 48px ${BLACK}`, EL_K, 'left', -2);
    term(c, 46, 130, SLIDE_W - 92, 430, 'my_app — elek', [
      ['$ dart run elek --dry-run', '#ddd'],
      ['  fingerprinting test inputs …  265 files', '#9a9a9a'],
      ['  green last time, unchanged   264 files  → skip', '#9a9a9a'],
      ['  to run                         1 file', EL_L],
      ['', ''],
      ['$ dart run elek --shards 4', '#ddd'],
      ['  shards balanced by past durations', '#9a9a9a'],
      ['  [1/4] ████████████  [2/4] ███████████', EL_L],
      ['  [3/4] ████████████  [4/4] ████████████', EL_L],
      ['', ''],
      ['  ✔ all green · 3.9 s  (dart test: 192.5 s)', TERM_G],
      ['$ ▌', '#ddd'],
    ], '#0b0b0b', 15, 29);
  },
  // what "elek" means
  (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'elek', 52, 170, `900 150px ${BLACK}`, EL_K, 'left', -8);
    text(c, '/eˈlek/  noun, Turkish:', 58, 214, `500 16px ${SANS}`, '#777');
    text(c, 'sieve.', 248, 214, `900 16px ${SANS}`, EL_K);
    sieve(c, 800, 170, 120, EL_L, EL_K);
    const steps: [string, string][] = [
      ['01 FINGERPRINT', 'Hash every test file and the inputs it depends on.'],
      ['02 SKIP GREEN', 'Files that passed last time with the same fingerprint are skipped.'],
      ['03 SHARD', 'The rest are bundled into shards balanced by past durations.'],
    ];
    steps.forEach(([h, d], i) => {
      const x = 52 + i * 308;
      fillRR(c, x, 330, 292, 200, 8, i === 1 ? EL_L : '#f2f2f2');
      text(c, h, x + 22, 372, `900 17px ${BLACK}`, EL_K, 'left', 1);
      para(c, d, x + 22, 418, 248, 16, 23, '#333', 500);
    });
  },
];

// ------------------------------------------------------------------ Subara: subscription manager (Liquid Glass)
const SU_V = '#5b3df5', SU_P = '#ff8fc7', SU_L = '#f6f3ff';
const SERVICES: [string, string, string, string][] = [
  ['Streamly', '9.99', '#ff4f6d', 'S'],
  ['Tunebox', '5.99', '#22c55e', 'T'],
  ['CloudNest', '2.99', '#3b82f6', 'C'],
  ['Gymflow', '24.00', '#f59e0b', 'G'],
  ['Notely Pro', '4.49', '#8b5cf6', 'N'],
];
function glass(c: C, x: number, y: number, w: number, h: number, r: number, a = 0.18) {
  shadow(c, 24, 'rgba(40,10,120,.28)', 8);
  fillRR(c, x, y, w, h, r, `rgba(255,255,255,${a})`);
  noShadow(c);
  c.strokeStyle = 'rgba(255,255,255,.55)';
  c.lineWidth = 1.2;
  rr(c, x + 0.5, y + 0.5, w - 1, h - 1, r);
  c.stroke();
  c.fillStyle = grad(c, x, y, x, y + h * 0.5, [[0, 'rgba(255,255,255,.28)'], [1, 'rgba(255,255,255,0)']]);
  rr(c, x + 2, y + 2, w - 4, h * 0.5, r);
  c.fill();
}
function suBg(c: C, w: number, h: number) {
  c.fillStyle = grad(c, 0, 0, w, h, [[0, '#7b5cff'], [0.55, SU_V], [1, '#2a1585']]);
  c.fillRect(0, 0, w, h);
  const blobs: [number, number, number, string][] = [[0.85, 0.2, 0.5, 'rgba(255,143,199,.75)'], [0.1, 0.85, 0.45, 'rgba(255,143,199,.45)'], [0.3, 0.1, 0.35, 'rgba(140,220,255,.35)']];
  for (const [bx, by, br, col] of blobs) {
    const g = c.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, br * Math.max(w, h));
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(255,143,199,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}
function serviceIcon(c: C, x: number, y: number, s: number, col: string, ch: string) {
  fillRR(c, x, y, s, s, s * 0.28, col);
  text(c, ch, x + s / 2, y + s * 0.7, `900 ${s * 0.55}px ${SANS}`, '#fff', 'center');
}
function subaraList(c: C, w: number, h: number) {
  suBg(c, w, h);
  statusBar(c, w, '#fff');
  // dynamic island live activity
  fillRR(c, w * 0.18, w * 0.05, w * 0.64, w * 0.11, w * 0.055, '#000');
  serviceIcon(c, w * 0.21, w * 0.065, w * 0.08, '#ff4f6d', 'S');
  text(c, 'Renews in 2 days', w * 0.78, w * 0.125, `600 ${w * 0.042}px ${SANS}`, '#fff', 'right');
  text(c, 'This month', w * 0.07, w * 0.3, `500 ${w * 0.045}px ${SANS}`, 'rgba(255,255,255,.75)');
  text(c, '$47.46', w * 0.07, w * 0.42, `800 ${w * 0.13}px ${SANS}`, '#fff', 'left', -1);
  SERVICES.forEach(([n, pr, col, ch], i) => {
    const y = w * 0.5 + i * w * 0.23;
    glass(c, w * 0.05, y, w * 0.9, w * 0.19, w * 0.06, 0.16);
    serviceIcon(c, w * 0.09, y + w * 0.04, w * 0.11, col, ch);
    text(c, n, w * 0.25, y + w * 0.09, `700 ${w * 0.05}px ${SANS}`, '#fff');
    text(c, i === 3 ? 'trial · 5 days left' : `in ${3 + i * 4} days`, w * 0.25, y + w * 0.145, `500 ${w * 0.036}px ${SANS}`, 'rgba(255,255,255,.7)');
    text(c, `$${pr}`, w * 0.9, y + w * 0.115, `800 ${w * 0.05}px ${SANS}`, '#fff', 'right');
  });
}
function donut(c: C, cx: number, cy: number, r: number, lw: number) {
  const parts = [0.21, 0.13, 0.06, 0.5, 0.1];
  let a = -Math.PI / 2;
  parts.forEach((f, i) => {
    c.beginPath();
    c.arc(cx, cy, r, a + 0.03, a + f * Math.PI * 2 - 0.03);
    c.strokeStyle = SERVICES[i][2];
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.stroke();
    a += f * Math.PI * 2;
  });
  c.lineCap = 'butt';
}
const subara: Draw[] = [
  // cover: violet→pink glass, huge wordmark, phone
  (c) => {
    suBg(c, SLIDE_W, SLIDE_H);
    nav(c, 'Subara', ['Features', 'Widgets', 'Privacy', 'App Store'], '#fff', 40, `800 18px ${SANS}`);
    shadow(c, 0, 'rgba(30,0,90,.35)', 6);
    text(c, 'Every', 72, 170, `900 92px ${BLACK}`, '#fff', 'left', -4);
    text(c, 'subscription.', 72, 262, `900 76px ${BLACK}`, '#fff', 'left', -4);
    text(c, 'One place.', 72, 346, `900 76px ${BLACK}`, SU_P, 'left', -4);
    noShadow(c);
    para(c, 'Track renewals, see where the money goes, get a nudge before you pay. Your data never leaves the phone.', 76, 392, 360, 16, 22, 'rgba(255,255,255,.88)', 500);
    fillRR(c, 76, 466, 170, 48, 24, '#fff');
    text(c, ' App Store', 161, 496, `800 15px ${SANS}`, SU_V, 'center');
    text(c, 'FREE · IPHONE & IPAD', 264, 496, `700 11px ${SANS}`, '#fff', 'left', 1.5);
    phone(c, 640, 66, 240, (cc, w, h) => subaraList(cc, w, h), '#14102a', 0.05);
    glass(c, 520, 420, 200, 84, 22, 0.24);
    text(c, 'Streamly', 548, 452, `800 15px ${SANS}`, '#fff');
    text(c, 'Renews in 2 days · $9.99', 548, 478, `500 12px ${SANS}`, 'rgba(255,255,255,.85)');
  },
  // spending trend + donut
  (c) => {
    c.fillStyle = SU_L;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    text(c, 'Where it all goes.', 52, 104, `900 50px ${BLACK}`, '#1d1450', 'left', -2);
    text(c, 'Interactive spending trends, by month and by service.', 54, 140, `500 16px ${SANS}`, '#6b6390');
    shadow(c, 30, 'rgba(91,61,245,.15)', 10);
    fillRR(c, 52, 180, 560, 370, 18, '#fff');
    noShadow(c);
    text(c, 'Spending', 80, 222, `800 18px ${SANS}`, '#1d1450');
    ['6M', '1Y', 'ALL'].forEach((t, i) => { fillRR(c, 440 + i * 52, 204, 46, 26, 13, i === 1 ? SU_V : '#efeaff'); text(c, t, 463 + i * 52, 222, `800 11px ${SANS}`, i === 1 ? '#fff' : SU_V, 'center'); });
    const vals = [31, 34, 33, 38, 36, 41, 40, 44, 43, 47, 45, 47];
    const bx = 84, bw = 500, bh = 250, by = 520;
    c.beginPath();
    vals.forEach((v, i) => { const x = bx + (i / 11) * bw, y = by - ((v - 25) / 25) * bh; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.lineWidth = 4;
    c.strokeStyle = SU_V;
    c.stroke();
    c.lineTo(bx + bw, by);
    c.lineTo(bx, by);
    c.fillStyle = grad(c, 0, by - bh, 0, by, [[0, 'rgba(91,61,245,.28)'], [1, 'rgba(255,143,199,0)']]);
    c.fill();
    const hx = bx + (9 / 11) * bw, hy = by - ((47 - 25) / 25) * bh;
    c.beginPath(); c.arc(hx, hy, 8, 0, Math.PI * 2); c.fillStyle = SU_P; c.fill();
    fillRR(c, hx - 50, hy - 50, 100, 32, 10, '#1d1450');
    text(c, 'Oct · $47.46', hx, hy - 29, `700 12px ${SANS}`, '#fff', 'center');
    'JFMAMJJASOND'.split('').forEach((m, i) => text(c, m, bx + (i / 11) * bw, by + 22, `600 11px ${SANS}`, '#a39cc4', 'center'));
    shadow(c, 30, 'rgba(91,61,245,.15)', 10);
    fillRR(c, 640, 180, 316, 370, 18, '#fff');
    noShadow(c);
    donut(c, 798, 320, 84, 26);
    text(c, '$47', 798, 330, `900 32px ${BLACK}`, '#1d1450', 'center');
    SERVICES.slice(0, 4).forEach(([n, pr, col], i) => {
      const y = 448 + i * 24;
      fillRR(c, 668, y - 10, 10, 10, 3, col);
      text(c, n, 688, y, `600 13px ${SANS}`, '#1d1450');
      text(c, `$${pr}`, 928, y, `700 13px ${SANS}`, '#6b6390', 'right');
    });
  },
  // payment calendar + notification
  (c) => {
    c.fillStyle = '#120b33';
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    const g = c.createRadialGradient(300, 300, 0, 300, 300, 420);
    g.addColorStop(0, 'rgba(255,143,199,.25)');
    g.addColorStop(1, 'rgba(255,143,199,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, SLIDE_W, SLIDE_H);
    glass(c, 52, 60, 470, 480, 26, 0.08);
    text(c, 'November', 84, 112, `800 26px ${SANS}`, '#fff');
    text(c, '2026', 488, 112, `600 15px ${SANS}`, 'rgba(255,255,255,.6)', 'right');
    'MTWTFSS'.split('').forEach((d, i) => text(c, d, 104 + i * 60, 152, `700 12px ${SANS}`, 'rgba(255,255,255,.5)', 'center'));
    const dots: Record<number, number> = { 3: 0, 9: 1, 12: 2, 14: 3, 21: 4, 27: 0 };
    for (let d = 1; d <= 30; d++) {
      const i = d + 5 - 1, x = 104 + (i % 7) * 60, y = 196 + Math.floor(i / 7) * 62;
      if (d === 12) fillRR(c, x - 22, y - 24, 44, 50, 14, SU_P);
      text(c, String(d), x, y, `700 16px ${SANS}`, d === 12 ? '#1d1450' : '#fff', 'center');
      if (dots[d] !== undefined) { c.beginPath(); c.arc(x, y + 14, 4, 0, Math.PI * 2); c.fillStyle = d === 12 ? '#1d1450' : SERVICES[dots[d]][2]; c.fill(); }
    }
    text(c, 'Never get', 570, 150, `900 50px ${BLACK}`, '#fff', 'left', -2);
    text(c, 'surprised', 570, 210, `900 50px ${BLACK}`, SU_P, 'left', -2);
    text(c, 'by a renewal.', 570, 270, `900 50px ${BLACK}`, '#fff', 'left', -2);
    glass(c, 570, 320, 390, 88, 22, 0.2);
    serviceIcon(c, 590, 342, 44, '#3b82f6', 'C');
    text(c, 'SUBARA · now', 648, 352, `700 11px ${SANS}`, 'rgba(255,255,255,.65)', 'left', 1);
    text(c, 'CloudNest renews tomorrow', 648, 376, `700 16px ${SANS}`, '#fff');
    text(c, '$2.99 · tap to review', 648, 396, `500 13px ${SANS}`, 'rgba(255,255,255,.75)');
    para(c, 'Smart reminders before every payment. A monthly calendar of what is due.', 572, 450, 380, 16, 23, 'rgba(255,255,255,.7)', 500);
  },
  // v0.2: widgets, live activity, privacy
  (c) => {
    suBg(c, SLIDE_W, SLIDE_H);
    text(c, 'NEW IN 0.2', 52, 74, `800 12px ${SANS}`, '#fff', 'left', 2);
    text(c, 'Liquid Glass.', 52, 140, `900 62px ${BLACK}`, '#fff', 'left', -3);
    // widgets
    glass(c, 52, 190, 200, 200, 36, 0.2);
    text(c, 'NEXT', 76, 226, `800 11px ${SANS}`, 'rgba(255,255,255,.75)', 'left', 1.5);
    serviceIcon(c, 76, 242, 52, '#ff4f6d', 'S');
    text(c, 'Streamly', 76, 330, `800 18px ${SANS}`, '#fff');
    text(c, 'in 2 days', 76, 356, `600 14px ${SANS}`, 'rgba(255,255,255,.8)');
    glass(c, 272, 190, 420, 200, 36, 0.2);
    text(c, 'THIS MONTH', 296, 226, `800 11px ${SANS}`, 'rgba(255,255,255,.75)', 'left', 1.5);
    text(c, '$47.46', 296, 290, `900 54px ${BLACK}`, '#fff', 'left', -2);
    SERVICES.forEach(([, , col, ch], i) => serviceIcon(c, 296 + i * 54, 316, 42, col, ch));
    // dynamic island
    fillRR(c, 52, 420, 400, 74, 37, '#000');
    serviceIcon(c, 70, 433, 48, '#f59e0b', 'G');
    text(c, 'Gymflow trial', 132, 452, `700 15px ${SANS}`, '#fff');
    text(c, 'ends in 5 days', 132, 474, `500 13px ${SANS}`, SU_P);
    fillRR(c, 330, 448, 104, 8, 4, '#333');
    fillRR(c, 330, 448, 74, 8, 4, SU_P);
    text(c, 'Dynamic Island · Live Activities', 52, 528, `600 13px ${SANS}`, 'rgba(255,255,255,.85)');
    glass(c, 720, 190, 240, 304, 30, 0.14);
    c.save();
    c.translate(840, 280);
    fillRR(c, -34, -10, 68, 58, 12, '#fff');
    c.beginPath(); c.arc(0, -10, 24, Math.PI, 0); c.lineWidth = 10; c.strokeStyle = '#fff'; c.stroke();
    c.restore();
    text(c, 'Stays on', 840, 384, `900 24px ${BLACK}`, '#fff', 'center', -1);
    text(c, 'your device.', 840, 414, `900 24px ${BLACK}`, '#fff', 'center', -1);
    text(c, 'No data collected.', 840, 448, `600 13px ${SANS}`, 'rgba(255,255,255,.8)', 'center');
    text(c, 'EN · TR · DARK MODE', 840, 474, `700 10px ${SANS}`, 'rgba(255,255,255,.65)', 'center', 1.5);
  },
];

const DESIGNS: Record<string, Draw[]> = { oge, ferman, 'cached-network-image-ce': cni, elek, subara };

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
  const designs = DESIGNS[project.id] ?? oge;
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
