const FIVE_SECONDS = 5000;

function notifId(domain, pct) {
  return `stmalert:${domain}:${pct}`;
}

function shouldEnforce(domain, recentlyReset = {}, now = Date.now()) {
  const ts = Number(recentlyReset?.[domain] || 0);
  if (Number.isFinite(ts) && ts > 0 && now - ts < FIVE_SECONDS) return false;
  return true;
}

describe('Simulated limit/notification behaviours', () => {
  test('deterministic notification ids', () => {
    const a = notifId('example.com', 90);
    const b = notifId('example.com', 90);
    const c = notifId('example.com', 75);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('recentlyReset grace prevents immediate enforcement', () => {
    const domain = 'example.com';
    const now = Date.now();
    const recentlyReset = { [domain]: now - 3000 }; // 3s ago
    expect(shouldEnforce(domain, recentlyReset, now)).toBe(false);

    const oldReset = { [domain]: now - 6000 }; // 6s ago
    expect(shouldEnforce(domain, oldReset, now)).toBe(true);
  });
});
