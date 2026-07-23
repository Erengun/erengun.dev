"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

const projects = {
  subzilla: {
    number: "01",
    title: "SubZilla",
    type: "MOBILE PRODUCT",
    tagline: "Know where the money goes before it goes.",
    description:
      "A private-first subscription manager for recurring expenses, visual analytics, payment calendars and smart reminders — built with Flutter and stored locally.",
    tags: ["Flutter", "Riverpod", "Local-first", "Analytics"],
    link: "https://github.com/DevOpen-io/SubZilla",
  },
  dondurma: {
    number: "02",
    title: "Dondurma",
    type: "OPEN-SOURCE READER",
    tagline: "News without the machine deciding for you.",
    description:
      "A polished RSS/Atom reader that is algorithm-free, tracking-free and available across Android, iOS, web and desktop platforms.",
    tags: ["Flutter", "Material 3", "RSS / Atom", "6 platforms"],
    link: "https://github.com/DevOpen-io/dondurma-rss-reader",
  },
} as const;

const teknofest = {
  kicker: "TEKNOFEST · KARMA SÜRÜ SİMÜLASYON YARIŞMASI · ORDU",
  description:
    "Competed with team VORFEX42 in TEKNOFEST's Karma Sürü (Mixed Swarm) Simulation Competition, building swarm software for UAVs and UGVs to share tasks, back each other up and coordinate under a simulated disaster-relief scenario — delivering healthcare across a city as fast as possible. Finished 2nd among the finalists in Ordu, taking home a 30,000₺ prize.",
  stats: [
    { label: "TEAM", value: "VORFEX42" },
    { label: "RESULT", value: "2nd place · 30,000₺ prize" },
    { label: "FLEET", value: "UAV + UGV mixed swarm" },
  ],
  link: "https://www.teknofest.org/tr/yarismalar/karma-suru-simulasyon-yarismasi/",
  linkLabel: "VIEW THE COMPETITION",
  resultLink:
    "https://www.linkedin.com/posts/42turkiye_i%CC%87%C3%A7inde-ana-e%C4%9Fitim-ve-havuz-%C3%B6%C4%9Frencilerimizi-activity-6960678538244960256-3vJD",
  resultLinkLabel: "READ THE ANNOUNCEMENT",
} as const;

const risingStar = {
  kicker: "T3 VAKFI · YÜKSELEN YILDIZ BURS PROGRAMI",
  description:
    "Selected into T3 Vakfı's Yükselen Yıldız (\"Rising Star\") scholarship program, part of the Milli Teknoloji Hamlesi vision founded in Özdemir Bayraktar's name. Beyond the monthly scholarship, the program invests in scholars with specialized training, mentorship and access to national technology projects.",
  stats: [
    { label: "PROGRAM", value: "T3 Vakfı · Milli Teknoloji Hamlesi" },
    { label: "FOCUS", value: "Personal, academic & professional growth" },
    { label: "ACCESS", value: "Mentorship, TEKNOFEST & volunteering projects" },
  ],
  certificates: [
    { issuer: "GOOGLE", title: "Project Management", note: "Professional Certificate" },
    { issuer: "GOOGLE", title: "Play Store Listing", note: "Certificate" },
    { issuer: "TRAINING", title: "Public Speaking", note: "By Mennan Şahin — later put to use at the BAU codelab" },
  ],
  link: "https://bursiyer.t3vakfi.org/programlar/yukselen-yildiz",
  linkLabel: "VIEW THE PROGRAM",
} as const;

const codingame = {
  kicker: "CODINGAME · GENERAL GLOBAL LEADERBOARD",
  description:
    "Ranked #9 in Turkey on CodinGame's general global leaderboard — out of 4.8M+ registered developers worldwide, climbing leagues from Bronze to Legend on algorithmic puzzles, bot-programming contests and optimization challenges, scored purely on code performance.",
  stats: [
    { label: "RANK", value: "TR #9 · General Leaderboard" },
    { label: "FIELD", value: "4.8M+ registered developers" },
    { label: "LEAGUES", value: "Bronze → Silver → Gold → Legend" },
  ],
  link: "https://www.codingame.com/leaderboards/general/global",
  linkLabel: "VIEW THE LEADERBOARD",
  resultLink:
    "https://www.linkedin.com/pulse/codingame-global-leaderboard-snapshot-rare-top-5-daniel-g%C3%B3rski-qxsaf/",
  resultLinkLabel: "WHY THIS RANK IS RARE",
} as const;

const community = [
  {
    id: "gdg",
    accent: "blue",
    kicker: "TECH COMMUNITY",
    title: "GDG Istanbul",
    role: "Volunteer · DevFest Co-Organizer",
    period: "2022 — 2023",
    description:
      "Volunteer with GDG Istanbul, the community bringing together people interested in Google technologies — Android, Polymer, Angular and Google APIs — and co-organizer of DevFest Istanbul '22 and '23, one of Europe's largest Google Developer Group events.",
    tags: ["Android", "Angular", "Google APIs", "DevFest '22 & '23"],
    link: "http://gdgistanbul-slack.herokuapp.com/",
    linkLabel: "JOIN THE SLACK",
    images: [
      { src: "/gdg-devfest-1.jpg", alt: "An Angular talk on stage at DevFest Istanbul 2022" },
      { src: "/gdg-devfest-2.jpg", alt: "Eren Gün with the GDG Istanbul crew at DevFest Istanbul 2022" },
    ],
  },
  {
    id: "bau",
    accent: "pink",
    kicker: "CODELAB · GDSC BAU",
    title: "Bahçeşehir University",
    role: "Codelab Speaker — Firebase Auth in Flutter",
    period: "Guest Session",
    description:
      "Gave a codelab for the GDSC BAU (Bahçeşehir University) team on integrating Firebase Authentication into Flutter apps — email/password and Google Sign-In, setting up a Firebase project, and initializing Firebase in a Flutter app.",
    quote:
      "“We would like to express our sincere gratitude to all participants, supporters, and especially to Eren Gün for contributing to the success of our recent event... The insights and expertise shared by Eren Gün on Firebase Authentication were invaluable.”",
    quoteAttribution: "— GDSC BAU team",
    tags: ["Flutter", "Firebase Auth", "Google Sign-In", "GDSC BAU"],
    images: [
      { src: "/bau-codelab-2.jpg", alt: "Eren Gün presenting Firebase Authentication in Flutter at Bahçeşehir University" },
      { src: "/bau-codelab-3.jpg", alt: "Students following along with the Flutter Firebase codelab at BAU" },
      { src: "/bau-codelab-1.jpg", alt: "Group photo with the GDSC BAU team after the codelab" },
    ],
  },
  {
    id: "itobot",
    accent: "coral",
    kicker: "STUDENT ROBOTICS",
    title: "ITOBOT — Team 6038",
    role: "Team Member, FIRST Robotics Competition",
    period: "High School",
    description:
      "Built competition robots through six-week build seasons with FRC Team 6038 of Istanbul, competing at the Istanbul Regional and on to the FIRST Championship in Houston.",
    tags: ["FIRST Robotics", "Team 6038", "Build Season"],
    link: "https://www.thebluealliance.com/team/6038",
    linkLabel: "VIEW TEAM 6038",
    images: [{ src: "/itobot-frc.jpg", alt: "ITOBOT Team 6038 at the Istanbul Regional FIRST Robotics Competition" }],
  },
  {
    id: "thk",
    accent: "green",
    kicker: "AVIATION & AEROSPACE",
    title: "Türk Hava Kurumu",
    role: "Member",
    period: "Est. 1925",
    description:
      "Member of the Turkish Aeronautical Association — \"The Starting Point of Aviation\" — the century-old national body behind Turkey's air sports and youth aviation and aerospace programs.",
    tags: ["Aviation", "Aerospace", "Air Sports"],
    link: "https://en.wikipedia.org/wiki/Turkish_Aeronautical_Association",
    linkLabel: "ABOUT THK",
    images: [{ src: "/thk-aviation.jpg", alt: "With fellow Turkish Aeronautical Association members at an aviation event" }],
  },
] as const;

function UavIcon({ className }: { className: string }) {
  return (
    <div className={`uav ${className}`}>
      <i className="uav-rotor tl" />
      <i className="uav-rotor tr" />
      <i className="uav-rotor bl" />
      <i className="uav-rotor br" />
    </div>
  );
}

let windowLayer = 20;

function WindowControls() {
  return (
    <span className="window-controls" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function DraggableWindow({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [layer, setLayer] = useState(10);
  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(max-width: 820px)").matches) return;
    windowLayer += 1;
    setLayer(windowLayer);
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    setPosition({
      x: drag.current.originX + event.clientX - drag.current.startX,
      y: drag.current.originY + event.clientY - drag.current.startY,
    });
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <article
      className={`os-window ${className}`}
      style={{
        "--drag-x": `${position.x}px`,
        "--drag-y": `${position.y}px`,
        zIndex: layer,
      } as React.CSSProperties}
      onPointerDown={() => {
        windowLayer += 1;
        setLayer(windowLayer);
      }}
    >
      <div
        className="window-bar"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        tabIndex={0}
        role="button"
        aria-label={`Drag ${title} window`}
      >
        <WindowControls />
        <span>{title}</span>
        <span className="window-grip">::::::::::::::::</span>
      </div>
      {children}
    </article>
  );
}

function CursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    type Dot = { x: number; y: number; life: number; size: number; color: string };
    let dots: Dot[] = [];
    let frame = 0;
    let last = { x: -100, y: -100 };
    const colors = ["#ff5c39", "#ffd54a", "#ff8fc7", "#ffffff"];

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const move = (event: globalThis.PointerEvent) => {
      const distance = Math.hypot(event.clientX - last.x, event.clientY - last.y);
      if (distance < 11) return;
      last = { x: event.clientX, y: event.clientY };
      dots.push({
        x: event.clientX,
        y: event.clientY,
        life: 1,
        size: 5 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
      if (dots.length > 65) dots = dots.slice(-65);
    };

    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      dots = dots.filter((dot) => dot.life > 0.03);
      dots.forEach((dot, index) => {
        dot.life *= 0.92;
        dot.y += 0.22;
        context.globalAlpha = dot.life;
        context.fillStyle = dot.color;
        context.save();
        context.translate(dot.x, dot.y);
        context.rotate(index * 0.12);
        context.fillRect(-dot.size / 2, -dot.size / 2, dot.size, dot.size);
        context.restore();
      });
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-trail" aria-hidden="true" />;
}

export default function Home() {
  const [activeProject, setActiveProject] = useState<keyof typeof projects>("subzilla");
  const [boot, setBoot] = useState<"visible" | "exit" | "gone">("visible");
  const [time, setTime] = useState("--:--");

  useEffect(() => {
    document.documentElement.classList.add("js-ready");
    const bootExit = window.setTimeout(() => setBoot("exit"), 850);
    const bootGone = window.setTimeout(() => setBoot("gone"), 1350);
    const updateTime = () => {
      setTime(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Istanbul",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    };
    updateTime();
    const clock = window.setInterval(updateTime, 30000);
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("seen")),
      { threshold: 0.1 },
    );
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
    return () => {
      window.clearTimeout(bootExit);
      window.clearTimeout(bootGone);
      window.clearInterval(clock);
      observer.disconnect();
      document.documentElement.classList.remove("js-ready");
    };
  }, []);

  const project = projects[activeProject];

  return (
    <main>
      {boot !== "gone" && (
        <div className={`boot-screen ${boot === "exit" ? "boot-exit" : ""}`}>
          <div className="boot-mark">EG</div>
          <div className="boot-copy"><span>EREN_OS</span><span>LOADING IDEAS...</span></div>
          <div className="boot-line"><i /></div>
        </div>
      )}
      <CursorTrail />

      <section className="desktop-hero" id="top">
        <div className="hero-cloud cloud-one" aria-hidden="true" />
        <div className="hero-cloud cloud-two" aria-hidden="true" />
        <div className="hero-dots" aria-hidden="true" />

        <header className="menu-bar">
          <a className="menu-logo" href="#top">EREN_OS <b>9.0</b></a>
          <nav aria-label="Main navigation">
            <a href="#work">Projects</a>
            <a href="#rising-star">Yükselen Yıldız</a>
            <a href="#codingame">CodinGame</a>
            <a href="#teknofest">TEKNOFEST</a>
            <a href="#community">Community</a>
            <a href="#collective">DevOpen</a>
          </nav>
          <div className="menu-right">
            <span>IST {time}</span>
            <a href="https://www.linkedin.com/in/erengun/" target="_blank" rel="noreferrer">Say hello ↗</a>
          </div>
        </header>

        <div className="desktop-label"><span>CREATIVE ENGINEERING DESKTOP</span><span>DRAG THE WINDOWS</span></div>

        <DraggableWindow title="about_eren.app" className="profile-window">
          <div className="profile-window-body">
            <div className="profile-photo">
              <img src="/eren-gun.jpg" alt="Eren Gün skiing in the mountains" />
              <span>ISTANBUL, TR</span>
            </div>
            <div className="profile-copy">
              <p className="tiny-label">SOFTWARE DEVELOPER / OPEN-SOURCE BUILDER</p>
              <h1>Software is my favorite <em>material.</em></h1>
              <p className="profile-intro">
                I turn difficult systems into useful products — from autonomous swarms to mobile apps people actually keep.
              </p>
              <div className="profile-actions">
                <a href="#work">Open projects</a>
                <a href="https://github.com/Erengun" target="_blank" rel="noreferrer">GitHub ↗</a>
              </div>
            </div>
          </div>
          <div className="window-status"><span>48 REPOSITORIES</span><span>ÉCOLE 42</span><span>OPEN FOR COLLABORATION</span></div>
        </DraggableWindow>

        <DraggableWindow title="achievements.log" className="rank-window">
          <div className="rank-header"><span>CODINGAME_RANK</span><strong>TR #09</strong></div>
          <ul>
            <li><span>CodinGame</span><b>TURKEY TOP 10</b></li>
            <li><span>T3 Vakfı</span><b>YÜKSELEN YILDIZ</b></li>
            <li><span>TEKNOFEST</span><b>AWARD WINNER</b></li>
          </ul>
        </DraggableWindow>

        <DraggableWindow title="currently_building.txt" className="note-window">
          <div className="note-paper">
            <span>NOW</span>
            <p>Making open-source software with friends at <b>DevOpen.io</b></p>
            <i>✦</i>
          </div>
        </DraggableWindow>

        <DraggableWindow title="hello_world.exe" className="hello-window">
          <div className="hello-body"><span>HELLO</span><b>WORLD!</b><small>STATUS: SHIPPING</small></div>
        </DraggableWindow>

        <div className="desktop-dock" aria-label="Quick links">
          <a href="#work"><span className="dock-icon folder-icon" /><small>Work</small></a>
          <a href="https://github.com/DevOpen-io" target="_blank" rel="noreferrer"><span className="dock-icon team-icon">DO</span><small>DevOpen</small></a>
          <a href="https://github.com/Erengun" target="_blank" rel="noreferrer"><span className="dock-icon code-icon">&lt;/&gt;</span><small>GitHub</small></a>
        </div>
      </section>

      <div className="system-ticker" aria-hidden="true">
        <div>
          {["MOBILE PRODUCTS", "AUTONOMOUS SYSTEMS", "OPEN SOURCE", "COMPETITIVE CODING", "FLUTTER", "GOOD TROUBLE", "MOBILE PRODUCTS", "AUTONOMOUS SYSTEMS", "OPEN SOURCE", "COMPETITIVE CODING", "FLUTTER", "GOOD TROUBLE"].map((item, index) => (
            <span key={`${item}-${index}`}>{item}<b>◉</b></span>
          ))}
        </div>
      </div>

      <section className="file-explorer" id="work">
        <div className="explorer-window reveal">
          <div className="explorer-topbar">
            <WindowControls />
            <div className="breadcrumbs"><span>EREN_OS</span><b>›</b><span>PROJECTS</span><b>›</b><strong>{project.title.toUpperCase()}</strong></div>
            <span className="view-mode">◫ LIST / ◧ GRID</span>
          </div>

          <div className="explorer-layout">
            <aside className="explorer-sidebar">
              <p>FAVORITES</p>
              <button className={activeProject === "subzilla" ? "active" : ""} onClick={() => setActiveProject("subzilla")} aria-pressed={activeProject === "subzilla"}>
                <span className="mini-folder purple" /> SubZilla <b>01</b>
              </button>
              <button className={activeProject === "dondurma" ? "active" : ""} onClick={() => setActiveProject("dondurma")} aria-pressed={activeProject === "dondurma"}>
                <span className="mini-folder blue" /> Dondurma <b>02</b>
              </button>
              <p>LOCATIONS</p>
              <a href="https://github.com/DevOpen-io" target="_blank" rel="noreferrer"><span>◎</span> DevOpen.io</a>
              <a href="https://github.com/Erengun" target="_blank" rel="noreferrer"><span>⌘</span> GitHub</a>
              <div className="disk-space"><span>OPEN-SOURCE DRIVE</span><i><b /></i><small>9 projects · public</small></div>
            </aside>

            <div className="project-preview" key={activeProject}>
              <div className={`project-stage ${activeProject}`}>
                <div className="stage-sticker">{project.number} / FEATURED</div>
                {activeProject === "subzilla" ? (
                  <>
                    <div className="app-phone"><img src="/subzilla-home.png" alt="SubZilla subscription dashboard" /></div>
                    <div className="spend-widget"><small>MONTHLY</small><strong>$90</strong><span>5 ACTIVE</span></div>
                    <div className="calendar-widget"><b>21</b><span>NEXT PAYMENT</span></div>
                  </>
                ) : (
                  <>
                    <div className="icecream-logo"><img src="/dondurma-logo.png" alt="Dondurma RSS Reader logo" /></div>
                    <div className="article-widget article-a"><span>DESIGN</span><b>Read what you choose.</b><small>08 MIN</small></div>
                    <div className="article-widget article-b"><span>TECH</span><b>No algorithm needed.</b><small>04 MIN</small></div>
                  </>
                )}
              </div>
              <div className="project-details">
                <div className="project-meta"><span>{project.type}</span><span>DEVOPEN.IO</span></div>
                <h2>{project.title}</h2>
                <p className="project-tagline">{project.tagline}</p>
                <p className="project-description">{project.description}</p>
                <div className="project-tags">{project.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                <a className="repo-button" href={project.link} target="_blank" rel="noreferrer">OPEN REPOSITORY <b>↗</b></a>
              </div>
            </div>
          </div>
          <div className="explorer-footer"><span>2 ITEMS</span><span>OPEN SOURCE · MIT</span><span>SYNCED JUST NOW</span></div>
        </div>
      </section>

      <section className="rising-star" id="rising-star">
        <div className="rising-star-copy reveal">
          <span className="rising-star-kicker">{risingStar.kicker}</span>
          <h2>Yükselen<br /><em>Yıldız.</em></h2>
          <p>{risingStar.description}</p>
          <div className="rising-star-stats">
            {risingStar.stats.map((stat) => (
              <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>
            ))}
          </div>
          <a href={risingStar.link} target="_blank" rel="noreferrer">{risingStar.linkLabel} <b>↗</b></a>
        </div>
        <div className="cert-stack reveal">
          <span className="cert-stack-badge">⭐ SELECTED SCHOLAR</span>
          {risingStar.certificates.map((cert, index) => (
            <article className={`cert-card cert-${index}`} key={cert.title}>
              <span className="cert-issuer">{cert.issuer}</span>
              <h4>{cert.title}</h4>
              <p>{cert.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="codingame" id="codingame">
        <div className="codingame-copy reveal">
          <span className="codingame-kicker">{codingame.kicker}</span>
          <h2>Top 10<br /><em>in Turkey.</em></h2>
          <p>{codingame.description}</p>
          <div className="codingame-stats">
            {codingame.stats.map((stat) => (
              <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>
            ))}
          </div>
          <div className="codingame-links">
            <a href={codingame.link} target="_blank" rel="noreferrer">{codingame.linkLabel} <b>↗</b></a>
            <a href={codingame.resultLink} target="_blank" rel="noreferrer" className="codingame-link-ghost">{codingame.resultLinkLabel} <b>↗</b></a>
          </div>
        </div>
        <div className="codingame-visual reveal">
          <div className="tech-grid" aria-hidden="true" />
          <span className="hud-label cg-hud-label">LEADERBOARD: TURKEY · GENERAL</span>
          <div className="rank-board" aria-hidden="true">
            <div className="rank-row"><span>07</span><span className="rank-name blurred">▇▇▇▇▇▇▇▇▇▇</span></div>
            <div className="rank-row"><span>08</span><span className="rank-name blurred">▇▇▇▇▇▇▇▇▇▇▇▇</span></div>
            <div className="rank-row highlight"><span>09</span><span className="rank-name">EREN GÜN 🇹🇷</span></div>
            <div className="rank-row"><span>10</span><span className="rank-name blurred">▇▇▇▇▇▇▇▇▇</span></div>
            <div className="rank-row"><span>11</span><span className="rank-name blurred">▇▇▇▇▇▇▇▇▇▇▇▇▇</span></div>
          </div>
          <div className="teknofest-hud cg-hud" aria-hidden="true">
            <span>4.8M+ PLAYERS</span>
            <span>SCORING: TRUESKILL</span>
            <span>STATUS: LEGEND-BOUND</span>
          </div>
        </div>
      </section>

      <section className="teknofest" id="teknofest">
        <div className="teknofest-copy reveal">
          <span className="teknofest-kicker">{teknofest.kicker}</span>
          <h2>Karma Sürü<br /><em>Award Winner.</em></h2>
          <p>{teknofest.description}</p>
          <div className="teknofest-stats">
            {teknofest.stats.map((stat) => (
              <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>
            ))}
          </div>
          <div className="teknofest-links">
            <a href={teknofest.link} target="_blank" rel="noreferrer">{teknofest.linkLabel} <b>↗</b></a>
            <a href={teknofest.resultLink} target="_blank" rel="noreferrer" className="teknofest-link-ghost">{teknofest.resultLinkLabel} <b>↗</b></a>
          </div>
        </div>
        <div className="teknofest-visual reveal">
          <div className="teknofest-decor" aria-hidden="true">
            <div className="radar-rings" />
            <div className="tech-grid" />
            <span className="hud-label">SWARM_STATUS: ACTIVE</span>
            <UavIcon className="uav-a" />
            <UavIcon className="uav-b" />
            <UavIcon className="uav-d" />
            <UavIcon className="uav-e" />
          </div>
          <div className="teknofest-photo-frame">
            <img
              src="/teknofest-vorfex42.jpg"
              alt="Team VORFEX42 at the TEKNOFEST Karma Sürü Simulation Competition finals in Ordu"
              loading="lazy"
            />
            <span className="teknofest-badge">🏆 2ND PLACE<br />30.000₺</span>
          </div>
          <div className="teknofest-hud" aria-hidden="true">
            <span>TEAM: VORFEX42</span>
            <span>ORDU, TR</span>
            <span>RESULT: 2ND PLACE</span>
          </div>
        </div>
      </section>

      <section className="field-notes" id="community">
        <div className="field-notes-title reveal">
          <span>COMMUNITY_LOG / {String(community.length).padStart(2, "0")} ENTRIES</span>
          <h2>Built with<br /><em>other people.</em></h2>
          <p>Long before the products, there were classrooms, codelabs and hangars — where I learned to build in public.</p>
        </div>
        <div className="field-notes-grid">
          {community.map((entry, index) => (
            <article className={`field-card accent-${entry.accent} reveal`} key={entry.id} style={{ transitionDelay: `${index * 70}ms` }}>
              <div className={`field-photos count-${entry.images.length}`}>
                {entry.images.map((image) => (
                  <img key={image.src} src={image.src} alt={image.alt} loading="lazy" />
                ))}
              </div>
              <div className="field-copy">
                <div className="field-meta"><span>{entry.kicker}</span><span>{entry.period}</span></div>
                <h3>{entry.title}</h3>
                <p className="field-role">{entry.role}</p>
                <p className="field-description">{entry.description}</p>
                {"quote" in entry && entry.quote && (
                  <blockquote className="field-quote">
                    <p>{entry.quote}</p>
                    <cite>{entry.quoteAttribution}</cite>
                  </blockquote>
                )}
                <div className="field-tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                {"link" in entry && entry.link && (
                  <a className="field-link" href={entry.link} target="_blank" rel="noreferrer">{entry.linkLabel} <b>↗</b></a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="collective" id="collective">
        <div className="collective-burst" aria-hidden="true" />
        <div className="collective-copy reveal">
          <span className="collective-kicker">FRIENDS_SHIP.SO</span>
          <h2>DEV<br /><em>OPEN</em><sup>.IO</sup></h2>
          <p>
            A group of friends turning side conversations into public software. No gatekeeping. No black boxes. Just things worth sharing.
          </p>
          <a href="https://github.com/DevOpen-io" target="_blank" rel="noreferrer">VISIT THE COLLECTIVE <b>↗</b></a>
        </div>
        <div className="collective-cards reveal">
          <div className="friend-card card-one"><span>01</span><b>BUILD</b><small>Useful things</small></div>
          <div className="friend-card card-two"><span>02</span><b>OPEN</b><small>The source</small></div>
          <div className="friend-card card-three"><span>03</span><b>SHARE</b><small>The progress</small></div>
          <div className="collective-stamp">9<br /><span>PUBLIC REPOS</span></div>
        </div>
      </section>

      <section className="manifesto">
        <div className="manifesto-top reveal"><span>README.MD</span><span>LAST UPDATED: TODAY</span></div>
        <div className="manifesto-grid">
          <div className="manifesto-heading reveal">
            <p>MY DEFAULT SETTINGS</p>
            <h2>Curious<br />enough to <em>break it.</em><br />Stubborn enough<br />to <span>ship it.</span></h2>
          </div>
          <ol className="principle-list">
            <li className="reveal"><span>01</span><div><b>Clarity over cleverness</b><p>The best system explains itself.</p></div></li>
            <li className="reveal"><span>02</span><div><b>Build the hard part first</b><p>Polish cannot rescue a hollow core.</p></div></li>
            <li className="reveal"><span>03</span><div><b>Open by default</b><p>Shared code compounds into shared progress.</p></div></li>
            <li className="reveal"><span>04</span><div><b>Play to win</b><p>Competition is a laboratory for focus.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="contact-panel" id="contact">
        <div className="contact-marquee" aria-hidden="true"><span>LET&apos;S BUILD SOMETHING UNREASONABLE · LET&apos;S BUILD SOMETHING UNREASONABLE ·</span></div>
        <div className="contact-inner reveal">
          <p>NEW_MESSAGE.COMPOSE</p>
          <h2>Got a difficult idea?</h2>
          <p className="contact-lead">Good. Those are the interesting ones.</p>
          <div className="contact-buttons">
            <a href="https://www.linkedin.com/in/erengun/" target="_blank" rel="noreferrer">START A CONVERSATION <b>↗</b></a>
            <a href="https://github.com/Erengun" target="_blank" rel="noreferrer">BROWSE THE CODE <b>↗</b></a>
          </div>
        </div>
        <div className="contact-face"><img src="/eren-gun.jpg" alt="Eren Gün" /><span>AVAILABLE<br />FOR IDEAS</span></div>
      </section>

      <footer className="os-footer">
        <span>© 2026 EREN GÜN</span>
        <span>MADE WITH CURIOSITY IN ISTANBUL</span>
        <a href="#top">RESTART ↑</a>
      </footer>
    </main>
  );
}
