// Eren's own content, mapped onto the reference layout's slots.
export const SITE = {
  name: 'Eren Gün',
  logo: 'eren gün',
  tagline: 'Software developer from Istanbul building fast, reliable Flutter apps for startups and teams.',
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
  { label: 'contact', href: '/#contact' },
  { label: 'blog', href: 'https://erengun.dev/blog' },
  { label: 'projects', href: 'https://erengun.dev/projects' },
  { label: 'work', href: 'https://erengun.dev/work' },
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
    id: 'riverpod-template',
    title: 'Flutter Riverpod 2.0 Template',
    info: 'A production-ready Flutter starter: Riverpod 2.0, Freezed, Go Router, Hive and Easy Localization, wired with best practices.',
    roles: ['Design', 'Development', 'Open Source'],
    slides: 5,
    palette: ['#0b5cff', '#38d6ff', '#e8f6ff'],
  },
  {
    id: 'legallens',
    title: 'LegalLens',
    info: 'An AI-powered privacy tool that turns long privacy policies into short, readable summaries of what matters.',
    roles: ['Design', 'Development', 'AI'],
    slides: 4,
    palette: ['#141414', '#f2f2f2', '#ff4d2e'],
  },
  {
    id: 'rider',
    title: 'Rider',
    info: 'A CLI that reconfigures Flutter apps in one go: app name, package name, icons and more. Written in Go with Cobra.',
    roles: ['Development', 'CLI', 'Open Source'],
    slides: 4,
    palette: ['#ffd400', '#111111', '#2bff88'],
  },
  {
    id: 'tinywall',
    title: 'Tinywall',
    info: 'Save your parking spot as a home-screen widget, so the number is always one glance away.',
    roles: ['Development', 'Mobile'],
    slides: 4,
    palette: ['#1a1033', '#9b7bff', '#ffffff'],
  },
];

export const LAST = [
  {
    id: 'about',
    h: 'about me',
    b1: 'I build mobile and web apps that feel fast and stay reliable.',
    b2: 'Most apps either ship fast or hold up in production. I aim for both, with clean architecture, solid tooling and care for every frame.',
  },
  {
    id: 'who',
    h: 'who i work with',
    b1: 'I work with startups, product teams and agencies on Flutter apps, developer tools and the backends behind them.',
    b2: '',
  },
];
