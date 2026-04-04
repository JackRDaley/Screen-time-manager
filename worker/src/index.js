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

        if (token.startsWith("mem_") || token.startsWith("mber_")) {
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

function isPlaceholderValue(value) {
    return /\{[^}]+\}/.test(String(value || ""));
}

function looksLikeBillingToken(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    return /^(user_|mem_|mber_|pay_)/.test(normalized);
}

function isValidChromeExtensionId(value) {
    const normalized = String(value || "").trim();
    return /^[a-p]{32}$/.test(normalized);
}

function isValidClientState(value) {
    const normalized = String(value || "").trim();
    return /^[A-Za-z0-9_-]{16,128}$/.test(normalized);
}

function firstUsableToken(candidates) {
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (!value) continue;
        if (isPlaceholderValue(value)) continue;
        return value;
    }
    return "";
}

function discoverTokenFromSearchParams(searchParams) {
    const directCandidates = [
        searchParams.get("token"),
        searchParams.get("user_id"),
        searchParams.get("membership_id"),
        searchParams.get("member_id"),
        searchParams.get("membership"),
        searchParams.get("access_token"),
        searchParams.get("receipt"),
        searchParams.get("receipt_id"),
        searchParams.get("payment_id")
    ];

    const directMatch = firstUsableToken(directCandidates);
    if (directMatch) {
        return directMatch;
    }

    for (const [, value] of searchParams.entries()) {
        const trimmed = String(value || "").trim();
        if (!trimmed || isPlaceholderValue(trimmed)) {
            continue;
        }
        if (looksLikeBillingToken(trimmed)) {
            return trimmed;
        }
    }

    return "";
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

function sanitizeAnalyticsText(value, fallback, maxLength = 100) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return fallback;
    }

    return normalized.slice(0, maxLength);
}

function sanitizeAnalyticsEventName(value, fallback = "extension_event") {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!normalized || !/^[a-z]/.test(normalized)) {
        return fallback;
    }

    return normalized.slice(0, 40);
}

function sanitizeAnalyticsParams(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const entries = Object.entries(value).slice(0, 25);
    const sanitized = {};

    for (const [rawKey, rawValue] of entries) {
        const key = sanitizeAnalyticsEventName(rawKey, "param");
        if (!key) continue;

        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            sanitized[key] = rawValue;
            continue;
        }

        if (typeof rawValue === "boolean") {
            sanitized[key] = rawValue ? 1 : 0;
            continue;
        }

        sanitized[key] = sanitizeAnalyticsText(rawValue, "", 100);
    }

    return sanitized;
}

function shouldLogAnalytics(env) {
    const value = String(env.ANALYTICS_DEBUG_LOGS || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
}

function logAnalyticsDebug(env, message, payload) {
    if (!shouldLogAnalytics(env)) {
        return;
    }

    try {
        console.log(message, JSON.stringify(payload));
    } catch {
        console.log(message);
    }
}

function buildGa4CollectUrl(env) {
    const measurementId = String(env.GA4_MEASUREMENT_ID || "").trim();
    const apiSecret = String(env.GA4_API_SECRET || "").trim();

    if (!measurementId || !apiSecret) {
        return null;
    }

    const gaUrl = new URL("https://www.google-analytics.com/mp/collect");
    gaUrl.searchParams.set("measurement_id", measurementId);
    gaUrl.searchParams.set("api_secret", apiSecret);
    return gaUrl.toString();
}

async function sendGa4Event(env, { clientId, eventName, params }) {
    const gaUrl = buildGa4CollectUrl(env);
    if (!gaUrl) {
        return { ok: true, skipped: true, reason: "ga-not-configured" };
    }

    const response = await fetch(gaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: clientId,
            events: [{
                name: eventName,
                params
            }]
        })
    });

    if (!response.ok) {
        throw new Error(`GA4 collect failed (${response.status})`);
    }

    return { ok: true, skipped: false };
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

function renderCheckoutCallbackPage({ token, extensionId, hasStateBridge }) {
    const serializedToken = JSON.stringify(token);
    const serializedExtensionId = JSON.stringify(extensionId);
    const serializedHasStateBridge = JSON.stringify(Boolean(hasStateBridge));

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Premium Activation</title>
    <style>
        :root {
            --bg0: #071126;
            --bg1: #0b1730;
            --card: rgba(10, 22, 46, 0.78);
            --border: rgba(148, 163, 184, 0.28);
            --text: #e2e8f0;
            --muted: #94a3b8;
            --ok: #34d399;
            --warn: #f59e0b;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
            color: var(--text);
            background:
                radial-gradient(900px 500px at 20% -10%, rgba(56, 189, 248, 0.16), transparent 65%),
                radial-gradient(700px 400px at 90% 10%, rgba(59, 130, 246, 0.18), transparent 60%),
                linear-gradient(180deg, var(--bg0), var(--bg1));
            display: grid;
            place-items: center;
            padding: 24px;
        }

        .card {
            width: min(640px, 100%);
            border: 1px solid var(--border);
            border-radius: 16px;
            background: var(--card);
            backdrop-filter: blur(8px);
            padding: 20px;
            box-shadow: 0 20px 60px rgba(2, 6, 23, 0.45);
        }

        h1 {
            margin: 0 0 10px;
            font-size: 30px;
            line-height: 1.1;
            font-weight: 800;
            letter-spacing: -0.02em;
        }

        p { margin: 0; }
        .status {
            font-size: 17px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .status.ok { color: var(--ok); }
        .status.warn { color: var(--warn); }
        .hint {
            font-size: 14px;
            color: var(--muted);
            margin-bottom: 14px;
        }

        .panel {
            margin-top: 14px;
            padding: 12px;
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.25);
            background: rgba(15, 23, 42, 0.44);
        }

        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .label {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            margin-bottom: 8px;
            font-weight: 700;
        }

        .tip {
            font-size: 12px;
            color: var(--muted);
            cursor: help;
            text-decoration: underline dotted;
            text-underline-offset: 2px;
            margin-bottom: 8px;
        }

        .token-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .token {
            flex: 1;
            min-width: 0;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.22);
            background: rgba(2, 6, 23, 0.48);
            color: #bfdbfe;
            word-break: break-all;
        }

        .btn {
            border: 0;
            border-radius: 10px;
            padding: 10px 12px;
            font-weight: 700;
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            color: white;
            cursor: pointer;
            white-space: nowrap;
        }

        .steps {
            margin-top: 10px;
            display: grid;
            gap: 6px;
            font-size: 14px;
            color: #cbd5e1;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>Premium Activation</h1>
        <p id="status" class="status">Finalizing your upgrade...</p>
        <p id="hint" class="hint">This tab can be closed after completion.</p>

        <div class="panel" id="tokenPanel">
            <div class="panel-header">
                <div class="label">Activation Token</div>
            </div>
            <div class="token-row">
                <div id="tokenValue" class="token"></div>
                <button id="copyTokenBtn" class="btn" type="button">Copy</button>
            </div>
            <div class="steps">
                <div>1. Open the extension popup.</div>
                <div>2. Go to Whop Billing inside settings.</div>
                <div>3. Expand the troubleshooting dropdown and paste this token.</div>
            </div>
        </div>
    </div>

    <script>
        const token = ${serializedToken};
        const extensionId = ${serializedExtensionId};
        const hasStateBridge = ${serializedHasStateBridge};

        const statusEl = document.getElementById("status");
        const hintEl = document.getElementById("hint");
        const tokenPanelEl = document.getElementById("tokenPanel");
        const tokenValueEl = document.getElementById("tokenValue");
        const copyTokenBtnEl = document.getElementById("copyTokenBtn");

        function setStatus(message, kind) {
            statusEl.textContent = message;
            statusEl.classList.remove("ok", "warn");
            if (kind) statusEl.classList.add(kind);
        }

        function showTokenFallback() {
            if (!tokenPanelEl || !tokenValueEl) return;
            tokenValueEl.textContent = token || "(missing token)";
        }

        copyTokenBtnEl?.addEventListener("click", async () => {
            if (!token) return;
            try {
                await navigator.clipboard.writeText(token);
                copyTokenBtnEl.textContent = "Copied";
                setTimeout(() => {
                    copyTokenBtnEl.textContent = "Copy";
                }, 1200);
            } catch {
                copyTokenBtnEl.textContent = "Copy failed";
                setTimeout(() => {
                    copyTokenBtnEl.textContent = "Copy";
                }, 1200);
            }
        });

        function complete() {
            showTokenFallback();

            if (!token) {
                setStatus("Missing callback data. Please retry checkout.", "warn");
                hintEl.textContent = "The activation token was not present in this callback.";
                return;
            }

            if (hasStateBridge) {
                setStatus("Activation signal saved. Return to extension and sync premium status.", "ok");
                return;
            }

            if (!extensionId || !window.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
                setStatus("Automatic handoff unavailable. Use manual token link below.", "warn");
                hintEl.textContent = "This is expected on some browsers/profiles.";
                return;
            }

            chrome.runtime.sendMessage(
                extensionId,
                { action: "whopCheckoutComplete", token },
                (response) => {
                    if (chrome.runtime.lastError) {
                        setStatus("Could not reach extension automatically. Use manual token link below.", "warn");
                        hintEl.textContent = "Open the extension and link the token once.";
                        return;
                    }

                    if (!response || response.success !== true) {
                        const reason = response && response.error ? String(response.error) : "Unknown error";
                        setStatus("Activation did not finish automatically. Use manual token link below.", "warn");
                        hintEl.textContent = "Reason: " + reason;
                        return;
                    }

                    setStatus("Premium activated. You can return to the extension.", "ok");
                    hintEl.textContent = "Activation completed successfully.";
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

async function kvSetClientStateToken(env, clientState, token) {
    if (!env.PREMIUM_STATUS || !clientState || !token) return;
    await env.PREMIUM_STATUS.put(`client-state:${clientState}`, JSON.stringify({ token }), {
        expirationTtl: 60 * 60 * 24
    });
}

async function kvTakeClientStateToken(env, clientState) {
    if (!env.PREMIUM_STATUS || !clientState) return null;
    const key = `client-state:${clientState}`;
    const raw = await env.PREMIUM_STATUS.get(key);
    if (!raw) return null;

    await env.PREMIUM_STATUS.delete(key);
    try {
        const parsed = JSON.parse(raw);
        const token = String(parsed?.token || "").trim();
        return token || null;
    } catch {
        return null;
    }
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

        if (request.method === "POST" && url.pathname === "/analytics/block-event") {
        let body;
        try {
            body = await parseJsonBody(request);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Invalid JSON body" }, 400);
        }

        const clientId = sanitizeAnalyticsText(body?.clientId, "", 128);
        if (!clientId) {
            return json({ error: "Missing clientId" }, 400);
        }

        const blockEventPayload = {
            eventName: "blocked_page_view",
            clientId,
            params: {
                block_source: sanitizeAnalyticsText(body?.source, "unknown", 40),
                extension_version: sanitizeAnalyticsText(body?.extensionVersion, "unknown", 32),
                redirect_event_id: sanitizeAnalyticsText(body?.eventId, "missing", 64)
            }
        };
        logAnalyticsDebug(env, "[analytics/block-event] forwarding", blockEventPayload);

        const result = await sendGa4Event(env, {
            clientId,
            eventName: "blocked_page_view",
            params: {
                engagement_time_msec: 1,
                ...blockEventPayload.params
            }
        }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }));

        if (!result.ok) {
            return json({ error: "Analytics forwarding failed", message: result.error }, 502);
        }

        return json({ ok: true, skipped: Boolean(result.skipped), reason: result.reason || null });
        }

        if (request.method === "POST" && url.pathname === "/analytics/event") {
        let body;
        try {
            body = await parseJsonBody(request);
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Invalid JSON body" }, 400);
        }

        const clientId = sanitizeAnalyticsText(body?.clientId, "", 128);
        if (!clientId) {
            return json({ error: "Missing clientId" }, 400);
        }

        const eventName = sanitizeAnalyticsEventName(body?.eventName, "extension_event");
        const params = {
            engagement_time_msec: 1,
            extension_version: sanitizeAnalyticsText(body?.extensionVersion, "unknown", 32),
            ...sanitizeAnalyticsParams(body?.params)
        };
        logAnalyticsDebug(env, "[analytics/event] forwarding", {
            eventName,
            clientId,
            params
        });

        const result = await sendGa4Event(env, {
            clientId,
            eventName,
            params
        }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }));

        if (!result.ok) {
            return json({ error: "Analytics forwarding failed", message: result.error }, 502);
        }

        return json({ ok: true, skipped: Boolean(result.skipped), reason: result.reason || null, eventName });
        }

        if (request.method === "GET" && url.pathname === "/whop/complete") {
        // Accept any token-like param Whop or the extension might send.
        // Prefer user_id / membership_id for direct verification; fall back to
        // payment identifiers and try a membership lookup by company + status.
        const rawToken = discoverTokenFromSearchParams(url.searchParams);

        const paymentId =
            url.searchParams.get("payment_id") ||
            url.searchParams.get("receipt_id") ||
            (rawToken.startsWith("pay_") ? rawToken : "");

        const extFromQuery = String(url.searchParams.get("ext") || "").trim();
        const extFromEnv = String(env.WHOP_EXTENSION_ID || "").trim();
        const extensionId = isValidChromeExtensionId(extFromQuery)
            ? extFromQuery
            : (isValidChromeExtensionId(extFromEnv) ? extFromEnv : "");
        const rawClientState = String(url.searchParams.get("client_state") || "").trim();
        const clientState = isValidClientState(rawClientState) ? rawClientState : "";

        let token = rawToken;

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

        const looksLikePlaceholder = isPlaceholderValue(token);

        if (token && !looksLikePlaceholder && clientState) {
            await kvSetClientStateToken(env, clientState, token);
        }

        if (!token && paymentId && (extensionId || clientState)) {
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

        if (!token || (!extensionId && !clientState) || looksLikePlaceholder) {
            // Provide a helpful diagnostic listing all params actually received
            const received = [...url.searchParams.keys()].join(", ") || "(none)";
            return new Response(
            `Whop checkout callback is missing a usable token plus extension id/client state.\n` +
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

        const page = renderCheckoutCallbackPage({ token, extensionId, hasStateBridge: Boolean(clientState) });
        return new Response(page, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store"
            }
        });
        }

        if (request.method === "GET" && url.pathname === "/whop/link-state") {
        const rawClientState = String(url.searchParams.get("client_state") || "").trim();
        if (!isValidClientState(rawClientState)) {
            return json({ error: "Invalid client_state" }, 400);
        }

        const token = await kvTakeClientStateToken(env, rawClientState);
        if (!token) {
            return json({ error: "Not found" }, 404);
        }

        return json({ token });
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