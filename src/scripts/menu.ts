// Header menu behaviour (spec-dom §4).
export function initMenu() {
  const nav = document.querySelector<HTMLElement>('[data-menu]')!;
  const trigger = nav.querySelector<HTMLButtonElement>('[data-menu-trigger]')!;
  const list = nav.querySelector<HTMLElement>('[data-menu-list]')!;
  const set = (open: boolean, focusTrigger = false) => {
    nav.toggleAttribute('data-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (focusTrigger) trigger.focus();
  };
  trigger.addEventListener('click', () => set(!nav.hasAttribute('data-open')));
  addEventListener('keydown', (e) => e.key === 'Escape' && nav.hasAttribute('data-open') && set(false, true));
  nav.addEventListener('focusout', (e) => {
    if (!nav.contains(e.relatedTarget as Node)) set(false);
  });
  addEventListener('pointerdown', (e) => {
    if (nav.hasAttribute('data-open') && !nav.contains(e.target as Node)) set(false);
  });
  list.addEventListener('click', (e) => (e.target as Element).closest('a') && set(false));
}
