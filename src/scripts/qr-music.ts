/**
 * Music for /qr/: YouTube videos played through YouTube's own player, kept out of sight (their audio; nothing is
 * copied here). On by default and very quiet. Left alone it never starts from the top: like a radio, the place in
 * the programme follows the clock, so everyone hears the same moment. Browsers only let sound start after a first
 * tap or key.
 *
 * The round button opens into a small player: the name of what is playing with the speaker beside it, and under it
 * the list of recordings; choosing one plays it from its beginning, and the list carries on from there.
 */
const VOLUME = 3;
/** the programme: one after the other, round and round */
const TRACKS: { id: string; len: number; title: string; by: string }[] = [
  { id: 'gr2OGRA96L8', len: 1635, title: 'Old Anatolian Turkish Traditional', by: 'Nezak Huns' },
  { id: 'CnyLI7pl9Ys', len: 90, title: 'Turkey’s Most Stereotypical Music', by: 'Victor Lopez' },
];
const TOTAL = TRACKS.reduce((a, t) => a + t.len, 0);
/** what the clock says is on now: which recording, and how far into it */
const now = (): { id: string; at: number } => {
  let t = Math.floor(Date.now() / 1000) % TOTAL;
  for (const tr of TRACKS) { if (t < tr.len) return { id: tr.id, at: t }; t -= tr.len; }
  return { id: TRACKS[0].id, at: 0 };
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const root = document.querySelector<HTMLElement>('[data-qr-music]');
const button = document.querySelector<HTMLButtonElement>('[data-qr-sound]');
const card = document.querySelector<HTMLElement>('[data-qr-player]');
if (root && button && card) {
  const title = root.querySelector<HTMLElement>('[data-qr-now]')!;
  const list = root.querySelector<HTMLElement>('[data-qr-tracks]')!;
  let on = true;
  try { on = localStorage.getItem('qr-sound') !== 'off'; } catch { /* no storage: on */ }
  let player: any = null, ready = false, wanted = false, loading = false;
  /** a recording chosen from the list (then the clock no longer decides) */
  let chosen: string | null = null;
  let current = now().id, sounding = false;

  const rows = TRACKS.map((t) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="qr__eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="t"></span><span class="d"></span>';
    b.querySelector('.t')!.textContent = `${t.title} · ${t.by}`;
    b.querySelector('.d')!.textContent = clock(t.len);
    b.addEventListener('click', () => {
      chosen = t.id;
      if (!on) { on = true; try { localStorage.setItem('qr-sound', 'on'); } catch { /* no storage */ } }
      load();
      play();
      show();
    });
    li.appendChild(b);
    list.appendChild(li);
    return { id: t.id, b };
  });

  const show = () => {
    const open = root.dataset.open === 'true';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', !open ? 'Music' : on ? 'Music on. Turn it off' : 'Music off. Turn it on');
    card.hidden = !on;
    const tr = TRACKS.find((t) => t.id === (chosen ?? current)) ?? TRACKS[0];
    title.textContent = on ? tr.title : 'Music off';
    root.dataset.playing = String(on && sounding);
    for (const r of rows) r.b.setAttribute('aria-current', String(on && r.id === tr.id));
  };
  const play = () => {
    if (!on) return;
    if (!ready) { wanted = true; return; }
    player.setVolume(VOLUME);
    player.unMute();
    // load at the clock's place (a seek before the first play is sometimes dropped, and it would start from 0:00);
    // a recording picked from the list starts at its beginning
    const what = chosen ? { id: chosen, at: 0 } : now();
    current = what.id;
    player.loadVideoById({ videoId: what.id, startSeconds: what.at });
  };
  const load = () => {
    if (loading) return;
    loading = true;
    (window as any).onYouTubeIframeAPIReady = () => {
      player = new (window as any).YT.Player('qr-yt', {
        host: 'https://www.youtube-nocookie.com', videoId: now().id, width: 200, height: 113,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, start: now().at },
        events: {
          onReady: () => { ready = true; player.setVolume(VOLUME); if (wanted) play(); },
          onStateChange: (e: { data: number }) => {
            sounding = e.data === 1;
            if (e.data === 0 && on) { // at the end: the next on the list after a chosen one, else whatever the clock says
              if (chosen) chosen = TRACKS[(TRACKS.findIndex((t) => t.id === chosen) + 1) % TRACKS.length].id;
              play();
            }
            if (e.data === 1) {
              player.setVolume(VOLUME);
              const playing = player.getVideoData?.().video_id;
              if (playing) current = playing;
              if (!chosen) { // if it is not where the clock says (it began from the top after all), go there
                const want = now();
                if (playing && playing !== want.id) return void play();
                const len = TRACKS.find((t) => t.id === want.id)!.len, off = Math.abs(player.getCurrentTime() - want.at);
                if (off > 8 && off < len - 8) player.seekTo(want.at, true);
              }
            }
            show();
          },
        },
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  };

  show();
  if (on) load(); // ahead of the first tap, so that tap can start it
  const first = (e: Event) => {
    if (root.contains(e.target as Node)) return;
    removeEventListener('pointerdown', first, true);
    removeEventListener('keydown', first, true);
    play();
  };
  addEventListener('pointerdown', first, true);
  addEventListener('keydown', first, true);

  const open = (v: boolean) => { root.dataset.open = String(v); show(); };
  button.addEventListener('click', () => {
    if (root.dataset.open !== 'true') { // closed: the button opens the player (and starts the music if it may)
      open(true);
      if (on && !sounding) { load(); play(); }
      return;
    }
    on = !on; // open: the speaker turns the sound on and off
    try { localStorage.setItem('qr-sound', on ? 'on' : 'off'); } catch { /* no storage */ }
    if (on) { load(); play(); } else { sounding = false; if (ready) player.pauseVideo(); }
    show();
  });
  addEventListener('pointerdown', (e) => {
    if (root.dataset.open !== 'true' || root.contains(e.target as Node)) return;
    open(false);
    if ((e.target as Element).tagName === 'CANVAS') e.stopPropagation(); // a tap on the city only closes the player: it does not also turn the city
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.dataset.open === 'true') { open(false); button.focus(); } });
}
