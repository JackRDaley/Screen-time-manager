const revealItems = document.querySelectorAll(".reveal");
const dailyHoursInput = document.querySelector("#daily-hours");
const calculatorHours = document.querySelector("[data-calculator-hours]");
const calculatorWeekly = document.querySelector("[data-calculator-weekly]");
const calculatorDays = document.querySelector("[data-calculator-days]");

function updateCalculator() {
  if (!dailyHoursInput || !calculatorHours || !calculatorWeekly || !calculatorDays) {
    return;
  }

  const hoursPerDay = Number(dailyHoursInput.value);
  const weeklySaved = hoursPerDay * 7 * 0.25;
  const yearlyDays = Math.round((weeklySaved * 52) / 24);

  calculatorHours.textContent = String(hoursPerDay);
  calculatorWeekly.textContent = weeklySaved.toFixed(1);
  calculatorDays.textContent = String(yearlyDays);
}

dailyHoursInput?.addEventListener("input", updateCalculator);
updateCalculator();

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
