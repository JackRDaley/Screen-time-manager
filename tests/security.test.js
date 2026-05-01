// Sample test file demonstrating how to test critical blocking/security functions
// This is a template - expand with more test cases

describe('Security: Domain Validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('validateDomainParam', () => {
        // Mock the validation function that we would extract from blocked.js
        const validateDomainParam = (raw) => {
            if (!raw || typeof raw !== "string") return null;
            const trimmed = raw.trim().toLowerCase();
            if (!trimmed) return null;
            
            if (trimmed.includes("://") || trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
                return null;
            }
            
            if (!/^[a-z0-9.-]+$/.test(trimmed)) {
                return null;
            }

            const labels = trimmed.split(".");
            if (labels.some((label) => !label || label.startsWith("-") || label.endsWith("-"))) {
                return null;
            }
            
            if (trimmed.length > 255) {
                return null;
            }
            
            return trimmed;
        };

        test('accepts valid domain names', () => {
            expect(validateDomainParam('youtube.com')).toBe('youtube.com');
            expect(validateDomainParam('twitter.com')).toBe('twitter.com');
            expect(validateDomainParam('sub.example.co.uk')).toBe('sub.example.co.uk');
        });

        test('accepts domains with uppercase (converts to lowercase)', () => {
            expect(validateDomainParam('YouTube.COM')).toBe('youtube.com');
            expect(validateDomainParam('Twitter.Com')).toBe('twitter.com');
        });

        test('rejects URLs with protocol', () => {
            expect(validateDomainParam('https://youtube.com')).toBeNull();
            expect(validateDomainParam('http://youtube.com')).toBeNull();
            expect(validateDomainParam('ftp://youtube.com')).toBeNull();
        });

        test('rejects javascript: and data: URLs', () => {
            expect(validateDomainParam('javascript:alert("xss")')).toBeNull();
            expect(validateDomainParam('data:text/html,<script>alert("xss")</script>')).toBeNull();
        });

        test('rejects invalid domain formats', () => {
            expect(validateDomainParam('invalid domain')).toBeNull();
            expect(validateDomainParam('example..com')).toBeNull();
            expect(validateDomainParam('-example.com')).toBeNull();
            expect(validateDomainParam('example-.com')).toBeNull();
        });

        test('rejects domains exceeding max length', () => {
            const longDomain = 'a'.repeat(256) + '.com';
            expect(validateDomainParam(longDomain)).toBeNull();
        });

        test('rejects null and undefined', () => {
            expect(validateDomainParam(null)).toBeNull();
            expect(validateDomainParam(undefined)).toBeNull();
            expect(validateDomainParam('')).toBeNull();
        });

        test('handles whitespace', () => {
            expect(validateDomainParam('  youtube.com  ')).toBe('youtube.com');
            expect(validateDomainParam('\tyoutube.com\n')).toBe('youtube.com');
        });
    });
});

describe('Security: Reset Token System', () => {
    let resetTokens = new Map();
    const RESET_TOKEN_TTL_MS = 5000;

    const createResetToken = (domain) => {
        if (!domain || typeof domain !== "string") return null;
        const token = `reset_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        
        resetTokens.set(token, {
            domain: domain.toLowerCase(),
            expiresAt: Date.now() + RESET_TOKEN_TTL_MS
        });
        
        return token;
    };

    const verifyResetToken = (token, domain) => {
        if (!token || typeof token !== "string") return false;
        const record = resetTokens.get(token);
        if (!record) return false;
        
        resetTokens.delete(token); // One-time use only
        
        if (record.domain !== domain.toLowerCase()) return false;
        if (record.expiresAt < Date.now()) return false;
        
        return true;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        resetTokens.clear();
    });

    test('creates valid reset tokens', () => {
        const token = createResetToken('youtube.com');
        expect(token).toBeTruthy();
        expect(token).toContain('reset_');
    });

    test('verifies valid tokens', () => {
        const token = createResetToken('youtube.com');
        const verified = verifyResetToken(token, 'youtube.com');
        expect(verified).toBe(true);
    });

    test('tokens are one-time use only', () => {
        const token = createResetToken('youtube.com');
        
        // First use succeeds
        expect(verifyResetToken(token, 'youtube.com')).toBe(true);
        
        // Second use fails (token already consumed)
        expect(verifyResetToken(token, 'youtube.com')).toBe(false);
    });

    test('rejects tokens for wrong domain', () => {
        const token = createResetToken('youtube.com');
        const verified = verifyResetToken(token, 'twitter.com');
        expect(verified).toBe(false);
    });

    test('rejects non-existent tokens', () => {
        const verified = verifyResetToken('invalid-token', 'youtube.com');
        expect(verified).toBe(false);
    });

    test('rejects expired tokens', () => {
        const token = createResetToken('youtube.com');
        
        // Simulate token expiry
        const record = resetTokens.get(token);
        record.expiresAt = Date.now() - 1000; // Expired 1 second ago
        
        const verified = verifyResetToken(token, 'youtube.com');
        expect(verified).toBe(false);
    });

    test('handles case-insensitive domain matching', () => {
        const token = createResetToken('YouTube.COM');
        const verified = verifyResetToken(token, 'youtube.com');
        expect(verified).toBe(true);
    });
});

describe('Config Validation', () => {
    const DOMAIN_CONFIG_VALIDATION = {
        MIN_LIMIT_SECONDS: 60,
        MAX_LIMIT_SECONDS: 86400,
        ALLOWED_TIERS: ['lenient', 'standard', 'strict', 'immutable']
    };

    const normalizeBlockedDomainConfig = (rawConfig) => {
        if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
            return {
                enabled: true,
                limitSeconds: 0,
                tier: 'lenient'
            };
        }

        let limitSeconds = Number(rawConfig.limitSeconds || 0);
        if (!Number.isFinite(limitSeconds)) {
            limitSeconds = 0;
        } else if (limitSeconds > 0) {
            limitSeconds = Math.max(
                DOMAIN_CONFIG_VALIDATION.MIN_LIMIT_SECONDS,
                Math.min(DOMAIN_CONFIG_VALIDATION.MAX_LIMIT_SECONDS, limitSeconds)
            );
        }

        return {
            enabled: rawConfig.enabled !== false,
            limitSeconds,
            tier: rawConfig.tier || 'lenient'
        };
    };

    test('enforces minimum limit', () => {
        const config = normalizeBlockedDomainConfig({
            limitSeconds: 30 // Less than MIN_LIMIT_SECONDS
        });
        expect(config.limitSeconds).toBe(DOMAIN_CONFIG_VALIDATION.MIN_LIMIT_SECONDS);
    });

    test('enforces maximum limit', () => {
        const config = normalizeBlockedDomainConfig({
            limitSeconds: 999999 // More than MAX_LIMIT_SECONDS
        });
        expect(config.limitSeconds).toBe(DOMAIN_CONFIG_VALIDATION.MAX_LIMIT_SECONDS);
    });

    test('accepts valid limits', () => {
        const config = normalizeBlockedDomainConfig({
            limitSeconds: 1800 // 30 minutes
        });
        expect(config.limitSeconds).toBe(1800);
    });

    test('rejects invalid limitSeconds', () => {
        const config = normalizeBlockedDomainConfig({
            limitSeconds: NaN
        });
        expect(config.limitSeconds).toBe(0);

        const config2 = normalizeBlockedDomainConfig({
            limitSeconds: 'invalid'
        });
        expect(config2.limitSeconds).toBe(0);
    });

    test('returns valid config for null input', () => {
        const config = normalizeBlockedDomainConfig(null);
        expect(config).toEqual({
            enabled: true,
            limitSeconds: 0,
            tier: 'lenient'
        });
    });
});
