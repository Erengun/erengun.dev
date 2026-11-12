// Eren's own content, mapped onto the reference layout's slots.
export const SITE = {
  name: 'Eren Gün',
  logo: 'eren gün',
  tagline: 'Software engineer from Istanbul building developer tools, update infrastructure and fast Flutter apps.',
  year: '2026',
  email: 'hi@erengun.dev',
};

export const SOCIALS = [
  { label: 'Email', short: 'mail', href: 'mailto:hi@erengun.dev' },
  { label: 'Linkedin', short: 'linkedin', href: 'https://www.linkedin.com/in/erengun/' },
  { label: 'Github', short: 'github', href: 'https://github.com/Erengun' },
  { label: 'Blog', short: 'blog', href: 'https://erengun.dev/blog' },
];

export const MENU = [
  { label: 'home', href: '/' },
  { label: 'about', href: '/#about' },
  { label: 'work', href: '/#work' },
  { label: 'contact', href: '/#contact' },
  { label: 'blog', href: 'https://erengun.dev/blog' },
  { label: 'projects', href: 'https://erengun.dev/projects' },
];

export type Project = {
  id: string;
  title: string;
  info: string;
  roles: string[];
  slides: number;
  /** palette used by the procedural slide generator (stand-in for screenshots) */
  palette: [string, string, string];
};

export const PROJECTS: Project[] = [
  {
    id: 'oge',
    title: 'Öge',
    info: 'The supervision layer for coding agents. It runs Claude Code, Codex or Antigravity on your task, checks the work with independent QA, and brings you in only when your judgment is needed.',
    roles: ['Design', 'Development', 'Go'],
    slides: 5,
    palette: ['#0d0d0d', '#f4f1ea', '#ff5a1f'],
  },
  {
    id: 'ferman',
    title: 'Ferman',
    info: 'Self-hosted live updates. A Rust update engine and server for sideloaded and enterprise Android, Windows, internal iOS, Flutter and React Native, with signed patches and staged rollouts.',
    roles: ['Architecture', 'Development', 'Rust'],
    slides: 4,
    palette: ['#0a0f1a', '#e8b04a', '#d9e2ef'],
  },
  {
    id: 'cached-network-image-ce',
    title: 'Cached Network Image CE',
    info: 'Zero-jank image caching for Flutter. The maintained fork of cached_network_image, rebuilt on hive_ce: 8× faster cache reads, web support, same API.',
    roles: ['Maintainer', 'Development', 'Open Source'],
    slides: 6,
    palette: ['#02569b', '#ffb300', '#f5f9ff'],
  },
  {
    id: 'elek',
    title: 'Elek',
    info: 'Your coding agent is fast. Your test suite isn’t. An incremental test runner for Dart and Flutter that skips what is already green: up to 107× faster loops.',
    roles: ['Design', 'Development', 'Dart'],
    slides: 5,
    palette: ['#c8ff00', '#101010', '#ffffff'],
  },
  {
    id: 'subara',
    title: 'Subara',
    info: 'A subscription manager for iPhone and iPad, built with Flutter: spending charts, a payment calendar, reminders before renewals, widgets and Live Activities. Data stays on device.',
    roles: ['Design', 'Development', 'iOS'],
    slides: 6,
    palette: ['#5b3df5', '#ff8fc7', '#f6f3ff'],
  },
];

export const LAST = [
  {
    id: 'about',
    h: 'about me',
    b1: 'I build the tools that make shipping software faster, and the apps that ship on them.',
    b2: 'From a Rust update server to test runners and agent supervision, I care about the loop: fast feedback, verified changes, nothing breaking in production.',
  },
  {
    id: 'who',
    h: 'who i work with',
    b1: 'I work with startups, product teams and open-source communities on Flutter apps, developer tooling and the infrastructure behind them.',
    b2: '',
  },
];
