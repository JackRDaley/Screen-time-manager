import { useMemo, useState } from "react";

const features = [
  {
    title: "Website blocking",
    detail: "Block distracting sites before they pull you back in.",
    icon: "pause",
    tone: "blue"
  },
  {
    title: "Daily limits",
    detail: "Set time limits for specific domains so quick checks do not turn into long sessions.",
    icon: "clock",
    tone: "cyan"
  },
  {
    title: "Focus schedules",
    detail: "Create time blocks where distracting websites stay unavailable.",
    icon: "calendar",
    tone: "mint"
  },
  {
    title: "Activity dashboard",
    detail: "See blocked pages, repeat visits, and usage patterns in one simple view.",
    icon: "spark",
    tone: "violet"
  },
  {
    title: "Adjustable friction",
    detail: "Use gentle reminders, strict blocks, and focus rules that match real life.",
    icon: "pointer",
    tone: "cyan"
  },
  {
    title: "Privacy-conscious tracking",
    detail: "Track only what is needed to provide blocking, limits, and basic usage stats.",
    icon: "shield",
    tone: "mint"
  }
];

const proofItems = [
  ["Chrome extension", "Built for the browser where distractions happen."],
  ["No account required", "Install and start with one distracting site."],
  ["Privacy-conscious", "Domain-level controls, not surveillance."],
  ["Flexible rules", "Limits, schedules, and stricter focus blocks."]
];

const heroPoints = [
  ["Add the sites", "YouTube, Reddit, social apps, news, or anything that breaks focus."],
  ["Set your rules", "Use daily limits, schedules, or stricter focus blocks."],
  ["Get a pause", "Turn an automatic tab check into a choice you can notice."]
];

const steps = [
  ["01", "Add distracting websites", "Add YouTube, Reddit, TikTok, Instagram, X, games, news, or any domain that pulls you off task."],
  ["02", "Choose your friction", "Use a daily limit, a focus schedule, or a stricter block when you need the extension to push back."],
  ["03", "Notice the habit", "Blocked attempts become useful feedback instead of another lost session."]
];

const walkthroughs = [
  {
    eyebrow: "Daily limits",
    title: "Set a ceiling before the scroll starts.",
    detail: "Give each distracting domain a realistic daily budget. When time runs out, Screen Time Manager turns the next visit into a decision point.",
    bullets: ["Domain-specific limits", "Clean remaining-time status", "Simple edits when routines change"],
    imageSrc: "/extension-limits-tab-render.png",
    imageSide: "right"
  },
  {
    eyebrow: "Focus schedules",
    title: "Protect the hours that matter.",
    detail: "Schedule blocks for study sessions, work blocks, sleep windows, or any recurring moment where entertainment should stay out of reach.",
    bullets: ["Work and study windows", "Recurring schedule support", "Rules that can be stricter when needed"],
    imageSrc: "/extension-schedule-tab-render.png",
    imageSide: "left"
  },
  {
    eyebrow: "Activity insight",
    title: "Turn vague screen-time guilt into something visible.",
    detail: "See the sites that keep pulling you back, the attempts you avoided, and the moments where a better rule would help.",
    bullets: ["Most-visited domains", "Blocked-attempt awareness", "Signals you can actually adjust"],
    imageSrc: "/extension-dashboard-render.png",
    imageSide: "right"
  }
];

const faqs = [
  ["Is Screen Time Manager free?", "The extension is free to install from the Chrome Web Store."],
  ["Can I block specific websites?", "Yes. Add the domains that distract you, then choose limits, schedules, or stricter focus blocks for each one."],
  ["Can I use schedules for school or work?", "Yes. Focus schedules are designed for recurring sessions like class, homework, deep work, or bedtime."],
  ["Can I still change my rules later?", "Yes. You control the domains, schedules, limits, and friction level, so your setup can change with your routine."],
  ["Does it track everything I do online?", "No. It is focused on domain-level activity, configured limits, blocked attempts, and usage stats needed for the product to work."],
  ["Does this only work in Chrome?", "The extension is built for Chrome, alternative browser support is coming in the future."],
];

const credibilityItems = [
  ["Built for real life", "Use softer reminders for ordinary browsing and stricter rules when you need a stronger boundary."],
  ["Simple by default", "Start with one site. Add more rules only when you know they will help."],
  ["Under your control", "The extension exists to support your attention, not to shame you for using the web."]
];

const testimonials = [
  [
    "I used to open YouTube without even thinking. Seeing the block page gives me just enough time to remember what I was supposed to be doing.",
    "College student"
  ],
  [
    "Daily limits made Reddit feel like a choice again instead of something I kept falling into between tasks.",
    "Remote worker"
  ],
  [
    "I like that it shows the repeat visits. It is easier to fix my rules when I can see which sites keep pulling me back.",
    "Independent builder"
  ]
];

const storeUrl = "https://chromewebstore.google.com/detail/screen-time-manager/pecaajdaecdmikcgfdgldcofdebhfbgo";

const internalLinks = {
  privacy: "/privacy",
  changelog: "/changelog",
  feedback: "/feedback"
};

const trustItems = [
  "No unnecessary tracking",
  "No selling user data",
  "Clear domain-based controls",
  "Settings stay under your control"
];

function Icon({ name }) {
  const common = {
    width: "22",
    height: "22",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  };

  if (name === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === "pause") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8v8M14 8v8" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...common}>
        <path d="M7 3v3M17 3v3M4 8h16" />
        <rect x="4" y="5" width="16" height="16" rx="3" />
        <path d="M8 12h3M13 12h3M8 16h3" />
      </svg>
    );
  }

  if (name === "pointer") {
    return (
      <svg {...common}>
        <path d="M5 3l14 7-6 2-2 6L5 3Z" />
        <path d="m13 12 5 5" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v6c0 4.4 2.8 7.4 7 9 4.2-1.6 7-4.6 7-9V6l-7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" />
    </svg>
  );
}

function GlowCard({ children, className = "" }) {
  return <article className={`glow-card ${className}`}>{children}</article>;
}

function ProductStage() {
  return (
    <div className="product-stage" aria-label="Screen Time Manager product preview">
      <div className="device-frame">
        <img src="/extension-dashboard-render.png" alt="Screen Time Manager dashboard preview" />
      </div>
    </div>
  );
}

function ProofStrip() {
  return (
    <section className="proof-strip" aria-label="Product trust signals">
      {proofItems.map(([title, detail]) => (
        <div className="proof-item" key={title}>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      ))}
    </section>
  );
}

function FrictionDemo() {
  return (
    <section className="friction-section">
      <div className="friction-copy">
        <span className="section-kicker">Why it works</span>
        <h2>Add a pause between impulse and action.</h2>
        <p>
          Most distraction starts as muscle memory: type a URL, open a feed, forget why you were
          there. Screen Time Manager interrupts that pattern with enough friction to make the next
          click intentional.
        </p>
      </div>
      <div className="friction-demo" aria-label="Friction flow example">
        <div className="browser-bar">
          <span />
          <span />
          <span />
          <strong>youtube.com</strong>
        </div>
        <div className="intervention-card">
          <Icon name="pause" />
          <div>
            <strong>Pause before continuing</strong>
            <p>This site is blocked during your focus window.</p>
          </div>
        </div>
        <div className="choice-row">
          <span>Return to task</span>
          <span>Adjust rule</span>
        </div>
      </div>
    </section>
  );
}

function ProductMockup({ imageSrc, title }) {
  return (
    <div className="walkthrough-preview" aria-label={`${title} product preview`}>
      <img src={imageSrc} alt="" />
    </div>
  );
}

function ProductWalkthrough() {
  return (
    <section className="walkthrough-section" id="walkthrough">
      <div className="section-heading">
        <span className="section-kicker">Product walkthrough</span>
        <h2>See the extension doing the work.</h2>
        <p>
          The strongest rules are the ones you can understand at a glance: what is blocked, why it
          is blocked, and how much attention the pause is protecting.
        </p>
      </div>
      <div className="walkthrough-stack">
        {walkthroughs.map((item) => (
          <article className={`walkthrough-row media-${item.imageSide}`} key={item.title}>
            <div className="walkthrough-copy">
              <span className="section-kicker">{item.eyebrow}</span>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <ul>
                {item.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
            <ProductMockup imageSrc={item.imageSrc} title={item.eyebrow} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Calculator() {
  const [hours, setHours] = useState(4);
  const updateHours = (event) => setHours(Number(event.currentTarget.value));
  const stats = useMemo(() => {
    const weekly = hours * 7 * 0.25;
    return {
      weekly: weekly.toFixed(1),
      yearly: Math.round((weekly * 52) / 24)
    };
  }, [hours]);

  return (
    <GlowCard className="calculator-card">
      <div>
        <span className="section-kicker">Time calculator</span>
        <h2>What would a 25% reduction give back?</h2>
      </div>
      <div className="range-readout">{hours}h / day</div>
      <input
        aria-label="Distracting browsing hours per day"
        min="1"
        max="12"
        step="1"
        type="range"
        value={hours}
        onChange={updateHours}
        onInput={updateHours}
      />
      <div className="calc-stats">
        <div>
          <strong>{stats.weekly}h</strong>
          <span>saved each week</span>
        </div>
        <div>
          <strong>{stats.yearly}</strong>
          <span>days reclaimed yearly</span>
        </div>
      </div>
    </GlowCard>
  );
}

export default function App() {
  return (
    <main className="prototype-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Screen Time Manager home">
          <img src="/new_logo.png" alt="" />
          <span>Screen Time Manager</span>
        </a>
        <nav aria-label="Prototype navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#walkthrough">Product</a>
          <a href="#calculator">Calculator</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
          Add to Chrome
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <h1>Block distracting websites. Take back your focus.</h1>
          <div className="hero-actions">
            <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
              Add to Chrome
            </a>
            <a className="button button-secondary" href="#how-it-works">See how it works</a>
          </div>
          <p className="hero-lede">
            Add the websites that pull you off task, set limits or focus blocks, and let
            Screen Time Manager enforce them right from Chrome.
          </p>
          <p className="hero-note">Free to install. Choose the sites that distract you and set your own rules.</p>
          <ul className="hero-points" aria-label="Quick setup">
            {heroPoints.map(([title, detail]) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <ProductStage />
      </section>

      <ProofStrip />

      <section className="problem-section">
        <div className="problem-copy">
          <span className="section-kicker">The quick check is the trap</span>
          <h2>Distraction starts before you notice it.</h2>
          <p>
            You open YouTube for one video. You check Reddit for a minute. You glance at social
            media between assignments. Screen Time Manager adds the friction you need before those
            quick visits become a habit.
          </p>
        </div>
      </section>

      <section className="testimonial-strip" aria-label="User testimonials">
        <div className="review-grid">
          {testimonials.map(([quote, context]) => (
            <GlowCard className="review-card" key={quote}>
              <p>
                <span className="quote-mark quote-mark-open" aria-hidden="true">{"\u201c"}</span>
                {quote}
                <span className="quote-mark quote-mark-close" aria-hidden="true">{"\u201d"}</span>
              </p>
              <span className="review-context">{context}</span>
            </GlowCard>
          ))}
        </div>
      </section>

      <section className="reviews-section" aria-labelledby="reviews-title">
        <div className="section-heading">
          <span className="section-kicker">What users notice</span>
          <h2 id="reviews-title">A small pause can change the whole session.</h2>
          <p>People do not need more guilt. They need a moment where the automatic click becomes visible.</p>
        </div>
      </section>

      <FrictionDemo />

      <section className="flow-section" id="how-it-works">
        <div className="section-heading">
          <span className="section-kicker">How it works</span>
          <h2>Set the rule once. Let the extension push back.</h2>
        </div>
        <div className="step-track">
          {steps.map(([number, title, detail]) => (
            <GlowCard className="step-card" key={number}>
              <span className="step-number">{number}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </GlowCard>
          ))}
        </div>
      </section>

      <section className="feature-section" id="features">
        <div className="section-heading">
          <span className="section-kicker">Features</span>
          <h2>Simple tools for browser-based focus.</h2>
          <p>Clean controls, useful stats, and website limits that stay out of the way until you need them.</p>
        </div>
        <div className="feature-grid">
          {features.map((feature) => (
            <GlowCard className={`feature-card tone-${feature.tone}`} key={feature.title}>
              <div className="icon-tile">
                <Icon name={feature.icon} />
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.detail}</p>
            </GlowCard>
          ))}
        </div>
      </section>

      <ProductWalkthrough />

      <section className="credibility-section" aria-labelledby="credibility-title">
        <div className="section-heading">
          <span className="section-kicker">Built for real life</span>
          <h2 id="credibility-title">Strict when it matters. Flexible when life changes.</h2>
          <p>Good focus tools should help without turning your browser into a punishment system.</p>
        </div>
        <div className="credibility-grid">
          {credibilityItems.map(([title, detail]) => (
            <GlowCard className="credibility-card" key={title}>
              <h3>{title}</h3>
              <p>{detail}</p>
            </GlowCard>
          ))}
        </div>
      </section>

      <section className="calculator-section" id="calculator">
        <Calculator />
        <div className="calculator-copy">
          <span className="section-kicker">Estimate the upside</span>
          <h2>Small changes become real hours.</h2>
          <p>
            Drag the slider to estimate how much distracting browsing you could reclaim by cutting
            unplanned screen time by just 25%.
          </p>
        </div>
      </section>

      <section className="faq-section" id="faq" aria-labelledby="faq-title">
        <div className="section-heading">
          <span className="section-kicker">FAQ</span>
          <h2 id="faq-title">Questions before you install?</h2>
          <p>Short answers for the things people usually want to know before adding a focus extension.</p>
        </div>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="privacy-section">
        <div>
          <span className="section-kicker">Privacy and trust</span>
          <h2>Built to be simple and privacy-conscious.</h2>
          <p>
            Screen Time Manager only tracks the activity needed to provide website blocking,
            limits, and usage stats. The product is built for personal focus, not surveillance.
          </p>
        </div>
        <ul className="trust-list">
          {trustItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="final-cta">
        <span className="section-kicker">Ready to focus?</span>
        <h2>Start with one distracting site.</h2>
        <p>Add Screen Time Manager to Chrome, choose the site that pulls you off task most often, and give your next focus session a stronger boundary.</p>
        <div className="cta-actions">
          <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
            Add to Chrome
          </a>
          <a className="button button-secondary" href={internalLinks.privacy}>Read privacy policy</a>
        </div>
      </section>

      <section className="feedback-section">
        <div>
          <span className="section-kicker">Feedback</span>
          <h2>Help shape Screen Time Manager.</h2>
          <p>Found a bug, want a feature, or have an idea for making the extension better?</p>
        </div>
        <a className="button button-secondary" href={internalLinks.feedback}>Send feedback</a>
      </section>

      <footer className="site-footer">
        <a className="brand" href="#top" aria-label="Screen Time Manager home">
          <img src="/new_logo.png" alt="" />
          <span>Screen Time Manager</span>
        </a>
        <nav aria-label="Footer navigation">
          <a href={storeUrl} target="_blank" rel="noreferrer">Chrome Web Store</a>
          <a href={internalLinks.privacy}>Privacy</a>
          <a href={internalLinks.changelog}>Changelog</a>
          <a href={internalLinks.feedback}>Feedback</a>
        </nav>
      </footer>
    </main>
  );
}
