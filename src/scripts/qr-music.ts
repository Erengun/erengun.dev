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
/** the recordings (YouTube id, length in seconds) and the pieces in each (where it starts, its name) */
const VIDEOS: { id: string; len: number; pieces: [number, string][] }[] = [
  { id: 'gr2OGRA96L8', len: 1635, pieces: [
    [0, 'Hoca Dehhâni Gazel · Old Anatolian Turkish'], [232, 'Güzel Âşık · Ottoman Turkish'], [512, 'Yürürün · Hacivat Karagöz Neden Öldürüldü'],
    [701, 'Qari Navo · Traditional Turkic Instrument'], [810, 'Nice Bir · Civilization 6 OST'], [930, 'Yelkenler Biçilecek · Civilization 6 OST'],
    [1192, 'Rast Nakış Beste · Civilization 6 OST'], [1321, 'Hicaz Hümâyun Peşrevi · Civilization 6 OST'], [1428, 'Rondo Alla Turca · Mozart'],
  ] },
  { id: 'CnyLI7pl9Ys', len: 90, pieces: [[0, 'Turkey’s Most Stereotypical Music · Victor Lopez']] },
];
/** the programme: every piece, one after the other, round and round */
const TRACKS = VIDEOS.flatMap((v) => v.pieces.map(([start, title], i) => ({ id: v.id, start, len: (v.pieces[i + 1]?.[0] ?? v.len) - start, title })));
const TOTAL = VIDEOS.reduce((a, v) => a + v.len, 0);
/** what the clock says is on now: which recording, and how far into it */
const now = (): { id: string; at: number } => {
  let t = Math.floor(Date.now() / 1000) % TOTAL;
  for (const v of VIDEOS) { if (t < v.len) return { id: v.id, at: t }; t -= v.len; }
  return { id: VIDEOS[0].id, at: 0 };
};
/** the piece that is at second `at` of recording `id` */
const pieceAt = (id: string, at: number) => Math.max(0, TRACKS.findIndex((t) => t.id === id && at >= t.start && at < t.start + t.len));
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
  /** a piece chosen from the list (then the clock no longer decides) */
  let chosen = -1, manual = false;
  let current = pieceAt(now().id, now().at), sounding = false;

  const rows = TRACKS.map((t, index) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="qr__eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="t"></span><span class="d"></span>';
    b.querySelector('.t')!.textContent = t.title;
    b.querySelector('.d')!.textContent = clock(t.len);
    b.addEventListener('click', () => {
      chosen = index; manual = true;
      if (!on) { on = true; try { localStorage.setItem('qr-sound', 'on'); } catch { /* no storage */ } }
      load();
      play();
      show();
    });
    li.appendChild(b);
    list.appendChild(li);
    return { b };
  });

  const show = () => {
    const open = root.dataset.open === 'true';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', !open ? 'Music' : on ? 'Music on. Turn it off' : 'Music off. Turn it on');
    card.hidden = !on;
    title.textContent = on ? TRACKS[current].title.split(' · ')[0] : 'Music off';
    root.dataset.playing = String(on && sounding);
    rows.forEach((r, i) => r.b.setAttribute('aria-current', String(on && i === current)));
  };
  const play = () => {
    if (!on) return;
    if (!ready) { wanted = true; return; }
    player.setVolume(VOLUME);
    player.unMute();
    // load at the clock's place (a seek before the first play is sometimes dropped, and it would start from 0:00);
    // a recording picked from the list starts at its beginning
    const what = chosen >= 0 ? { id: TRACKS[chosen].id, at: TRACKS[chosen].start } : now();
    chosen = -1;
    current = pieceAt(what.id, what.at);
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
            if (e.data === 0 && on) { // at the end of a recording: the next piece on the list, or whatever the clock says
              if (manual) chosen = (TRACKS.map((t) => t.id).lastIndexOf(TRACKS[current].id) + 1) % TRACKS.length;
              play();
            }
            if (e.data === 1) {
              player.setVolume(VOLUME);
              const playing = player.getVideoData?.().video_id;
              if (!manual) { // if it is not where the clock says (it began from the top after all), go there
                const want = now();
                if (playing && playing !== want.id) return void play();
                const len = VIDEOS.find((v) => v.id === want.id)!.len, off = Math.abs(player.getCurrentTime() - want.at);
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
  // the name follows the music from piece to piece
  setInterval(() => {
    if (!ready || !sounding) return;
    const id = player.getVideoData?.().video_id, i = id ? pieceAt(id, player.getCurrentTime()) : current;
    if (i !== current) { current = i; show(); }
  }, 1000);
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
