/**
 * Music for /qr/: YouTube videos played through YouTube's own player, kept out of sight (their audio; nothing is
 * copied here). On by default and very quiet. It never starts from the top: like a radio, the place in the recording
 * follows the clock, so everyone hears the same moment. Browsers only let sound start after a first tap or key.
 */
const VOLUME = 3;
/** the programme: one after the other, round and round (YouTube video id, length in seconds) */
const TRACKS: [string, number][] = [['gr2OGRA96L8', 1635], ['CnyLI7pl9Ys', 90]];
const TOTAL = TRACKS.reduce((a, t) => a + t[1], 0);
/** what the clock says is on now: which recording, and how far into it */
const now = (): { id: string; at: number } => {
  let t = Math.floor(Date.now() / 1000) % TOTAL;
  for (const [id, len] of TRACKS) { if (t < len) return { id, at: t }; t -= len; }
  return { id: TRACKS[0][0], at: 0 };
};

const button = document.querySelector<HTMLButtonElement>('[data-qr-sound]');
const card = document.querySelector<HTMLElement>('[data-qr-player]');
if (button && card) {
  let on = true;
  try { on = localStorage.getItem('qr-sound') !== 'off'; } catch { /* no storage: on */ }
  let player: any = null, ready = false, wanted = false, loading = false;

  const show = () => {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Music on. Turn it off' : 'Music off. Turn it on');
    card.hidden = !on;
  };
  const play = () => {
    if (!on) return;
    if (!ready) { wanted = true; return; }
    player.setVolume(VOLUME);
    player.unMute();
    // load at the clock's place (a seek before the first play is sometimes dropped, and it would start from 0:00)
    const on_ = now();
    player.loadVideoById({ videoId: on_.id, startSeconds: on_.at });
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
            if (e.data === 0 && on) play(); // at the end: whatever the clock says is next
            if (e.data === 1) { // playing: if it is not where the clock says (it began from the top after all), go there
              player.setVolume(VOLUME);
              const want = now(), playing = player.getVideoData?.().video_id;
              if (playing && playing !== want.id) return void play();
              const len = TRACKS.find((t) => t[0] === want.id)![1], off = Math.abs(player.getCurrentTime() - want.at);
              if (off > 8 && off < len - 8) player.seekTo(want.at, true);
            }
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
    if (button.contains(e.target as Node)) return;
    removeEventListener('pointerdown', first, true);
    removeEventListener('keydown', first, true);
    play();
  };
  addEventListener('pointerdown', first, true);
  addEventListener('keydown', first, true);
  button.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem('qr-sound', on ? 'on' : 'off'); } catch { /* no storage */ }
    show();
    if (on) { load(); play(); } else if (ready) player.pauseVideo();
  });
}
