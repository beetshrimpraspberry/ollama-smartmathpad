/**
 * Value Formatting Utilities
 * 
 * Functions for displaying computed values in user-friendly formats.
 */

/**
 * Formats a numeric value for display based on the specified format type.
 * 
 * @param {number} val - The value to format
 * @param {string} format - Format type: 'currency', 'percent', or 'number'
 * @returns {string} - Formatted string representation
 * 
 * @example
 * formatValue(1234.56, 'currency')  // "$1,234.56"
 * formatValue(0.15, 'percent')      // "15.0%"
 * formatValue(1234.56, 'number')    // "1,234.56"
 */
export const formatValue = (val, format) => {
    if (!Number.isFinite(val)) return '';

    if (format === 'currency') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(val);
    }

    if (format === 'percent') {
        return (val * 100).toFixed(1) + '%';
    }

    // Default: plain number with locale formatting
    return val.toLocaleString(undefined, {
        maximumFractionDigits: 2
    });
};

/**
 * Formats a date for display in the sidebar file list.
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} - Relative time string (e.g., "2 hours ago")
 */
export const formatRelativeTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return new Date(timestamp).toLocaleDateString();
};

/**
 * Formats a file size in bytes to human-readable format.
 * 
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted size (e.g., "1.5 KB")
 */
export const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
