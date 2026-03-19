const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value) {
    return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importHmacKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

function unixNow() {
    return Math.floor(Date.now() / 1000);
}

function getTokenTtlSeconds(env) {
    const days = Number(env.TOKEN_TTL_DAYS || 7);
    if (!Number.isFinite(days) || days <= 0) {
        return 7 * 24 * 60 * 60;
    }
    return Math.floor(days * 24 * 60 * 60);
}

async function signJwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = stringToBase64Url(JSON.stringify(header));
    const encodedPayload = stringToBase64Url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const key = await importHmacKey(secret);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(unsignedToken));
    return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyJwt(token, secret) {
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid token format");
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const key = await importHmacKey(secret);
    const isValid = await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlToBytes(encodedSignature),
        encoder.encode(unsignedToken)
    );

    if (!isValid) {
        throw new Error("Invalid token signature");
    }

    const payload = JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload)));
    if (payload?.exp && unixNow() >= Number(payload.exp)) {
        throw new Error("Token expired");
    }

    return payload;
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

    const subject =
        raw?.userId ??
        raw?.user?.id ??
        raw?.membership?.userId ??
        raw?.customerId ??
        "whop-user";

    return {
        active,
        planName: String(planName),
        expiresAt: typeof expiresAt === "string" ? expiresAt : null,
        subject: String(subject)
    };
}

async function verifyWithWhopOrFallback(token, env) {
    if (env.DEV_PREMIUM_TOKEN && token === env.DEV_PREMIUM_TOKEN) {
        return {
            active: true,
            planName: "Dev Premium",
            expiresAt: null,
            subject: "dev-user"
        };
    }

    if (!env.WHOP_API_KEY || !env.WHOP_VERIFY_URL) {
        return {
            active: false,
            planName: "Free",
            expiresAt: null,
            subject: "unknown-user"
        };
    }

    const verifyUrl = String(env.WHOP_VERIFY_URL || "").trim();
    const inMembershipsMode = verifyUrl.includes("/memberships");

    if (inMembershipsMode) {
        const companyId = String(env.WHOP_COMPANY_ID || "").trim();
        if (!companyId) {
            throw new Error("WHOP_COMPANY_ID is required when WHOP_VERIFY_URL points to memberships endpoint");
        }

        const statusesRaw = String(env.WHOP_ACTIVE_STATUSES || "active,trialing");
        const statuses = statusesRaw
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);

        const authHeaders = {
            Authorization: `Bearer ${env.WHOP_API_KEY}`
        };

        const normalizeMembershipEntitlement = (membership) => {
            const status = String(membership?.status || "").toLowerCase();
            const active = statuses.length === 0 ? status === "active" || status === "trialing" : statuses.includes(status);
            const planName =
                membership?.product?.title ||
                membership?.plan?.id ||
                membership?.company?.title ||
                "Premium";

            return {
                active,
                planName: String(planName),
                expiresAt: membership?.renewal_period_end || null,
                subject: String(membership?.user?.id || token)
            };
        };

        if (token.startsWith("mem_")) {
            const membershipUrl = `${verifyUrl.replace(/\/$/, "")}/${encodeURIComponent(token)}`;
            const membershipResponse = await fetch(membershipUrl, {
                method: "GET",
                headers: authHeaders
            });

            if (!membershipResponse.ok) {
                throw new Error(`Whop membership lookup failed (${membershipResponse.status})`);
            }

            const membershipPayload = await membershipResponse.json();
            const membership = membershipPayload?.data || membershipPayload;

            const membershipCompanyId = membership?.company?.id;
            if (membershipCompanyId && membershipCompanyId !== companyId) {
                return {
                    active: false,
                    planName: "Free",
                    expiresAt: null,
                    subject: String(membership?.user?.id || token)
                };
            }

            return normalizeMembershipEntitlement(membership);
        }

        if (token.startsWith("user_")) {
            const listUrl = new URL(verifyUrl);
            listUrl.searchParams.set("company_id", companyId);
            listUrl.searchParams.set("first", "10");
            statuses.forEach((status) => {
                listUrl.searchParams.append("statuses", status);
            });
            listUrl.searchParams.append("user_ids", token);

            const listResponse = await fetch(listUrl.toString(), {
                method: "GET",
                headers: authHeaders
            });

            if (!listResponse.ok) {
                throw new Error(`Whop memberships list failed (${listResponse.status})`);
            }

            const listPayload = await listResponse.json();
            const memberships = Array.isArray(listPayload?.data) ? listPayload.data : [];

            if (memberships.length === 0) {
                return {
                    active: false,
                    planName: "Free",
                    expiresAt: null,
                    subject: token
                };
            }

            const byUserMatch = memberships.find((membership) => membership?.user?.id === token);
            return normalizeMembershipEntitlement(byUserMatch || memberships[0]);
        }

        return {
            active: false,
            planName: "Free",
            expiresAt: null,
            subject: "unknown-user"
        };
    }

    const response = await fetch(verifyUrl, {
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

function buildSignedTokenPayload(entitlement, env) {
    const issuedAt = unixNow();
    const expiresAt = issuedAt + getTokenTtlSeconds(env);
    return {
        sub: entitlement.subject,
        plan: entitlement.planName,
        source: "whop",
        iat: issuedAt,
        exp: expiresAt
    };
}

async function issueSignedToken(rawToken, env) {
    if (!env.JWT_SECRET) {
        throw new Error("JWT secret is not configured");
    }

    const entitlement = await verifyWithWhopOrFallback(rawToken, env);
    if (!entitlement.active) {
        return { active: false, planName: entitlement.planName, expiresAt: entitlement.expiresAt, token: null };
    }

    const payload = buildSignedTokenPayload(entitlement, env);
    const signedToken = await signJwt(payload, env.JWT_SECRET);
    return {
        active: true,
        planName: entitlement.planName,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        token: signedToken
    };
}

async function verifyExtensionToken(token, env) {
    if (!env.JWT_SECRET) {
        throw new Error("JWT secret is not configured");
    }

    const payload = await verifyJwt(token, env.JWT_SECRET);
    return {
        active: true,
        planName: typeof payload?.plan === "string" ? payload.plan : "Premium",
        expiresAt: payload?.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null,
        subject: typeof payload?.sub === "string" ? payload.sub : "whop-user"
    };
}

async function parseJsonBody(request) {
    try {
        return await request.json();
    } catch {
        throw new Error("Invalid JSON body");
    }
}

function parseWebhookSecret(secret) {
    const normalized = String(secret || "").trim();
    if (normalized.startsWith("whsec_")) {
        const encoded = normalized.slice("whsec_".length);
        const binary = atob(encoded);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
    return encoder.encode(normalized);
}

function constantTimeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let index = 0; index < a.length; index += 1) {
        result |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return result === 0;
}

function renderCheckoutCallbackPage({ token, extensionId }) {
        const serializedToken = JSON.stringify(token);
        const serializedExtensionId = JSON.stringify(extensionId);

        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Completing upgrade…</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
        .wrap { max-width: 560px; margin: 8vh auto; padding: 24px; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
        h1 { margin: 0 0 10px; font-size: 20px; }
        p { margin: 0; line-height: 1.5; color: #cbd5e1; }
        .ok { color: #22c55e; }
        .err { color: #f87171; }
        .hint { margin-top: 10px; font-size: 13px; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="card">
            <h1>Finishing your premium activation…</h1>
            <p id="status">Connecting to your extension.</p>
            <p class="hint" id="hint">You can close this tab after activation completes.</p>
        </div>
    </div>
    <script>
        const token = ${serializedToken};
        const extensionId = ${serializedExtensionId};
        const statusEl = document.getElementById("status");
        const hintEl = document.getElementById("hint");

        function setStatus(message, kind) {
            statusEl.textContent = message;
            statusEl.className = kind || "";
        }

        function complete() {
            if (!window.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
                setStatus("Extension bridge unavailable. Open the extension and verify once.", "err");
                return;
            }

            chrome.runtime.sendMessage(
                extensionId,
                { action: "whopCheckoutComplete", token },
                (response) => {
                    if (chrome.runtime.lastError) {
                        setStatus("Could not reach extension. Make sure it is installed/enabled.", "err");
                        return;
                    }

                    if (!response || response.success !== true) {
                        const reason = response && response.error ? String(response.error) : "Unknown error";
                        setStatus("Activation failed: " + reason, "err");
                        return;
                    }

                    setStatus("Premium activated. You can now return to the extension.", "ok");
                    if (hintEl) {
                        hintEl.textContent = response.popupOpened
                            ? "Activation finished. Closing this tab…"
                            : "Activation finished. Return to the extension if it did not open automatically.";
                    }

                    if (response.popupOpened) {
                        setTimeout(() => {
                            window.close();
                        }, 600);
                    }
                }
            );
        }

        complete();
    </script>
</body>
</html>`;
}

function extractWebhookUserId(payload) {
    return (
        payload?.data?.user?.id ||
        payload?.data?.member?.user?.id ||
        payload?.data?.membership?.user?.id ||
        payload?.data?.customer?.id ||
        null
    );
}

function extractWebhookPaymentId(payload) {
    return (
        payload?.data?.payment?.id ||
        payload?.data?.receipt?.id ||
        payload?.data?.invoice?.payment?.id ||
        payload?.data?.id ||
        null
    );
}

async function verifyWhopWebhookSignature(request, rawBody, secret) {
    const secretBytes = parseWebhookSecret(secret);
    const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    // Standard Webhooks format used by Whop
    const webhookId = request.headers.get("webhook-id");
    const webhookTimestamp = request.headers.get("webhook-timestamp");
    const webhookSignatureHeader = request.headers.get("webhook-signature");

    if (webhookId && webhookTimestamp && webhookSignatureHeader) {
        const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
        const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(signedContent));
        const expectedBase64 = bytesToBase64Url(new Uint8Array(signatureBytes))
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil((bytesToBase64Url(new Uint8Array(signatureBytes)).length) / 4) * 4, "=");

        const providedSignatures = webhookSignatureHeader
            .split(" ")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const [version, sig] = entry.split(",");
                return { version, sig };
            })
            .filter((entry) => entry.version === "v1" && typeof entry.sig === "string");

        for (const entry of providedSignatures) {
            if (constantTimeEqual(entry.sig, expectedBase64)) {
                return true;
            }
        }
    }

    // Legacy fallback
    const legacyHeader = request.headers.get("x-whop-signature") || request.headers.get("whop-signature");
    if (!legacyHeader) {
        return false;
    }

    const hex = legacyHeader.startsWith("sha256=")
        ? legacyHeader.slice(7)
        : legacyHeader;

    const legacySignatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const expectedHex = Array.from(new Uint8Array(legacySignatureBytes))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    return constantTimeEqual(hex, expectedHex);
}

// KV key format: "user:<userId>"
async function kvGetPremiumStatus(env, userId) {
    if (!env.PREMIUM_STATUS) return null;
    const raw = await env.PREMIUM_STATUS.get(`user:${userId}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function kvSetPremiumStatus(env, userId, data) {
    if (!env.PREMIUM_STATUS) return;
    await env.PREMIUM_STATUS.put(`user:${userId}`, JSON.stringify(data));
}

async function kvSetPaymentToUser(env, paymentId, userId) {
    if (!env.PREMIUM_STATUS || !paymentId || !userId) return;
    await env.PREMIUM_STATUS.put(`payment:${paymentId}`, userId, {
        expirationTtl: 60 * 60 * 24 * 7
    });
}

async function kvGetPaymentToUser(env, paymentId) {
    if (!env.PREMIUM_STATUS || !paymentId) return null;
    const value = await env.PREMIUM_STATUS.get(`payment:${paymentId}`);
    return value || null;
}

const WEBHOOK_ACTIVATE_EVENTS = new Set([
    "membership.activated",
    "membership_activated",
    "membership.renewed",
    "membership_renewed",
    "payment.succeeded"
]);

const WEBHOOK_DEACTIVATE_EVENTS = new Set([
    "membership.expired",
    "membership_expired",
    "membership.cancelled",
    "membership_cancelled",
    "membership.deactivated",
    "membership_deactivated",
    "payment.failed"
]);

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
        return json({ ok: true }, 204);
        }

        if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "whop-verify-worker", now: new Date().toISOString() });
        }

        if (request.method === "GET" && url.pathname === "/whop/complete") {
        // Accept any token-like param Whop or the extension might send.
        // Prefer user_id / membership_id for direct verification; fall back to
        // payment identifiers and try a membership lookup by company + status.
        const rawToken =
            url.searchParams.get("token") ||
            url.searchParams.get("user_id") ||
            url.searchParams.get("membership_id") ||
            url.searchParams.get("access_token") ||
            url.searchParams.get("receipt") ||
            url.searchParams.get("receipt_id") ||
            url.searchParams.get("payment_id") ||
            "";

        const paymentId =
            url.searchParams.get("payment_id") ||
            url.searchParams.get("receipt_id") ||
            (rawToken.startsWith("pay_") ? rawToken : "");

        const extensionId =
            url.searchParams.get("ext") ||
            String(env.WHOP_EXTENSION_ID || "").trim();

        let token = /\{[^}]+\}/.test(rawToken) ? "" : rawToken;

        if (!token && paymentId) {
            const mappedUserId = await kvGetPaymentToUser(env, paymentId);
            if (mappedUserId) {
                token = mappedUserId;
            }
        }

        if (token.startsWith("pay_")) {
            const mappedUserId = await kvGetPaymentToUser(env, token);
            if (mappedUserId) {
                token = mappedUserId;
            }
        }

        const looksLikePlaceholder = /\{[^}]+\}/.test(token);

        if (!token && paymentId && extensionId) {
            return new Response(
                "Payment detected but membership mapping is not ready yet. Please wait a few seconds and refresh this page.",
                {
                    status: 409,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                }
            );
        }

        if (!token || !extensionId || looksLikePlaceholder) {
            // Provide a helpful diagnostic listing all params actually received
            const received = [...url.searchParams.keys()].join(", ") || "(none)";
            return new Response(
                `Whop checkout callback is missing a usable token or extension id.\n` +
                `Params received: ${received}\n\n` +
                `In your Whop dashboard, set the post-checkout redirect URL to:\n` +
                `https://screen-time-manager.jackster0627.workers.dev/whop/complete?token={user_id}\n\n` +
                `If you see literal {user_id}, Whop did not substitute variables for that field.\n` +
                `Use a real user_id/membership_id token source from Whop checkout return data.`,
                {
                    status: 400,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Cache-Control": "no-store"
                    }
                }
            );
        }

        const page = renderCheckoutCallbackPage({ token, extensionId });
        return new Response(page, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store"
            }
        });
        }

        if (request.method === "POST" && url.pathname === "/whop/webhook") {
        // Read raw body text so we can verify the signature before parsing
        let rawBody;
        try {
            rawBody = await request.text();
        } catch {
            return json({ error: "Could not read body" }, 400);
        }

        // Verify signature when a secret is configured
        if (env.WHOP_WEBHOOK_SECRET) {
            const valid = await verifyWhopWebhookSignature(request, rawBody, env.WHOP_WEBHOOK_SECRET);
            if (!valid) {
                console.log(JSON.stringify({ source: "whop-webhook", error: "invalid-signature" }));
                return json({ error: "Invalid webhook signature" }, 401);
            }
        }

        let payload;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return json({ error: "Invalid JSON body" }, 400);
        }

        const eventType = typeof payload?.type === "string" ? payload.type : null;
        const userId = extractWebhookUserId(payload);
        const paymentId = extractWebhookPaymentId(payload);

        if (userId && paymentId) {
            await kvSetPaymentToUser(env, paymentId, userId);
        }

        // Update KV premium status based on event type
        if (userId) {
            if (WEBHOOK_ACTIVATE_EVENTS.has(eventType)) {
                await kvSetPremiumStatus(env, userId, {
                    active: true,
                    planName: payload?.data?.membership?.product?.title || "Premium",
                    updatedAt: new Date().toISOString(),
                    source: eventType
                });
            } else if (WEBHOOK_DEACTIVATE_EVENTS.has(eventType)) {
                await kvSetPremiumStatus(env, userId, {
                    active: false,
                    planName: "Free",
                    updatedAt: new Date().toISOString(),
                    source: eventType
                });
            }
        }

        // Log only essential info to avoid exposing sensitive data
        console.log(JSON.stringify({
            source: "whop-webhook",
            eventType,
            userId,
            kvUpdated: userId !== null
        }));

        return json({ ok: true, eventType, userId });
        }

        if (request.method === "POST" && url.pathname === "/whop/issue-token") {
        let body;
        try {
            body = await parseJsonBody(request);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Invalid JSON body" }, 400);
        }

        const token = typeof body?.token === "string" ? body.token.trim() : "";
        if (!token) {
            return json({ error: "Missing token" }, 400);
        }

        try {
            const result = await issueSignedToken(token, env);
            if (!result.active) {
            return json({ active: false, planName: result.planName, expiresAt: result.expiresAt, token: null }, 403);
            }

            // Cache the premium status in KV so future /verify calls are fast
            if (env.JWT_SECRET) {
                try {
                    const jwtPayload = await verifyJwt(result.token, env.JWT_SECRET);
                    if (jwtPayload?.sub) {
                        await kvSetPremiumStatus(env, jwtPayload.sub, {
                            active: true,
                            planName: result.planName,
                            updatedAt: new Date().toISOString(),
                            source: "issue-token"
                        });
                    }
                } catch { /* non-critical */ }
            }

            return json({
            active: true,
            planName: result.planName,
            expiresAt: result.expiresAt,
            token: result.token
            });
        } catch (error) {
            return json(
            {
                error: "Token issuance failed",
                message: error instanceof Error ? error.message : "Unknown error"
            },
            502
            );
        }
        }

        if (request.method === "POST" && url.pathname === "/whop/verify") {
        let body;
        try {
            body = await parseJsonBody(request);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Invalid JSON body" }, 400);
        }

        const token = typeof body?.token === "string" ? body.token.trim() : "";
        if (!token) {
            return json({ error: "Missing token" }, 400);
        }

        try {
            if (token.startsWith("user_")) {
                const kvStatus = await kvGetPremiumStatus(env, token);
                if (kvStatus !== null) {
                    return json({
                        active: Boolean(kvStatus.active),
                        planName: kvStatus.active ? String(kvStatus.planName || "Premium") : "Free",
                        expiresAt: null
                    });
                }
            }

            if (env.JWT_SECRET) {
            try {
                const entitlement = await verifyExtensionToken(token, env);

                // Fast path: check KV to see if this user has been revoked via webhook
                if (entitlement.subject) {
                    const kvStatus = await kvGetPremiumStatus(env, entitlement.subject);
                    if (kvStatus !== null && !kvStatus.active) {
                        return json({ active: false, planName: "Free", expiresAt: null });
                    }
                }

                return json({
                active: entitlement.active,
                planName: entitlement.planName,
                expiresAt: entitlement.expiresAt
                });
            } catch {
            }
            }

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
