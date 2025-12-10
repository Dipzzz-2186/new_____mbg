// src/lib/formatDate.js
const ID_LOCALE = 'id-ID';
const WIB_TIMEZONE = 'Asia/Jakarta'; // WIB

const dateTimeFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: WIB_TIMEZONE
});
const dateFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: WIB_TIMEZONE
});
const timeFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    hour: '2-digit', minute: '2-digit',
    timeZone: WIB_TIMEZONE
});

/**
 * toDate:
 * - if value is Date -> return Date (if valid)
 * - if value is numeric -> treat as ms since epoch
 * - if value looks like MySQL datetime "YYYY-MM-DD HH:MM:SS" -> treat as UTC
 * - otherwise try `new Date(value)` and return null if invalid
 */
function toDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    // numeric timestamp (seconds or ms)
    if (typeof value === 'number') {
        // if it's seconds (10 digits), convert to ms
        if (value > 0 && value < 1e11) return new Date(value * 1000);
        return new Date(value);
    }

    if (typeof value === 'string') {
        // common MySQL format: "YYYY-MM-DD HH:MM:SS" OR "YYYY-MM-DD"
        // treat as UTC by converting to "YYYY-MM-DDTHH:MM:SSZ"
        const mysqlDateTime = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;
        const mysqlDateOnly = /^(\d{4}-\d{2}-\d{2})$/;
        let s = value.trim();

        if (mysqlDateTime.test(s)) {
            s = s.replace(' ', 'T') + 'Z'; // force UTC
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;
        }

        if (mysqlDateOnly.test(s)) {
            // date-only — interpret as midnight UTC
            s = s + 'T00:00:00Z';
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;
        }

        // fallback: try Date constructor (may interpret according to environment)
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    return null;
}

function formatDateTime(value) {
    const d = toDate(value);
    return d ? dateTimeFormatter.format(d) : null;
}
function formatDate(value) {
    const d = toDate(value);
    return d ? dateFormatter.format(d) : null;
}
function formatTime(value) {
    const d = toDate(value);
    return d ? timeFormatter.format(d) : null;
}

/**
 * Mutate object/array: replace date-like properties with formatted strings.
 * Keeps original raw value under key + '_raw' if not already present.
 */
function replaceDatesInObject(obj, opts = {}) {
    const dateKeyRegex = opts.regex || /(date|at|created|updated|arrived|shipped|time)$/i;
    const visited = new WeakSet();

    function walker(value) {
        if (!value || typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (const v of value) walker(v);
            return;
        }

        for (const key of Object.keys(value)) {
            try {
                const val = value[key];

                // If the key looks date-like, try to parse and replace
                if (dateKeyRegex.test(key)) {
                    const dt = toDate(val);
                    if (dt) {
                        const fmt = formatDateTime(dt) || formatDate(dt) || formatTime(dt);
                        const rawKey = `${key}_raw`;
                        if (!Object.prototype.hasOwnProperty.call(value, rawKey)) {
                            value[rawKey] = val;
                        }
                        value[key] = fmt;
                    }
                }

                // Recurse into nested objects/arrays
                if (val && typeof val === 'object') walker(val);
            } catch (e) {
                // ignore to avoid breaking rendering
            }
        }
    }

    walker(obj);
    return obj;
}

module.exports = {
    formatDateTime,
    formatDate,
    formatTime,
    replaceDatesInObject
};
