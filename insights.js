(function attachInsightEngine(global) {
    "use strict";

    const MINUTE_MS = 60 * 1000;
    const DAY_MS = 24 * 60 * MINUTE_MS;

    const DEFAULT_INSIGHT_SETTINGS = Object.freeze({
        personalInsightsEnabled: true,
        insightNotificationsEnabled: true,
        insightMaxNotificationsPerDay: 1,
        insightSensitivity: "normal"
    });

    const SENSITIVITY_THRESHOLDS = Object.freeze({
        low: Object.freeze({
            longSessionMs: 45 * MINUTE_MS,
            longSessionNotifyMs: 45 * MINUTE_MS,
            recurringDays: 4,
            recurringMinMs: 10 * MINUTE_MS,
            highVisitCount: 12,
            highVisitNotifyCount: 16,
            usageIncreaseRatio: 2.5,
            usageIncreaseMinMs: 45 * MINUTE_MS,
            usageIncreaseMinDeltaMs: 25 * MINUTE_MS,
            usageIncreaseAvgMinMs: 10 * MINUTE_MS,
            usageIncreaseMinHistoryDays: 3,
            limitSuggestionDays: 5,
            limitSuggestionTotalMs: 120 * MINUTE_MS,
            limitSuggestionVisits: 28,
            limitSuggestionNotifyTotalMs: 180 * MINUTE_MS,
            activeSessionStaleMs: 10 * MINUTE_MS
        }),
        normal: Object.freeze({
            longSessionMs: 30 * MINUTE_MS,
            longSessionNotifyMs: 35 * MINUTE_MS,
            recurringDays: 3,
            recurringMinMs: 5 * MINUTE_MS,
            highVisitCount: 8,
            highVisitNotifyCount: 12,
            usageIncreaseRatio: 1.75,
            usageIncreaseMinMs: 30 * MINUTE_MS,
            usageIncreaseMinDeltaMs: 15 * MINUTE_MS,
            usageIncreaseAvgMinMs: 5 * MINUTE_MS,
            usageIncreaseMinHistoryDays: 3,
            limitSuggestionDays: 3,
            limitSuggestionTotalMs: 60 * MINUTE_MS,
            limitSuggestionVisits: 15,
            limitSuggestionNotifyTotalMs: 100 * MINUTE_MS,
            activeSessionStaleMs: 10 * MINUTE_MS
        }),
        high: Object.freeze({
            longSessionMs: 20 * MINUTE_MS,
            longSessionNotifyMs: 30 * MINUTE_MS,
            recurringDays: 3,
            recurringMinMs: 2 * MINUTE_MS,
            highVisitCount: 5,
            highVisitNotifyCount: 9,
            usageIncreaseRatio: 1.4,
            usageIncreaseMinMs: 15 * MINUTE_MS,
            usageIncreaseMinDeltaMs: 8 * MINUTE_MS,
            usageIncreaseAvgMinMs: 3 * MINUTE_MS,
            usageIncreaseMinHistoryDays: 2,
            limitSuggestionDays: 2,
            limitSuggestionTotalMs: 30 * MINUTE_MS,
            limitSuggestionVisits: 8,
            limitSuggestionNotifyTotalMs: 75 * MINUTE_MS,
            activeSessionStaleMs: 10 * MINUTE_MS
        })
    });

    function normalizeDomain(input) {
        const raw = String(input || "").trim().toLowerCase();
        if (!raw) return "";

        try {
            const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
            return new URL(withProtocol).hostname.replace(/^www\./, "");
        } catch {
            return raw.replace(/^www\./, "").split("/")[0];
        }
    }

    function isValidDomain(domain) {
        const value = normalizeDomain(domain);
        if (!value || value.length > 255 || value.includes("..")) return false;
        if (!/^[a-z0-9.-]+$/.test(value)) return false;
        return value.split(".").every((part) => part && !part.startsWith("-") && !part.endsWith("-"));
    }

    function getDayKey(date = new Date()) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function dayKeyOffset(now, offset) {
        const date = new Date(now);
        date.setDate(date.getDate() - offset);
        return getDayKey(date);
    }

    function normalizeSensitivity(value) {
        const normalized = String(value || DEFAULT_INSIGHT_SETTINGS.insightSensitivity).toLowerCase();
        return Object.prototype.hasOwnProperty.call(SENSITIVITY_THRESHOLDS, normalized)
            ? normalized
            : DEFAULT_INSIGHT_SETTINGS.insightSensitivity;
    }

    function getInsightSettings(raw = {}) {
        const sensitivity = normalizeSensitivity(raw.insightSensitivity);
        const maxNotifications = Number(raw.insightMaxNotificationsPerDay);

        return {
            personalInsightsEnabled: raw.personalInsightsEnabled !== false,
            insightNotificationsEnabled: raw.insightNotificationsEnabled !== false,
            insightMaxNotificationsPerDay: Number.isFinite(maxNotifications)
                ? Math.max(0, Math.min(5, Math.round(maxNotifications)))
                : DEFAULT_INSIGHT_SETTINGS.insightMaxNotificationsPerDay,
            insightSensitivity: sensitivity
        };
    }

    function thresholdsFor(settings = {}) {
        return SENSITIVITY_THRESHOLDS[getInsightSettings(settings).insightSensitivity] || SENSITIVITY_THRESHOLDS.normal;
    }

    function entryTimeMs(entry = {}) {
        if (Number.isFinite(entry.timeMs)) return Math.max(0, Number(entry.timeMs));
        if (Number.isFinite(entry.timeSec)) return Math.max(0, Number(entry.timeSec) * 1000);
        return 0;
    }

    function entryVisits(entry = {}) {
        return Math.max(0, Number(entry.visits || 0));
    }

    function mergeDomainStats(target, rawDomain, entry = {}) {
        const domain = normalizeDomain(rawDomain);
        if (!isValidDomain(domain)) return target;

        target[domain] ||= { timeMs: 0, visits: 0 };
        target[domain].timeMs += entryTimeMs(entry);
        target[domain].visits += entryVisits(entry);
        return target;
    }

    function normalizeStats(stats = {}) {
        return Object.entries(stats || {}).reduce((result, [domain, entry]) => (
            mergeDomainStats(result, domain, entry)
        ), {});
    }

    function statsForOffset(input = {}, now = Date.now(), offset = 0) {
        if (offset === 0) return normalizeStats(input.allStatsToday || input.statsToday || {});
        const day = dayKeyOffset(now, offset);
        return normalizeStats((input.statsHistory || {})[day] || {});
    }

    function normalizedBlockedDomains(blockedDomains = {}) {
        return new Set(
            Object.keys(blockedDomains || {})
                .map(normalizeDomain)
                .filter(isValidDomain)
        );
    }

    function formatMinutes(ms) {
        const minutes = Math.max(1, Math.round(Number(ms || 0) / MINUTE_MS));
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    function formatIncreasePercent(value) {
        const ratio = Math.max(0, Number(value || 0));
        return `${Math.max(0, Math.round((ratio - 1) * 100))}%`;
    }

    function daypartForHour(hour) {
        const value = ((Number(hour) % 24) + 24) % 24;
        if (value >= 5 && value < 12) return "morning";
        if (value >= 12 && value < 17) return "afternoon";
        if (value >= 17 && value < 22) return "evening";
        return "late night";
    }

    function titleCase(value) {
        return String(value || "")
            .split(/[\s.-]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function domainLabel(domain) {
        const normalized = normalizeDomain(domain);
        const labels = {
            "youtube.com": "YouTube",
            "youtu.be": "YouTube",
            "reddit.com": "Reddit",
            "tiktok.com": "TikTok",
            "linkedin.com": "LinkedIn",
            "instagram.com": "Instagram",
            "facebook.com": "Facebook",
            "twitter.com": "Twitter",
            "x.com": "X",
            "netflix.com": "Netflix",
            "twitch.tv": "Twitch",
            "discord.com": "Discord",
            "gmail.com": "Gmail"
        };

        if (labels[normalized]) return labels[normalized];

        const parts = normalized.split(".").filter(Boolean);
        if (!parts.length) return normalized;

        const last = parts[parts.length - 1] || "";
        const secondLast = parts[parts.length - 2] || "";
        const rootIndex = parts.length > 2 && last.length === 2 && secondLast.length <= 3
            ? parts.length - 3
            : Math.max(0, parts.length - 2);
        return titleCase(parts[rootIndex] || parts[0]);
    }

    function pluralize(value, singular, plural = `${singular}s`) {
        const count = Number(value || 0);
        return `${count} ${count === 1 ? singular : plural}`;
    }

    function daypartPlural(value) {
        const daypart = String(value || "").toLowerCase();
        if (daypart.includes("late")) return "late nights";
        if (daypart.includes("morning")) return "mornings";
        if (daypart.includes("afternoon")) return "afternoons";
        if (daypart.includes("evening")) return "evenings";
        return "";
    }

    function daypartAdjective(value) {
        const daypart = String(value || "").toLowerCase();
        if (daypart.includes("late")) return "Late-night";
        if (daypart.includes("morning")) return "Morning";
        if (daypart.includes("afternoon")) return "Afternoon";
        if (daypart.includes("evening")) return "Evening";
        return "";
    }

    function compactHourLabel(hour) {
        const value = ((Number(hour) % 24) + 24) % 24;
        if (value === 0) return "12am";
        if (value === 12) return "12pm";
        return value < 12 ? `${value}am` : `${value - 12}pm`;
    }

    function afterHourText(hour) {
        const value = ((Number(hour) % 24) + 24) % 24;
        if (value === 0) return "after midnight";
        if (value === 12) return "after noon";
        return `after ${compactHourLabel(value)}`;
    }

    function insightWindowPhrase(daypart, hour) {
        const value = String(daypart || "").toLowerCase();
        const hasHour = Number.isFinite(Number(hour));
        if (value.includes("morning")) return "before noon";
        if (value.includes("afternoon")) return "in the afternoon";
        if (value.includes("evening")) return hasHour ? afterHourText(hour) : "in the evening";
        if (value.includes("late")) return hasHour ? afterHourText(hour) : "late at night";
        return hasHour ? `around ${compactHourLabel(hour)}` : "";
    }

    function dayCountText(activeDays, windowDays = 7) {
        const active = Number(activeDays || 0);
        const window = Number(windowDays || 0);
        if (active <= 0) return "";
        if (window > 0) {
            return active >= window
                ? `each of the last ${window} days`
                : `${active} of the last ${window} days`;
        }
        return pluralize(active, "day");
    }

    function makeInsight(type, domain, title, message, options = {}) {
        const normalized = normalizeDomain(domain);
        const dateKey = options.dateKey || getDayKey(new Date(options.now || Date.now()));
        const contextKey = String(options.contextKey || dateKey).replace(/\s+/g, "-");

        return {
            id: `${type}:${normalized}:${contextKey}`,
            type,
            domain: normalized,
            title,
            message,
            action: options.action || "viewUsage",
            priority: Number(options.priority || 0),
            notify: Boolean(options.notify),
            timestamp: Number(options.now || Date.now()),
            dateKey,
            context: options.context || {}
        };
    }

    function domainUsageInHour(hourlyUsageHistory = {}, dayKey, hour) {
        const hourKey = String(hour).padStart(2, "0");
        const bucket = hourlyUsageHistory?.[dayKey]?.[hourKey] || {};
        const usage = {};

        Object.entries(bucket.domains || {}).forEach(([rawDomain, ms]) => {
            const domain = normalizeDomain(rawDomain);
            if (!isValidDomain(domain)) return;
            usage[domain] ||= { timeMs: 0, visits: 0 };
            usage[domain].timeMs += Math.max(0, Number(ms || 0));
        });

        Object.entries(bucket.domainVisits || {}).forEach(([rawDomain, visitCount]) => {
            const domain = normalizeDomain(rawDomain);
            if (!isValidDomain(domain)) return;
            usage[domain] ||= { timeMs: 0, visits: 0 };
            usage[domain].visits += Math.max(0, Number(visitCount || 0));
        });

        return usage;
    }

    function domainHourlyPattern(input = {}, domain, now = Date.now(), days = 7) {
        const normalized = normalizeDomain(domain);
        if (!isValidDomain(normalized)) return {};

        const history = input.hourlyUsageHistory || {};
        const hours = Array.from({ length: 24 }, () => ({
            activeDays: 0,
            totalMs: 0,
            visits: 0
        }));

        for (let offset = 0; offset < days; offset += 1) {
            const day = dayKeyOffset(now, offset);
            for (let hour = 0; hour < 24; hour += 1) {
                const entry = domainUsageInHour(history, day, hour)[normalized] || {};
                const timeMs = Math.max(0, Number(entry.timeMs || 0));
                const visitCount = Math.max(0, Number(entry.visits || 0));
                if (timeMs <= 0 && visitCount <= 0) continue;

                hours[hour].activeDays += 1;
                hours[hour].totalMs += timeMs;
                hours[hour].visits += visitCount;
            }
        }

        const best = hours
            .map((entry, hour) => ({ hour, ...entry }))
            .filter((entry) => entry.activeDays > 0)
            .sort((a, b) => (
                b.activeDays - a.activeDays
                || b.totalMs - a.totalMs
                || b.visits - a.visits
            ))[0];

        if (!best) return {};
        return {
            peakHour: best.hour,
            peakDaypart: daypartForHour(best.hour),
            peakActiveDays: best.activeDays,
            peakTotalMs: best.totalMs,
            peakVisits: best.visits
        };
    }

    function addLongSessionInsight(insights, input, settings, now, dateKey) {
        const thresholds = thresholdsFor(settings);
        const session = input.activeSession || {};
        const domain = normalizeDomain(session.domain);
        const startedAt = Number(session.startedAt || session.startedAtMs || 0);
        const lastHeartbeatAt = Number(session.lastHeartbeatAt || 0);

        if (!isValidDomain(domain) || !startedAt || !lastHeartbeatAt) return;
        if (now - lastHeartbeatAt > thresholds.activeSessionStaleMs) return;

        const durationMs = Math.max(0, now - startedAt);
        if (durationMs < thresholds.longSessionMs) return;

        const duration = formatMinutes(durationMs);
        const hour = new Date(now).getHours();
        const label = domainLabel(domain);
        insights.push(makeInsight(
            "long_session",
            domain,
            `${label} is holding your attention right now`,
            `Active for ${duration} straight`,
            {
                now,
                dateKey,
                contextKey: dateKey,
                notify: durationMs >= thresholds.longSessionNotifyMs,
                priority: 90 + Math.min(40, Math.round(durationMs / (10 * MINUTE_MS))),
                context: {
                    durationMs,
                    hour,
                    daypart: daypartForHour(hour)
                }
            }
        ));
    }

    function addRecurringTimeBlockInsights(insights, input, settings, now, dateKey) {
        const thresholds = thresholdsFor(settings);
        const history = input.hourlyUsageHistory || {};
        const todayKey = dayKeyOffset(now, 0);
        const seenDomainTypes = new Set();

        for (let hour = 0; hour < 24; hour += 1) {
            const todayUsage = domainUsageInHour(history, todayKey, hour);
            const candidates = Object.keys(todayUsage);

            for (const domain of candidates) {
                if (seenDomainTypes.has(domain)) continue;

                let consecutiveDays = 0;
                let totalMs = 0;
                let totalVisits = 0;

                for (let offset = 0; offset < thresholds.recurringDays; offset += 1) {
                    const dayUsage = domainUsageInHour(history, dayKeyOffset(now, offset), hour)[domain] || {};
                    const timeMs = Number(dayUsage.timeMs || 0);
                    const visits = Number(dayUsage.visits || 0);
                    if (timeMs < thresholds.recurringMinMs && visits <= 0) break;
                    consecutiveDays += 1;
                    totalMs += timeMs;
                    totalVisits += visits;
                }

                if (consecutiveDays < thresholds.recurringDays) continue;

                seenDomainTypes.add(domain);
                const daypart = daypartForHour(hour);
                const windowText = insightWindowPhrase(daypart, hour);
                const label = domainLabel(domain);
                insights.push(makeInsight(
                    "recurring_time_block",
                    domain,
                    `${label} often appears during your ${daypartPlural(daypart)}`,
                    `Active ${windowText} for ${consecutiveDays} straight days`,
                    {
                        now,
                        dateKey,
                        contextKey: `${dateKey}:${hour}`,
                        notify: true,
                        priority: 82 + consecutiveDays * 3 + Math.min(20, Math.round(totalMs / (15 * MINUTE_MS))),
                        context: {
                            hour,
                            consecutiveDays,
                            totalMs,
                            visits: totalVisits,
                            daypart
                        }
                    }
                ));
            }
        }
    }

    function addHighVisitFrequencyInsights(insights, input, settings, now, dateKey) {
        const thresholds = thresholdsFor(settings);
        const hour = new Date(now).getHours();
        const usage = domainUsageInHour(input.hourlyUsageHistory || {}, dateKey, hour);

        Object.entries(usage).forEach(([domain, entry]) => {
            const visitCount = Number(entry.visits || 0);
            if (visitCount < thresholds.highVisitCount) return;

            const daypart = daypartForHour(hour);
            const label = domainLabel(domain);
            insights.push(makeInsight(
                "high_visit_frequency",
                domain,
                `${label} keeps showing up this ${daypart}`,
                `Opened ${pluralize(visitCount, "time")} this hour`,
                {
                    now,
                    dateKey,
                    contextKey: `${dateKey}:${hour}`,
                    notify: visitCount >= thresholds.highVisitNotifyCount,
                    priority: 66 + visitCount,
                    context: { hour, visits: visitCount, daypart }
                }
            ));
        });
    }

    function addUsageIncreaseInsights(insights, input, settings, now, dateKey) {
        const thresholds = thresholdsFor(settings);
        const todayStats = statsForOffset(input, now, 0);

        Object.entries(todayStats).forEach(([domain, today]) => {
            const todayMs = entryTimeMs(today);
            if (todayMs < thresholds.usageIncreaseMinMs) return;

            const recent = [];
            for (let offset = 1; offset <= 7; offset += 1) {
                const stats = statsForOffset(input, now, offset);
                const dayMs = entryTimeMs(stats[domain] || {});
                if (dayMs > 0) recent.push(dayMs);
            }

            if (recent.length < thresholds.usageIncreaseMinHistoryDays) return;

            const averageMs = recent.reduce((sum, ms) => sum + ms, 0) / recent.length;
            const deltaMs = todayMs - averageMs;
            if (averageMs < thresholds.usageIncreaseAvgMinMs || deltaMs < thresholds.usageIncreaseMinDeltaMs) return;

            const ratio = todayMs / averageMs;
            if (ratio < thresholds.usageIncreaseRatio) return;

            const peakPattern = domainHourlyPattern(input, domain, now, 1);
            const daypart = peakPattern.peakDaypart || "";
            const adjective = daypartAdjective(daypart);
            const windowText = insightWindowPhrase(daypart, peakPattern.peakHour);
            const label = domainLabel(domain);
            insights.push(makeInsight(
                "usage_increase",
                domain,
                `${adjective ? `${adjective} ` : ""}${label} activity is increasing`,
                `Usage ${windowText ? `${windowText} ` : ""}rose ${formatIncreasePercent(ratio)} today`,
                {
                    now,
                    dateKey,
                    notify: true,
                    priority: 74 + Math.min(30, Math.round(ratio * 8)),
                    context: { todayMs, averageMs, ratio, ...peakPattern }
                }
            ));
        });
    }

    function addLimitSuggestionInsights(insights, input, settings, now, dateKey) {
        const thresholds = thresholdsFor(settings);
        const blocked = normalizedBlockedDomains(input.blockedDomains || {});
        const domains = new Set();

        for (let offset = 0; offset < 7; offset += 1) {
            Object.keys(statsForOffset(input, now, offset)).forEach((domain) => domains.add(domain));
        }

        domains.forEach((domain) => {
            if (!isValidDomain(domain) || blocked.has(domain)) return;

            let activeDays = 0;
            let totalMs = 0;
            let totalVisits = 0;

            for (let offset = 0; offset < 7; offset += 1) {
                const entry = statsForOffset(input, now, offset)[domain] || {};
                const dayMs = entryTimeMs(entry);
                const dayVisits = entryVisits(entry);
                if (dayMs > 0 || dayVisits > 0) activeDays += 1;
                totalMs += dayMs;
                totalVisits += dayVisits;
            }

            if (activeDays < thresholds.limitSuggestionDays) return;
            if (totalMs < thresholds.limitSuggestionTotalMs && totalVisits < thresholds.limitSuggestionVisits) return;

            const peakPattern = domainHourlyPattern(input, domain, now, 7);
            const hasPeakPattern = peakPattern.peakDaypart && Number(peakPattern.peakActiveDays || activeDays) >= 2;
            const label = domainLabel(domain);
            const title = hasPeakPattern
                ? `${label} often appears during your ${daypartPlural(peakPattern.peakDaypart)}`
                : `${label} has become a regular stop this week`;
            const windowText = hasPeakPattern
                ? insightWindowPhrase(peakPattern.peakDaypart, peakPattern.peakHour)
                : "";
            const activeText = dayCountText(activeDays, 7);
            insights.push(makeInsight(
                "limit_suggestion",
                domain,
                title,
                `Active ${windowText ? `${windowText} ` : ""}on ${activeText}`,
                {
                    now,
                    dateKey,
                    action: "addLimit",
                    notify: totalMs >= thresholds.limitSuggestionNotifyTotalMs,
                    priority: 70 + activeDays * 4 + Math.min(25, Math.round(totalMs / (30 * MINUTE_MS))),
                    context: {
                        activeDays,
                        totalMs,
                        visits: totalVisits,
                        windowDays: 7,
                        ...peakPattern
                    }
                }
            ));
        });
    }

    function dedupeInsights(insights) {
        const byTypeDomain = new Map();

        insights.forEach((insight) => {
            if (!insight || !isValidDomain(insight.domain)) return;
            const key = `${insight.type}:${insight.domain}`;
            const existing = byTypeDomain.get(key);
            if (!existing || Number(insight.priority || 0) > Number(existing.priority || 0)) {
                byTypeDomain.set(key, insight);
            }
        });

        return Array.from(byTypeDomain.values())
            .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.timestamp || 0) - Number(a.timestamp || 0));
    }

    function analyzeUsagePatterns(input = {}) {
        const settings = getInsightSettings(input.settings || {});
        if (!settings.personalInsightsEnabled) return [];

        const now = Number(input.now || Date.now());
        const dateKey = dayKeyOffset(now, 0);
        const insights = [];

        addLongSessionInsight(insights, input, settings, now, dateKey);
        addRecurringTimeBlockInsights(insights, input, settings, now, dateKey);
        addHighVisitFrequencyInsights(insights, input, settings, now, dateKey);
        addUsageIncreaseInsights(insights, input, settings, now, dateKey);
        addLimitSuggestionInsights(insights, input, settings, now, dateKey);

        return dedupeInsights(insights);
    }

    global.StmInsights = {
        DEFAULT_INSIGHT_SETTINGS,
        SENSITIVITY_THRESHOLDS,
        analyzeUsagePatterns,
        getInsightSettings,
        normalizeDomain,
        isValidDomain,
        getDayKey,
        DAY_MS
    };
})(typeof globalThis !== "undefined" ? globalThis : self);
