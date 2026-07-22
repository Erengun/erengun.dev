"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

const achievements = [
  {
    index: "01",
    metric: "100",
    kicker: "T3 VAKFI",
    title: "Yükselen Yıldız",
    detail: "Selected as one of Türkiye’s 100 rising technology talents.",
    className: "acid",
  },
  {
    index: "02",
    metric: "#09",
    kicker: "CODINGAME",
    title: "Worldwide",
    detail: "A world top-10 finish where algorithms meet speed and nerve.",
    className: "blue",
  },
  {
    index: "03",
    metric: "AWD",
    kicker: "TEKNOFEST",
    title: "Karma Sürü",
    detail: "Award-winning autonomous swarm simulation and coordination.",
    className: "orange",
  },
  {
    index: "04",
    metric: "1ST",
    kicker: "MOBILE",
    title: "Serial winner",
    detail: "Years of first-place finishes in mobile development challenges.",
    className: "violet",
  },
];

const ticker = [
  "SOFTWARE DEVELOPMENT",
  "OPEN SOURCE",
  "FLUTTER",
  "AUTONOMOUS SYSTEMS",
  "CREATIVE ENGINEERING",
  "ÉCOLE 42",
];

function SwarmCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let pointer = { x: 0, y: 0, active: false };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    type Agent = { x: number; y: number; vx: number; vy: number; size: number; seed: number };
    let agents: Agent[] = [];

    const reset = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      const count = width < 700 ? 38 : 82;
      agents = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
        size: index % 11 === 0 ? 3.8 : index % 5 === 0 ? 2.4 : 1.35,
        seed: Math.random() * Math.PI * 2,
      }));
      pointer = { x: width * 0.62, y: height * 0.45, active: false };
    };

    const movePointer = (event: globalThis.PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
    };

    const releasePointer = () => {
      pointer.active = false;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);
      const centerX = pointer.active ? pointer.x : width * 0.58 + Math.cos(time * 0.00028) * width * 0.13;
      const centerY = pointer.active ? pointer.y : height * 0.48 + Math.sin(time * 0.00036) * height * 0.16;

      for (const agent of agents) {
        const dx = centerX - agent.x;
        const dy = centerY - agent.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const orbit = Math.min(0.028, 2 / distance);
        agent.vx += (dx / distance) * orbit + (-dy / distance) * 0.009;
        agent.vy += (dy / distance) * orbit + (dx / distance) * 0.009;
        agent.vx += Math.cos(time * 0.0007 + agent.seed) * 0.003;
        agent.vy += Math.sin(time * 0.0008 + agent.seed) * 0.003;
        agent.vx *= 0.992;
        agent.vy *= 0.992;
        const speed = Math.hypot(agent.vx, agent.vy);
        if (speed > 1.6) {
          agent.vx = (agent.vx / speed) * 1.6;
          agent.vy = (agent.vy / speed) * 1.6;
        }
        agent.x += agent.vx;
        agent.y += agent.vy;

        if (agent.x < -20) agent.x = width + 20;
        if (agent.x > width + 20) agent.x = -20;
        if (agent.y < -20) agent.y = height + 20;
        if (agent.y > height + 20) agent.y = -20;
      }

      context.lineWidth = 0.65;
      for (let i = 0; i < agents.length; i += 1) {
        const current = agents[i];
        for (let j = i + 1; j < agents.length; j += 1) {
          const other = agents[j];
          const distance = Math.hypot(current.x - other.x, current.y - other.y);
          if (distance < 92) {
            context.strokeStyle = `rgba(194, 255, 80, ${(1 - distance / 92) * 0.22})`;
            context.beginPath();
            context.moveTo(current.x, current.y);
            context.lineTo(other.x, other.y);
            context.stroke();
          }
        }
      }

      for (const agent of agents) {
        context.beginPath();
        context.arc(agent.x, agent.y, agent.size, 0, Math.PI * 2);
        context.fillStyle = agent.size > 3 ? "#c2ff50" : agent.size > 2 ? "#67d7ff" : "rgba(244, 242, 234, .72)";
        context.fill();
      }

      context.beginPath();
      context.arc(centerX, centerY, 28, 0, Math.PI * 2);
      context.strokeStyle = "rgba(194, 255, 80, .34)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.arc(centerX, centerY, 4, 0, Math.PI * 2);
      context.fillStyle = "#c2ff50";
      context.fill();

      if (!reduced) frame = requestAnimationFrame(draw);
    };

    reset();
    draw(0);
    window.addEventListener("resize", reset);
    canvas.addEventListener("pointermove", movePointer);
    canvas.addEventListener("pointerleave", releasePointer);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reset);
      canvas.removeEventListener("pointermove", movePointer);
      canvas.removeEventListener("pointerleave", releasePointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="swarm-canvas" aria-label="Interactive autonomous swarm visualization" />;
}

export default function Home() {
  const [clock, setClock] = useState("--:--:--");
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("motion-ready");
    const tick = () => {
      setClock(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Istanbul",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    };
    tick();
    const timer = window.setInterval(tick, 1000);

    const handleScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      document.documentElement.style.setProperty("--scroll", `${max > 0 ? window.scrollY / max : 0}`);
    };

    const handlePointer = (event: globalThis.PointerEvent) => {
      cursorRef.current?.style.setProperty("transform", `translate3d(${event.clientX}px, ${event.clientY}px, 0)`);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointer, { passive: true });
    handleScroll();

    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointer);
      document.documentElement.classList.remove("motion-ready");
    };
  }, []);

  const handleTilt = (event: PointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.setProperty("--rx", `${y * -5}deg`);
    element.style.setProperty("--ry", `${x * 7}deg`);
    element.style.setProperty("--mx", `${(x + 0.5) * 100}%`);
    element.style.setProperty("--my", `${(y + 0.5) * 100}%`);
  };

  const resetTilt = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--rx", "0deg");
    event.currentTarget.style.setProperty("--ry", "0deg");
  };

  return (
    <main>
      <div className="scroll-progress" aria-hidden="true" />
      <div ref={cursorRef} className="cursor-orb" aria-hidden="true" />

      <header className="site-header">
        <a className="monogram" href="#top" aria-label="Eren Gün — back to top">
          EG<span>®</span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#work">Work</a>
          <a href="#proof">Proof</a>
          <a href="#about">About</a>
        </nav>
        <div className="header-status">
          <span className="status-dot" />
          <span>IST {clock}</span>
        </div>
        <a className="header-link" href="https://www.linkedin.com/in/erengun/" target="_blank" rel="noreferrer">
          Let&apos;s talk <span>↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <SwarmCanvas />
        <div className="hero-meta hero-meta-left">
          <span>41.0082° N</span>
          <span>28.9784° E</span>
          <span>ISTANBUL / TR</span>
        </div>
        <div className="hero-meta hero-meta-right">
          <span>SOFTWARE DEVELOPER</span>
          <span>OPEN-SOURCE BUILDER</span>
          <span>COMPETITIVE CODER</span>
        </div>

        <div className="hero-copy">
          <p className="eyebrow"><span /> EREN GÜN · SELECTED WORK 2026</p>
          <h1 aria-label="I build the unlikely">
            <span className="line"><span>I BUILD</span></span>
            <span className="line outline"><span>THE</span></span>
            <span className="line accent"><span>UNLIKELY.</span></span>
          </h1>
          <div className="hero-bottom">
            <p>
              Award-winning software developer turning ambitious ideas into
              <strong> fast, elegant, real products.</strong>
            </p>
            <a className="round-link" href="#work" aria-label="Explore selected work">
              <span>EXPLORE</span>
              <b>↓</b>
            </a>
          </div>
        </div>

        <div className="portrait-chip" aria-label="Portrait of Eren Gün">
          <img src="/eren-gun.jpg" alt="Eren Gün skiing in the mountains" />
          <span>OFFLINE / ONLINE</span>
        </div>
        <div className="swarm-label"><span /> LIVE SWARM / MOVE YOUR CURSOR</div>
      </section>

      <div className="ticker" aria-label="Areas of expertise">
        <div className="ticker-track">
          {[...ticker, ...ticker].map((item, index) => (
            <span key={`${item}-${index}`}>{item}<b>✦</b></span>
          ))}
        </div>
      </div>

      <section className="intro section-shell" id="about">
        <div className="section-index reveal">( 00—ABOUT )</div>
        <div className="intro-content reveal">
          <p className="intro-lead">
            Not a framework collector.
            <br />
            <em>A builder who ships.</em>
          </p>
          <div className="intro-aside">
            <p>
              I&apos;m Eren — an École 42-trained developer working where mobile,
              autonomous systems and open source collide.
            </p>
            <p>
              My favorite problems have unclear edges, impossible deadlines,
              and a result people can actually touch.
            </p>
            <div className="social-row">
              <a href="https://github.com/Erengun" target="_blank" rel="noreferrer">GitHub ↗</a>
              <a href="https://www.linkedin.com/in/erengun/" target="_blank" rel="noreferrer">LinkedIn ↗</a>
            </div>
          </div>
        </div>
      </section>

      <section className="proof section-shell" id="proof">
        <div className="section-heading reveal">
          <div className="section-index">( 01—PROOF )</div>
          <h2>THE RECEIPTS.</h2>
          <p>Recognition is a side effect.<br />The work comes first.</p>
        </div>
        <div className="achievement-grid">
          {achievements.map((achievement, index) => (
            <article className={`achievement-card ${achievement.className} reveal`} key={achievement.title} style={{ transitionDelay: `${index * 70}ms` }}>
              <div className="card-top">
                <span>{achievement.index}</span>
                <span>VERIFIED SIGNAL</span>
              </div>
              <div className="metric">{achievement.metric}</div>
              <div className="achievement-copy">
                <span>{achievement.kicker}</span>
                <h3>{achievement.title}</h3>
                <p>{achievement.detail}</p>
              </div>
              <div className="card-cross" aria-hidden="true">+</div>
            </article>
          ))}
        </div>
      </section>

      <section className="work section-shell" id="work">
        <div className="section-heading work-heading reveal">
          <div className="section-index">( 02—SELECTED WORK )</div>
          <h2>BUILT IN PUBLIC.</h2>
          <p>Two open-source products.<br />One belief: useful beats loud.</p>
        </div>

        <article className="project project-subzilla reveal" onPointerMove={handleTilt} onPointerLeave={resetTilt}>
          <div className="project-info">
            <div className="project-number">01 / PRODUCT</div>
            <div>
              <div className="project-title-row">
                <h3>SUBZILLA</h3>
                <span>OPEN SOURCE</span>
              </div>
              <p className="project-tagline">Subscriptions, tamed.</p>
              <p className="project-description">
                A private-first Flutter app for tracking recurring expenses,
                visualizing spending and catching the next payment before it catches you.
              </p>
              <div className="tag-list">
                <span>FLUTTER</span><span>RIVERPOD</span><span>LOCAL-FIRST</span><span>ANALYTICS</span>
              </div>
            </div>
            <a className="project-link" href="https://github.com/DevOpen-io/SubZilla" target="_blank" rel="noreferrer">
              View repository <b>↗</b>
            </a>
          </div>
          <div className="project-visual subzilla-visual">
            <div className="visual-noise" />
            <div className="phone phone-back"><img src="/subzilla-home.png" alt="SubZilla app home screen in dark mode" /></div>
            <div className="phone phone-front"><img src="/subzilla-home.png" alt="" /></div>
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="visual-caption">KEEP YOUR MONEY / KEEP YOUR DATA</div>
          </div>
        </article>

        <article className="project project-dondurma reveal" onPointerMove={handleTilt} onPointerLeave={resetTilt}>
          <div className="project-info">
            <div className="project-number">02 / PRODUCT</div>
            <div>
              <div className="project-title-row">
                <h3>DONDURMA</h3>
                <span>OPEN SOURCE</span>
              </div>
              <p className="project-tagline">Your feeds. Your rules.</p>
              <p className="project-description">
                A premium RSS/Atom reader across six platforms — private,
                customizable and refreshingly algorithm-free.
              </p>
              <div className="tag-list">
                <span>FLUTTER</span><span>MATERIAL 3</span><span>RSS / ATOM</span><span>6 PLATFORMS</span>
              </div>
            </div>
            <a className="project-link" href="https://github.com/DevOpen-io/dondurma-rss-reader" target="_blank" rel="noreferrer">
              View repository <b>↗</b>
            </a>
          </div>
          <div className="project-visual dondurma-visual">
            <div className="sunburst" aria-hidden="true" />
            <div className="dondurma-logo-wrap"><img src="/dondurma-logo.png" alt="Dondurma RSS Reader app icon" /></div>
            <div className="feed-card feed-one"><span>DESIGN</span><b>Ideas worth keeping.</b><small>8 min read</small></div>
            <div className="feed-card feed-two"><span>TECH</span><b>No algorithms here.</b><small>4 min read</small></div>
            <div className="visual-caption dark">NO TRACKING / NO NOISE / JUST FEEDS</div>
          </div>
        </article>
      </section>

      <section className="devopen" aria-labelledby="devopen-title">
        <div className="devopen-grid" aria-hidden="true" />
        <div className="devopen-inner section-shell">
          <div className="section-index reveal">( 03—COLLECTIVE )</div>
          <div className="devopen-copy reveal">
            <p className="eyebrow"><span /> FRIENDS WHO SHIP TOGETHER</p>
            <h2 id="devopen-title">DEV<span>OPEN</span><sup>.IO</sup></h2>
            <p>
              A small open-source collective built with friends. We turn
              late-night ideas into public tools — useful, transparent and yours to fork.
            </p>
            <a href="https://github.com/DevOpen-io" target="_blank" rel="noreferrer">Enter the collective ↗</a>
          </div>
          <div className="constellation reveal" aria-label="DevOpen project constellation">
            <div className="constellation-line line-a" />
            <div className="constellation-line line-b" />
            <div className="constellation-line line-c" />
            <div className="node node-main">DO<span>CORE</span></div>
            <div className="node node-a">SZ<span>SUBZILLA</span></div>
            <div className="node node-b">DR<span>DONDURMA</span></div>
            <div className="node node-c">OS<span>OPEN SOURCE</span></div>
            <div className="node node-d">09<span>REPOS</span></div>
          </div>
        </div>
      </section>

      <section className="code-philosophy section-shell">
        <div className="section-index reveal">( 04—OPERATING SYSTEM )</div>
        <div className="philosophy-layout">
          <h2 className="reveal">THINK.<br /><span>BREAK.</span><br />BUILD.<br /><em>REPEAT.</em></h2>
          <div className="principles">
            {[
              ["01", "Clarity over cleverness", "The best systems explain themselves."],
              ["02", "Ship the hard part", "Polish is worthless without a working core."],
              ["03", "Open by default", "Shared code compounds into shared progress."],
              ["04", "Play to win", "Competition is a laboratory for focus."],
            ].map(([number, title, copy]) => (
              <div className="principle reveal" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p><b>↗</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="contact" id="contact">
        <div className="contact-orb" aria-hidden="true" />
        <div className="contact-content section-shell reveal">
          <div className="section-index">( 05—NEXT MISSION )</div>
          <p>Have an ambitious problem?</p>
          <h2>LET&apos;S MAKE<br />THE IMPOSSIBLE<br /><span>FEEL OBVIOUS.</span></h2>
          <div className="contact-actions">
            <a href="https://www.linkedin.com/in/erengun/" target="_blank" rel="noreferrer">Start a conversation <b>↗</b></a>
            <a href="https://github.com/Erengun" target="_blank" rel="noreferrer">Explore 48 repositories <b>↗</b></a>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div>EREN GÜN © 2026</div>
        <div>DESIGNED TO MOVE · BUILT TO LAST</div>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
    </main>
  );
}
