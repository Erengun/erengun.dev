/**
 * Music for /qr/: a YouTube video played through YouTube's own player, kept out of sight (their audio; nothing is
 * copied here). On by default and very quiet. It never starts from the top: like a radio, the place in the recording
 * follows the clock, so everyone hears the same moment. Browsers only let sound start after a first tap or key.
 */
const VIDEO = 'gr2OGRA96L8', LENGTH = 1635, VOLUME = 7;
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
    // load at the clock's place (a seek before the first play is sometimes dropped, and it would start from 0:00)
    player.loadVideoById({ videoId: VIDEO, startSeconds: now() });
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
          onStateChange: (e: { data: number }) => {
            if (e.data === 0 && on) play(); // at the end, round again
            if (e.data === 1) { // playing: if it is not where the clock says (it began from the top after all), go there
              player.setVolume(VOLUME);
              const off = Math.abs(player.getCurrentTime() - now());
              if (off > 8 && off < LENGTH - 8) player.seekTo(now(), true);
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
