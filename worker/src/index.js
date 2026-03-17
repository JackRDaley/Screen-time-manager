function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...extraHeaders
    }
  });
}

function normalizeWhopResult(raw) {
  const active = Boolean(
    raw?.active ??
      raw?.isActive ??
      raw?.valid ??
      raw?.entitlement?.active ??
      raw?.membership?.active
  );

  const planName =
    raw?.planName ??
    raw?.plan?.name ??
    raw?.membership?.planName ??
    raw?.tier ??
    (active ? "Premium" : "Free");

  const expiresAt =
    raw?.expiresAt ??
    raw?.expiry ??
    raw?.membership?.expiresAt ??
    raw?.entitlement?.expiresAt ??
    null;

  return {
    active,
    planName: String(planName),
    expiresAt: typeof expiresAt === "string" ? expiresAt : null
  };
}

async function verifyWithWhopOrFallback(token, env) {
  if (env.DEV_PREMIUM_TOKEN && token === env.DEV_PREMIUM_TOKEN) {
    return {
      active: true,
      planName: "Dev Premium",
      expiresAt: null
    };
  }

  if (!env.WHOP_API_KEY || !env.WHOP_VERIFY_URL) {
    return {
      active: false,
      planName: "Free",
      expiresAt: null
    };
  }

  const response = await fetch(env.WHOP_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHOP_API_KEY}`
    },
    body: JSON.stringify({ token })
  });

  if (!response.ok) {
    throw new Error(`Whop verify failed (${response.status})`);
  }

  const payload = await response.json();
  return normalizeWhopResult(payload);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return json({ ok: true }, 204);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "whop-verify-worker", now: new Date().toISOString() });
    }

    if (request.method === "POST" && url.pathname === "/whop/verify") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }

      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (!token) {
        return json({ error: "Missing token" }, 400);
      }

      try {
        const entitlement = await verifyWithWhopOrFallback(token, env);
        return json({
          active: entitlement.active,
          planName: entitlement.planName,
          expiresAt: entitlement.expiresAt
        });
      } catch (error) {
        return json(
          {
            error: "Verification failed",
            message: error instanceof Error ? error.message : "Unknown error"
          },
          502
        );
      }
    }

    return json({ error: "Not found" }, 404);
  }
};
