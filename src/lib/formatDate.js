// src/lib/formatDate.js
const ID_LOCALE = 'id-ID';

const dateTimeFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
});
const dateFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat(ID_LOCALE, {
    hour: '2-digit', minute: '2-digit'
});

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    // handle mysql date-like strings / numbers
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
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
 *
 * Use when you want views to keep using the same property names (e.g. created_at).
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
                        // preserve original raw value if not already preserved
                        if (!Object.prototype.hasOwnProperty.call(value, rawKey)) {
                            value[rawKey] = val;
                        }
                        // replace the original property with formatted string
                        value[key] = fmt;
                    }
                }

                // Recurse into nested objects/arrays
                if (val && typeof val === 'object') walker(val);
            } catch (e) {
                // ignore to avoid breaking rendering
                // console.warn('replaceDatesInObject warn', e && e.message);
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
