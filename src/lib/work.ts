// Case-study copy for /work/<id>/. Facts come from each project's own README; keep them in sync when those change.
import { PROJECTS, type Project } from './content';

export type Link = { label: string; href: string };
export type Stat = { value: string; label: string };
export type Case = {
  /** one-line hook under the title */
  lede: string;
  status: string;
  stack: string[];
  links: Link[];
  problem: string[];
  built: string[];
  /** short bullets: the decisions worth knowing about */
  notes: string[];
  stats?: Stat[];
  statsNote?: string;
};

export const CASES: Record<string, Case> = {
  oge: {
    lede: 'A supervision layer for coding agents: it runs them, checks their work independently, and asks you only when your judgment is needed.',
    status: 'Pre-alpha, open source (Apache-2.0)',
    stack: ['Go', 'Claude Code', 'Codex', 'Google Antigravity', 'TUI'],
    links: [{ label: 'GitHub', href: 'https://github.com/Erengun/oge' }],
    problem: [
      'Coding agents multiplied how much work gets executed. The bottleneck moved to the person supervising them: reading diffs, rerunning tests, and deciding whether "done" really means done.',
      'An agent that checks its own work is grading its own exam. Its claims about passing tests are not evidence.',
    ],
    built: [
      'Öge drives the agents you already use (Claude Code, Codex, Antigravity) over their structured streams, on private copies of your repository, so nothing touches your working tree until you apply it.',
      'In Standard mode a fresh QA agent sees only the task and the changed code, never the implementer’s reasoning, and can add held-out tests the implementer never sees. Öge runs the checks itself; failures feed a bounded repair loop.',
      'A result is Accepted only on the evidence Öge collected. Every run produces a Receipt that states what was checked, what passed and what was not covered, exportable as Markdown for a PR or JSON for tooling.',
    ],
    notes: [
      'Uses your existing agent login; never asks for, reads or stores provider credentials.',
      'Project checks and protected test patterns live in config the agents cannot change mid-run.',
      'Tests run against fakes and recorded sessions, so CI spends no model quota.',
      'Next: the Desk, one screen for several agent chats, designed from research on interruptions and resumption.',
    ],
  },
  ferman: {
    lede: 'Self-hosted live updates for apps that don’t ship through a public store, with signed patches and staged rollouts.',
    status: 'v0.1, private repository',
    stack: ['Rust', 'C ABI', 'Swift', 'Kotlin / JNI', 'C# / .NET', 'Flutter', 'Docker'],
    links: [],
    problem: [
      'Sideloaded and enterprise apps (point-of-sale terminals, internal tools, kiosk devices) still need fast fixes, but hosted live-update services are a poor fit when the fleet lives on your own network or under your own compliance rules.',
      'An update channel is also an attack surface: whoever controls it controls every device.',
    ],
    built: [
      'A Rust update engine exposed through a C ABI, so one core serves native Android (JNI), Windows (C++/C#/.NET launcher and updater), internal iOS (Swift FermanKit) and Flutter on the stock engine.',
      'A server and CLI for the release workflow: register a shipped base, publish a signed patch to a channel, roll it out to a percentage, promote, pause or roll back. The CLI is built for CI with app-scoped tokens.',
      'Devices boot offline from an A/B slot, mark a patch good once healthy, and verify everything against pinned public keys. The signer owns the sequence number, so a server proposing one ahead of it is refused.',
    ],
    notes: [
      'Release pipeline builds CLI and server for Linux, macOS and Windows, plus a multi-arch server image smoke-tested per architecture.',
      'Licensing split on purpose: the server is AGPL with a commercial option; everything that ships inside your app is Apache-2.0.',
      'Architecture and threat model documented alongside the code.',
    ],
  },
  'cached-network-image-ce': {
    lede: 'The maintained fork of Flutter’s most popular image-caching package, rebuilt on a caching engine that doesn’t block the UI thread.',
    status: 'Maintained, on pub.dev (MIT)',
    stack: ['Dart', 'Flutter', 'hive_ce', 'IndexedDB'],
    links: [
      { label: 'pub.dev', href: 'https://pub.dev/packages/cached_network_image_ce' },
      { label: 'GitHub', href: 'https://github.com/Erengun/flutter_cached_network_image_ce' },
    ],
    problem: [
      'cached_network_image is one of the most used packages in the Flutter ecosystem, and it has been effectively unmaintained since August 2024, with 300+ open issues including memory leaks and scroll jank.',
      'Under the hood it routes every “have I downloaded this already?” check through a platform channel into SQLite. On image-heavy lists you can feel it.',
    ],
    built: [
      'Replaced sqflite with hive_ce, a pure-Dart, non-blocking store, for cache metadata. Image bytes stay on the native filesystem; no platform channel or SQL parser in the hot path.',
      'Real web support with a persistent IndexedDB cache, HTTP and cache interceptors, pluggable TTL or LRU eviction, a pre-caching API, and a hook for formats Flutter can’t decode.',
      'Kept the widget and provider API, so migrating is a dependency swap.',
    ],
    notes: [
      'Listed on Flutter Gems.',
      'Used by open-source apps such as Kazumi, PiliPlus, MusicPod and plezy.',
      'Honest trade-off documented up front: switching engines means users re-download images once.',
    ],
    stats: [
      { value: '8×', label: 'faster cache reads (16 → 2 ms)' },
      { value: '4×', label: 'faster writes (116 → 29 ms)' },
      { value: '2.9×', label: 'faster cleanup (55 → 19 ms)' },
    ],
    statsNote: 'Cache metadata operations, 10 KB payload, iPhone Simulator.',
  },
  elek: {
    lede: 'An incremental test runner for Dart and Flutter that skips what is already green, so coding agents can verify their changes in seconds.',
    status: '0.1, experimental, on pub.dev',
    stack: ['Dart', 'Flutter', 'Claude Code plugin', 'Codex plugin'],
    links: [
      { label: 'pub.dev', href: 'https://pub.dev/packages/elek' },
      { label: 'GitHub', href: 'https://github.com/Erengun/elek' },
    ],
    problem: [
      'Coding agents are fast; test suites aren’t. A full flutter test run on a real app took over three minutes, so agents either skipped verification or spent most of their time waiting on it.',
    ],
    built: [
      'Elek fingerprints the inputs of every test file (its transitive import closure, fixtures, pubspec and lockfile, assets, SDK versions, locale and time zone) and skips files that passed last time with the same inputs.',
      'What’s left runs in a few bundled shards balanced by past durations, so the compiler starts a handful of times instead of once per file. A file that fails in a bundle is rerun alone, so leaking global state can’t produce a false result.',
      'A plugin for Claude Code and Codex adds a hook that runs Elek when the agent tries to finish. Failing tests go back to the agent; it stops at most three times in a row so a pre-existing failure can’t trap it.',
    ],
    notes: [
      'Elek means “sieve” in Turkish.',
      'Benchmarks published with their limits: on Flame, a single import cycle means a source change still reruns most files.',
    ],
    stats: [
      { value: '107×', label: 'faster when nothing changed (192.5 → 1.8 s)' },
      { value: '49×', label: 'faster after one test file changed' },
      { value: '12×', label: 'faster after a controller changed' },
    ],
    statsNote: 'Private Flutter app, 265 test files, 2,230 tests, Apple M3, median of 3 runs.',
  },
  subara: {
    lede: 'A subscription manager for iPhone and iPad that keeps every recurring payment in one place, with the data staying on the device.',
    status: 'Live on the App Store',
    stack: ['Flutter', 'Riverpod', 'sqflite', 'fl_chart', 'WidgetKit', 'Live Activities'],
    links: [{ label: 'App Store', href: 'https://apps.apple.com/us/app/subara-subscription-manager/id6777425387' }],
    problem: [
      'Subscriptions pile up quietly: a trial here, a yearly renewal there, and the reminder arrives as the charge. Subara is the list you would keep yourself, with the dates worked out for you.',
    ],
    built: [
      'A Flutter app with spending charts, a monthly payment calendar and reminders before each renewal, plus home-screen widgets and Live Activities on iOS.',
      'Data lives in a local SQLite database on the device. Signing in is only for an optional cloud backup.',
      'Brand picker for common services, custom entries, billing cycles, currencies, light and dark themes, English and Turkish.',
    ],
    notes: [
      'State management with Riverpod and code generation (freezed, riverpod_generator).',
      'Store releases automated with fastlane.',
    ],
  },
};

export type Slide = { src: string; w: number; h: number; kind: string; caption: string };

export async function loadSlides(id: string): Promise<Slide[]> {
  // build time only; resolved from the project root (import.meta.url points into dist/ once bundled)
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  return JSON.parse(await readFile(join(process.cwd(), 'public/projects', id, 'manifest.json'), 'utf8'));
}

export const workPath = (p: Project) => `/work/${p.id}/`;
export const caseFor = (p: Project) => CASES[p.id];
export { PROJECTS };
