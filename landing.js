const presets = {
  study: {
    label: "Study Mode",
    status: "Moderate",
    title: "Ready for a study session",
    description: "Adds focused limits for the distracting sites students reopen during homework.",
    sites: ["YouTube", "Reddit", "TikTok", "Instagram"],
    rule: "Daily limits",
    window: "After class and evenings"
  },
  deep: {
    label: "Deep Work Mode",
    status: "Strict",
    title: "A cleaner 90-minute work block",
    description: "Blocks entertainment, social, news, sports, and video sites during serious focus time.",
    sites: ["YouTube", "Reddit", "News", "Sports"],
    rule: "Session block",
    window: "60 to 120 minutes"
  },
  sleep: {
    label: "Sleep Mode",
    status: "Scheduled",
    title: "Late-night scrolling gets a hard stop",
    description: "Turns evening time-sinks into blocked attempts before they push bedtime back.",
    sites: ["Netflix", "TikTok", "Instagram", "Reddit"],
    rule: "Scheduled block",
    window: "10 PM to 6 AM"
  }
};

const presetCards = document.querySelectorAll("[data-preset]");
const presetLabel = document.querySelector("#preset-label");
const presetStatus = document.querySelector("#preset-status");
const presetTitle = document.querySelector("#preset-title");
const presetDescription = document.querySelector("#preset-description");
const presetSites = document.querySelector("#preset-sites");
const presetRule = document.querySelector("#preset-rule");
const presetWindow = document.querySelector("#preset-window");
const presetPreview = document.querySelector(".preset-preview");

function renderPreset(presetKey) {
  const preset = presets[presetKey];
  if (!preset) {
    return;
  }

  presetPreview.classList.remove("is-switching");
  void presetPreview.offsetWidth;
  presetPreview.classList.add("is-switching");

  presetLabel.textContent = preset.label;
  presetStatus.textContent = preset.status;
  presetTitle.textContent = preset.title;
  presetDescription.textContent = preset.description;
  presetRule.textContent = preset.rule;
  presetWindow.textContent = preset.window;
  presetSites.replaceChildren(
    ...preset.sites.map((site) => {
      const chip = document.createElement("span");
      chip.textContent = site;
      return chip;
    })
  );

  presetCards.forEach((card) => {
    const isSelected = card.dataset.preset === presetKey;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-pressed", String(isSelected));
  });
}

presetCards.forEach((card) => {
  card.addEventListener("click", () => renderPreset(card.dataset.preset));
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
const counters = Array.from(document.querySelectorAll("[data-count]"));

document.documentElement.classList.add("effects-ready");

revealItems.forEach((item, index) => {
  item.style.setProperty("--reveal-delay", `${(index % 4) * 70}ms`);
});

function formatCounter(value, format) {
  if (format !== "time") {
    return String(value);
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function animateCounter(counter) {
  if (counter.dataset.animated === "true") {
    return;
  }

  counter.dataset.animated = "true";
  const target = Number(counter.dataset.count || 0);
  const format = counter.dataset.format;
  const card = counter.closest(".metric-card");

  if (reducedMotion) {
    counter.textContent = formatCounter(target, format);
    return;
  }

  const duration = 940;
  const start = performance.now();
  card?.classList.add("is-counting");

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    counter.textContent = formatCounter(Math.round(target * eased), format);

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      card?.classList.remove("is-counting");
    }
  }

  requestAnimationFrame(tick);
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        entry.target.querySelectorAll?.("[data-count]").forEach(animateCounter);

        if (entry.target.matches("[data-count]")) {
          animateCounter(entry.target);
        }

        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
  );

  revealItems.forEach((item) => observer.observe(item));
  counters.forEach((counter) => observer.observe(counter));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
  counters.forEach(animateCounter);
}
