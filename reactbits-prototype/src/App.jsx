const features = [
  {
    title: "Website blocking",
    detail: "Block distracting sites before they pull you back in.",
    icon: "pause",
    tone: "orange"
  },
  {
    title: "Daily limits",
    detail: "Set time limits for specific domains so quick checks do not turn into long sessions.",
    icon: "clock",
    tone: "gold"
  },
  {
    title: "Focus schedules",
    detail: "Create time blocks where distracting websites stay unavailable.",
    icon: "calendar",
    tone: "cyan"
  },
  {
    title: "Activity dashboard",
    detail: "See blocked pages, repeat visits, and usage patterns in one simple view.",
    icon: "spark",
    tone: "orange"
  },
  {
    title: "Adjustable friction",
    detail: "Use gentle reminders, strict blocks, and focus rules that match real life.",
    icon: "pointer",
    tone: "gold"
  },
  {
    title: "Privacy-conscious tracking",
    detail: "Track only what is needed to provide blocking, limits, and basic usage stats.",
    icon: "shield",
    tone: "cyan"
  }
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
    title: "Set a limit before you scroll",
    detail: "Give each distracting domain a realistic daily budget. When time runs out, Saturn turns the next visit into a decision point.",
    bullets: ["Domain-specific limits", "Clean remaining-time status", "Simple edits when routines change"],
    imageSrc: "/saturn-extension-limits-render.png",
    imageSide: "right"
  },
  {
    eyebrow: "Focus schedules",
    title: "Protect the hours that matter",
    detail: "Schedule blocks for study sessions, work blocks, sleep windows, or any recurring moment where entertainment should stay out of reach.",
    bullets: ["Work and study windows", "Recurring schedule support", "Rules that can be stricter when needed"],
    imageSrc: "/saturn-extension-schedule-render.png",
    imageSide: "left"
  },
  {
    eyebrow: "Activity insight",
    title: "See the numbers in real time",
    detail: "See the sites that keep pulling you back, the attempts you avoided, and the moments where a better rule would help.",
    bullets: ["Blocked attempts and snoozes", "Most-visited domains", "Personalized insights"],
    imageSrc: "/saturn-extension-dashboard-render.png",
    imageSide: "right"
  }
];

const faqs = [
  ["Is Saturn free?", "The extension is free to install from the Chrome Web Store."],
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
const feedbackUrl = "https://www.surveymonkey.com/r/QF2RJ58";

const internalLinks = {
  privacy: "/privacy",
  changelog: "/changelog",
  feedback: "/feedback"
};

const trustItems = [
  "No account required",
  "No unnecessary tracking",
  "No selling user data",
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

function DashboardPreview() {
  return (
    <div className="dashboard-preview" aria-label="Saturn dashboard preview">
      <div className="preview-topline">
        <div className="preview-brand">
          <img src="/planets/saturn-app-icon-128.png" alt="" />
          <div>
            <strong>Saturn</strong>
          </div>
        </div>
        <div className="preview-status">
          <span className="status-burn">8</span>
          <span className="status-active">2 active</span>
        </div>
      </div>
      <div className="preview-tabs" aria-hidden="true">
        <span className="is-active">Dashboard</span>
        <span>Limits</span>
        <span>Schedule</span>
        <span>Settings</span>
      </div>
      <div className="preview-stat-grid">
        <div>
          <span>Screen time</span>
          <strong>2h 18m</strong>
          <em>-34m</em>
        </div>
        <div>
          <span>Visits</span>
          <strong>37</strong>
          <em>-22%</em>
        </div>
        <div>
          <span>Snoozes</span>
          <strong>3</strong>
          <em>Today</em>
        </div>
      </div>
      <div className="preview-filter">Today</div>
      <div className="preview-card active-blocks">
        <span className="preview-label">Active blocks</span>
        <div className="preview-row">
          <div>
            <strong>youtube.com</strong>
            <span>Daily limit reached</span>
          </div>
          <em>0m left</em>
        </div>
        <div className="preview-row">
          <div>
            <strong>reddit.com</strong>
            <span>Focus block active until 5:00 PM</span>
          </div>
          <em>42m</em>
        </div>
      </div>
      <div className="preview-bottom-grid">
        <div className="preview-card rank-card">
          <span className="preview-label">Time spent</span>
          <div className="rank-line"><strong>1</strong><span>youtube.com</span><em>1h 02m</em></div>
          <div className="preview-meter"><span style={{ width: "86%" }} /></div>
          <div className="rank-line"><strong>2</strong><span>reddit.com</span><em>34m</em></div>
          <div className="preview-meter"><span style={{ width: "58%" }} /></div>
        </div>
        <div className="preview-card chart-card">
          <span className="preview-label">Hourly usage</span>
          <div className="preview-chart" aria-hidden="true">
            {[18, 26, 12, 8, 24, 46, 58, 72, 49, 76, 61, 44, 32, 27, 20, 14].map((height, index) => (
              <span key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductStage() {
  return (
    <div className="product-stage" aria-label="Saturn product preview">
      <div className="device-frame">
        <DashboardPreview />
      </div>
    </div>
  );
}

function FrictionDemo() {
  return (
    <section className="friction-section">
      <div className="friction-copy">
        <span className="section-kicker">Why it works</span>
        <h2>Saturn adds a pause between impulse and action</h2>
        <p>
          Most distractions are unconcious. Saturn adds a moment to notice the habit before it takes over.
        </p>
      </div>
      <div className="friction-demo" aria-label="Friction flow example">
        <div className="browser-bar">
          <strong>youtube.com</strong>
          <span />
          <span />
          <span />
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
          <span>Close tab</span>
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
        <h2>Not convinced? See for yourself</h2>
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

function JourneySystem() {
  return (
    <GlowCard className="journey-card">
      <div className="journey-header">
        <span className="journey-kicker">Planet journey system</span>
        <h2>
          Your reclaimed time becomes a journey you can <span>see.</span>
        </h2>
        <p>Turn focus into progress. Every minute reclaimed moves you forward.</p>
      </div>

      <div className="journey-visual" aria-label="Journey progress from Earth toward the Moon">
        <div className="journey-planet journey-planet-start">
          <span className="journey-planet-icon">
            <img src="/planets/earth.png" alt="" />
          </span>
          <strong>Earth</strong>
        </div>
        <div className="journey-path">
          <img className="journey-path-image" src="/planets/mission-path.png" alt="" aria-hidden="true" />
          <img className="journey-rocket" src="/planets/rocket-cutout.png" alt="" />
        </div>
        <div className="journey-planet journey-planet-next">
          <span className="journey-planet-icon">
            <img src="/planets/moon.png" alt="" />
          </span>
          <strong>Moon</strong>
        </div>
        <div className="journey-future-route" aria-label="Future journey destinations">
          <span className="future-segment" aria-hidden="true"></span>
          <span className="journey-future-stop">
            <img src="/planets/mars.png" alt="Mars" />
          </span>
          <span className="future-segment" aria-hidden="true"></span>
          <span className="journey-future-stop">
            <img src="/planets/jupiter.png" alt="Jupiter" />
          </span>
          <span className="future-segment" aria-hidden="true"></span>
          <span className="journey-future-stop journey-future-stop-saturn">
            <img src="/planets/saturn-timeline.png" alt="Saturn" />
          </span>
        </div>
      </div>

      <div className="journey-explainer">
        <div>
          <span className="journey-info-icon" aria-hidden="true">
            <img src="/planets/rocket-cutout.png" alt="" />
          </span>
          <strong>How you travel</strong>
          <span>
            Every blocked distraction and minute reclaimed pushes your rocket farther through the
            solar system.
          </span>
        </div>
        <div>
          <span className="journey-info-icon" aria-hidden="true">
            <img src="/planets/saturn-app-icon-128.png" alt="" />
          </span>
          <strong>Why it matters</strong>
          <span>
            Instead of watching a number increase, you will watch your focus carry you from planet
            to planet.
          </span>
        </div>
      </div>
    </GlowCard>
  );
}

export default function App() {
  return (
    <main className="prototype-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Saturn home">
          <img src="/planets/saturn-app-icon-128.png" alt="" />
          <span>Saturn</span>
        </a>
        <nav aria-label="Prototype navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#walkthrough">Product</a>
          <a href="#journey">Journey</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
          Add to Chrome
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <h1>Take back your <span>focus</span> with <span>Saturn</span></h1>
          <p className="hero-lede">
            Saturn helps you block distracting sites, set daily limits, and understand where your
            time goes right from Chrome, with no account required.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
              Add to Chrome
            </a>
            <a className="button button-secondary" href="#journey">See the journey</a>
          </div>
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

      <section className="problem-section">
        <div className="problem-copy">
          <span className="section-kicker">The quick check is the trap</span>
          <h2>Distraction starts before you notice it</h2>
          <p>
            You open YouTube for one video. You check Reddit for a minute. You glance at social
            media between assignments. Saturn adds the friction you need before those
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
          <h2 id="reviews-title">A small reminder can change everything</h2>
          <p>You don't need another guilt trip. You need a moment where the automatic click becomes visible.</p>
        </div>
      </section>

      <FrictionDemo />

      <section className="flow-section" id="how-it-works">
        <div className="section-heading">
          <span className="section-kicker">How it works</span>
          <h2>Set the rule once. Let Saturn do the rest</h2>
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
          <h2>Simple to use, powerful to customize</h2>
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

      <section className="journey-section" id="journey">
        <JourneySystem />
      </section>

      <ProductWalkthrough />

      <section className="credibility-section" aria-labelledby="credibility-title">
        <div className="section-heading">
          <span className="section-kicker">Built for real life</span>
          <h2 id="credibility-title-1">Strict when it matters, flexible when life changes</h2>
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

      <section className="final-cta">
        <span className="section-kicker">Ready to focus?</span>
        <h2>Start with one distracting site</h2>
        <p>Add Saturn to Chrome, choose the site that pulls you off task most often, and give your next focus session a stronger boundary.</p>
        <div className="cta-actions">
          <a className="button button-primary" href={storeUrl} target="_blank" rel="noreferrer">
            Add to Chrome
          </a>
          <a className="button button-secondary" href={internalLinks.privacy}>Read privacy policy</a>
        </div>
      </section>

      <section className="faq-section" id="faq" aria-labelledby="faq-title">
        <div className="section-heading">
          <span className="section-kicker">FAQ</span>
          <h2 id="faq-title">Questions before you install?</h2>
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
          <h2>Built to be simple and privacy-conscious</h2>
          <p>
            Saturn only tracks the activity needed to provide website blocking,
            limits, and usage stats. The product is built for personal focus, not surveillance.
          </p>
        </div>
        <ul className="trust-list">
          {trustItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="feedback-section">
        <div>
          <span className="section-kicker">Feedback</span>
          <h2>Help shape Saturn</h2>
          <p>Found a bug, want a feature, or have an idea for making the extension better?</p>
        </div>
        <a className="button button-secondary" href={feedbackUrl} target="_blank" rel="noreferrer">Send feedback</a>
      </section>

      <footer className="site-footer">
        <a className="brand" href="#top" aria-label="Saturn home">
          <img src="/planets/saturn-app-icon-128.png" alt="" />
          <span>Saturn</span>
        </a>
        <nav aria-label="Footer navigation">
          <a href={storeUrl} target="_blank" rel="noreferrer">Chrome Web Store</a>
          <a href={internalLinks.privacy}>Privacy</a>
          <a href={internalLinks.changelog}>Changelog</a>
          <a href={feedbackUrl} target="_blank" rel="noreferrer">Feedback</a>
        </nav>
      </footer>
    </main>
  );
}
