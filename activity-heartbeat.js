(function initScreenTimeHeartbeat() {
    "use strict";

    const HEARTBEAT_INTERVAL_MS = 1000;
    const MIN_INTERVAL_MS = 900;
    let heartbeatTimer = null;
    let lastSentAt = 0;
    let contextInvalidated = false;

    function canSendHeartbeat() {
        return (
            typeof chrome !== "undefined"
            && chrome.runtime?.sendMessage
            && !contextInvalidated
            && (location.protocol === "http:" || location.protocol === "https:")
            && document.visibilityState === "visible"
            && document.hasFocus()
        );
    }

    function handleSendError(error) {
        const message = String(error?.message || error || "");
        if (/Extension context invalidated/i.test(message)) {
            contextInvalidated = true;
            stopHeartbeat();
        }
    }

    function sendHeartbeat(reason = "interval") {
        if (!canSendHeartbeat()) return;

        const now = Date.now();
        if (reason === "interval" && now - lastSentAt < MIN_INTERVAL_MS) return;
        lastSentAt = now;

        try {
            const result = chrome.runtime.sendMessage({
                action: "activePageHeartbeat",
                reason,
                pageFocused: document.hasFocus(),
                visibilityState: document.visibilityState
            });
            if (result?.catch) result.catch(handleSendError);
        } catch (error) {
            handleSendError(error);
        }
    }

    function stopHeartbeat() {
        if (!heartbeatTimer) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    function startHeartbeat() {
        if (!canSendHeartbeat()) {
            stopHeartbeat();
            return;
        }

        sendHeartbeat("visible");
        if (!heartbeatTimer) {
            heartbeatTimer = setInterval(() => sendHeartbeat("interval"), HEARTBEAT_INTERVAL_MS);
        }
    }

    document.addEventListener("visibilitychange", startHeartbeat);
    window.addEventListener("focus", startHeartbeat);
    window.addEventListener("blur", stopHeartbeat);
    window.addEventListener("pageshow", startHeartbeat);
    window.addEventListener("pagehide", stopHeartbeat);

    startHeartbeat();
})();
