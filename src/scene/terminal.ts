import { CanvasTexture, Mesh, PlaneGeometry, MeshBasicNodeMaterial, RepeatWrapping, SRGBColorSpace, type PerspectiveCamera } from 'three/webgpu';
import { texture, uv, uniform, vec2, float } from 'three/tsl';

// Terminal-log billboard behind the carousel (spec-3d §6.4). Own log text.
const LOG = [
  'eren@lab:~$ flutter build web --release --wasm',
  'Compiling lib/main.dart for the Web...           18.4s',
  '✓ Built build/web',
  'eren@lab:~$ dart run build_runner build -d',
  '[INFO] Generating build script completed, took 412ms',
  '[INFO] Running build completed, took 9.1s',
  'eren@lab:~$ rider --name "Tinywall" --package app.tinywall',
  '→ android/app/build.gradle updated',
  '→ ios/Runner/Info.plist updated',
  'eren@lab:~$ git log --oneline | head -3',
  'a1f2c3d feat: riverpod 2 notifier migration',
  'b4e5f6a fix: hive box lazy open on web',
  'c7d8e9f chore: bump go_router to 14.2',
  'eren@lab:~$ flutter test --coverage',
  '00:06 +128: All tests passed!',
  'eren@lab:~$ ssh deploy@erengun.dev',
  'Welcome to Ubuntu 24.04.2 LTS (GNU/Linux 6.8.0 x86_64)',
  'Last login: Wed Nov 12 09:21:44 2026 from 10.0.0.12',
  'deploy@erengun:~$ pm2 status',
  '│ api    │ online │ 0.3% │ 61.2mb │',
  'deploy@erengun:~$ tail -f /var/log/nginx/access.log',
  'GET /blog/10-rules-for-building-reliable-flutter-apps 200',
  'GET /projects/legallens 200',
  'eren@lab:~$ three --renderer webgpu --scene carousel',
  'portal[0] intro  ready   12.1ms',
  'portal[1..4]     ready    8.4ms',
  'portal[5] last   streaming city blocks...',
];

export function createTerminal() {
  const W = 1680, H = 1024, LH = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.font = '20px ui-monospace, Menlo, monospace';
  g.fillStyle = '#000';
  for (let col = 0; col < 2; col++) {
    for (let r = 0; r < H / LH; r++) {
      const line = LOG[(r + col * 13) % LOG.length];
      g.fillText(line, 24 + col * 840, 28 + r * LH);
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  const uScroll = uniform(0);
  const uOpacity = uniform(0);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const t = texture(tex, uv().mul(vec2(1, 4)).add(vec2(0, uScroll)));
  mat.colorNode = t.rgb;
  mat.opacityNode = t.a.mul(uOpacity).mul(float(0.42));
  const mesh = new Mesh(new PlaneGeometry(20, 20 * (H / W) * 4), mat);
  mesh.renderOrder = -10;
  let op = 0;
  return {
    mesh,
    update(dt: number, idx: number, cam: PerspectiveCamera, visible: number) {
      uScroll.value = (uScroll.value + dt * 0.03) % 1;
      const target = idx > 0.3 && idx < 4.7 ? visible : 0;
      op += (target - op) * Math.min(1, dt / 0.3 * 2);
      uOpacity.value = op;
      mesh.visible = op > 0.001;
      mesh.position.set(0, 0, -2);
      mesh.quaternion.copy(cam.quaternion);
    },
  };
}
