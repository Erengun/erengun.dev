/**
 * Music for /qr/: a YouTube video played through YouTube's own small player (their audio, their terms; nothing is
 * copied here). On by default and quiet. It does not start from the top: like a radio, the place in the recording
 * follows the clock, so everyone hears the same moment. Browsers only let sound start after a first tap or key.
 */
const VIDEO = 'gr2OGRA96L8', LENGTH = 1635, VOLUME = 16;
const now = () => Math.floor(Date.now() / 1000) % LENGTH;

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
    player.seekTo(now(), true);
    player.playVideo();
  };
  const load = () => {
    if (loading) return;
    loading = true;
    (window as any).onYouTubeIframeAPIReady = () => {
      player = new (window as any).YT.Player('qr-yt', {
        host: 'https://www.youtube-nocookie.com', videoId: VIDEO, width: 200, height: 113,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, start: now() },
        events: {
          onReady: () => { ready = true; player.setVolume(VOLUME); if (wanted) play(); },
          // at the end, round again
          onStateChange: (e: { data: number }) => { if (e.data === 0 && on) { player.seekTo(now(), true); player.playVideo(); } },
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
