import { Scene, Color, Mesh, BoxGeometry, PlaneGeometry, MeshStandardNodeMaterial, MeshBasicNodeMaterial, DirectionalLight, AmbientLight, Group } from 'three/webgpu';
import type { Portal, PortalContext } from '../types';
import { PORTAL_W, PORTAL_H } from '../types';

/** Stand-in portal scenes so the shell can be verified before the real ones land. */
export function createPlaceholderPortal(_ctx: PortalContext, kind: 'intro' | 'project' | 'last', seed: number, palette?: string[]): Portal {
  const scene = new Scene();
  const background = new Color(kind === 'project' ? palette![0] : '#000000');
  scene.add(new AmbientLight(0xffffff, 0.6));
  const l = new DirectionalLight(0xffffff, 2);
  l.position.set(1, 2, 2);
  scene.add(l);
  const content = new Group();
  scene.add(content);
  if (kind === 'project') {
    const m = new MeshBasicNodeMaterial({ color: new Color(palette![1]) });
    const p = new Mesh(new PlaneGeometry(PORTAL_W * 0.8, PORTAL_H * 0.7), m);
    p.position.z = -0.6;
    content.add(p);
  } else {
    const m = new MeshStandardNodeMaterial({ color: kind === 'intro' ? 0x7fd0d0 : 0xdddddd, roughness: 0.5 });
    for (let i = 0; i < 24; i++) {
      const b = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), m);
      b.position.set(((i % 6) - 2.5) * 0.4, (Math.floor(i / 6) - 1.5) * 0.4, -1.5 - (i % 3) * 0.6);
      content.add(b);
    }
  }
  return {
    scene,
    background,
    ready: Promise.resolve(),
    update(f) {
      content.rotation.y = f.parallax.x * 0.1 * f.focus;
      content.rotation.x = -f.parallax.y * 0.1 * f.focus;
      content.position.z = -f.openness * 0.5 + seed * 0;
    },
  };
}
