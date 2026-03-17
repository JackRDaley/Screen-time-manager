import "dotenv/config";
import cors from "cors";
import express from "express";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

const verifyBodySchema = z.object({
  token: z.string().min(1),
  extension: z.string().optional()
});

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

async function verifyWithWhop(token) {
  const devPremiumToken = process.env.DEV_PREMIUM_TOKEN;
  if (devPremiumToken && token === devPremiumToken) {
    return {
      active: true,
      planName: "Dev Premium",
      expiresAt: null
    };
  }

  const whopApiKey = process.env.WHOP_API_KEY;
  const whopVerifyUrl = process.env.WHOP_VERIFY_URL;

  if (!whopApiKey || !whopVerifyUrl) {
    return {
      active: false,
      planName: "Free",
      expiresAt: null
    };
  }

  const response = await fetch(whopVerifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${whopApiKey}`
    },
    body: JSON.stringify({ token })
  });

  if (!response.ok) {
    throw new Error(`Whop verify failed with status ${response.status}`);
  }

  const data = await response.json();
  return normalizeWhopResult(data);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "whop-verify", now: new Date().toISOString() });
});

app.post("/whop/verify", async (req, res) => {
  const parsed = verifyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
  }

  try {
    const entitlement = await verifyWithWhop(parsed.data.token);
    return res.json({
      active: entitlement.active,
      planName: entitlement.planName,
      expiresAt: entitlement.expiresAt
    });
  } catch (error) {
    return res.status(502).json({
      error: "Verification failed",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.listen(port, () => {
  console.log(`Whop verify backend listening on http://localhost:${port}`);
});
