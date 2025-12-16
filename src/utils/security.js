/**
 * Security utilities for the AI pipeline.
 */

/**
 * Generates a UUIDv4.
 * Uses crypto.randomUUID if available, otherwise falls back to a polyfill.
 */
export const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

/**
 * Computes a simple stable hash of a JSON-serializable object.
 * Used to verify that the lines/variables sent match what is returned.
 * Returns a hex string.
 */
export const computeInfoHash = async (obj) => {
    try {
        const str = JSON.stringify(obj, Object.keys(obj).sort());
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); // Short hash
        }
    } catch (e) {
        console.warn('Crypto hash failed, falling back to simple hash', e);
    }

    // Fallback: Simple DJB2-like string hash
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return (hash >>> 0).toString(16);
};
