/**
 * Local Evaluation Engine
 * 
 * This module contains the local math expression evaluator that processes
 * user input line-by-line without requiring the LLM. It handles:
 * - Variable assignments (Name = value)
 * - Labeled values (Label: value)
 * - Tag-based summation (sum: tagname)
 * - Standard math expressions
 * 
 * The local engine runs first and its results take priority over AI results.
 */

import { SAFE_FUNCS } from './constants.js';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Strips inline comments from a line.
 * Example: "100 + 50 // my calculation" → "100 + 50"
 */
export const stripInlineComment = (s) => s.replace(/\/\/.*$/, '').trim();

/**
 * Removes hashtag-style tags from a line.
 * Example: "Groceries: 150 #food" → "Groceries: 150"
 */
export const removeTags = (line) => line.replace(/#([A-Za-z0-9][\w-]*)/g, '').trim();

/**
 * Extracts a tag from a line. Tags can be:
 * - Explicit: "tag: myTag"
 * - Hashtag: "#myTag"
 * Returns the tag name in lowercase, or null if no tag found.
 */
export const extractTag = (line) => {
    // Explicit tag: "tag: my tag" (allows spaces)
    const m1 = line.match(/\btag\s*:\s*([A-Za-z0-9][\w\s-]*)/i);
    if (m1) return m1[1].toLowerCase().trim();

    // Hashtag: "#myTag" (no spaces, can start with number)
    const m2 = line.match(/#([A-Za-z0-9][\w-]*)/);
    if (m2) return m2[1].toLowerCase();

    return null;
};

/**
 * Normalizes a variable name to be safe for JavaScript evaluation.
 * Replaces special characters with underscores.
 * Example: "My Var!" → "My_Var"
 */
export const normalizeVarName = (raw) =>
    raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || null;

/**
 * Removes natural language "glue" words and common unit words that don't affect math.
 * Example: "6 hours * rate" → "6  * rate"
 * Example: "20% of total" → "20%  total"
 * 
 * Note: We don't strip common words like 'rate', 'total' as they may be part of variable names.
 */
export const normalizeUnits = (expr) => {
    let s = expr;
    // 1. Remove rate indicators: /hr, /hour, /day, /week, /month, /year, /person, /unit
    // Replace with empty string (stripping the rate unit part)
    s = s.replace(/\/\s*(?:hr|hour|day|week|month|year|person|unit|item)s?\b/gi, '');

    // 2. Remove trailing unit words after numbers: "8 hours" -> "8"
    // Be careful not to match variables, only number + unit pattern
    s = s.replace(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|days?|weeks?|months?|years?|mins?|secs?)\b/gi, '$1');
    return s;
};

export const tokenizeNaturalGlue = (expr) => {
    const glue = [
        // Glue words
        'per', 'of', 'on', 'at', 'for', 'a', 'an', 'the', 'is', 'equals', 'equal',
        // Time units (these appear between a number and operator, not as variable names)
        'hours', 'hour', 'hrs', 'hr', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year',
        'minutes', 'minute', 'mins', 'min', 'seconds', 'second', 'secs', 'sec',
        // Count units  
        'items', 'item', 'units', 'unit', 'pieces', 'piece', 'pcs', 'pc',
        // Other modifiers
        'flat', 'fee', 'each'
    ];
    const re = new RegExp('\\b(' + glue.join('|') + ')\\b', 'gi');
    return expr.replace(re, ' ');
};

/**
 * Preprocesses an expression for evaluation:
 * - Converts Unicode math symbols (×, ÷, −) to JavaScript operators
 * - Strips currency symbols and commas from numbers
 * - Converts percentages to decimals (5% → (5/100))
 * - Converts caret ^ to exponentiation **
 * - Removes natural language glue words
 */
export const preprocessExpression = (expr) => {
    let s = expr.trim();
    s = normalizeUnits(s);
    s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    s = s.replace(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/g, (_, num) => String(num).replace(/,/g, ''));
    s = s.replace(/([0-9]+(?:\.[0-9]+)?)\s*%/g, '($1/100)');
    s = s.replace(/\^/g, '**');
    s = tokenizeNaturalGlue(s);
    return s.replace(/\s+/g, ' ').trim();
};

/**
 * Substitutes variable names in an expression with their numeric values.
 * This handles variable names with spaces (e.g., "Room Length").
 * 
 * Variables are sorted by length (longest first) to avoid partial matches.
 * Example: "Room Length * Room Width" with scope { "Room Length": 18, "Room Width": 14 }
 *          → "18 * 14"
 * 
 * @param {string} expr - The expression to process
 * @param {Object} scope - Object mapping variable names to numeric values
 * @returns {string} - Expression with variables replaced by their values
 */
export const substituteVariables = (expr, scope) => {
    if (!scope || Object.keys(scope).length === 0) return expr;

    let result = expr;

    // Sort variable names by length (longest first) to avoid partial matches
    // e.g., "Total Area" should be matched before "Total"
    const sortedNames = Object.keys(scope).sort((a, b) => b.length - a.length);

    for (const varName of sortedNames) {
        const value = scope[varName];
        if (!Number.isFinite(value)) continue;

        // Escape special regex characters in variable name
        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Match whole variable name (not as part of another word)
        // Allow for variable names with spaces
        const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
        result = result.replace(pattern, String(value));
    }

    return result;
};


/**
 * Checks if a string looks like it contains math to evaluate.
 * Returns true if it has numbers, operators, or math function calls.
 */
export const looksLikeMath = (s) => {
    // Phase 1: Negative patterns (Reject these even if they have numbers)
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return false; // Date: 12/25/2024
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return false;    // Time: 7:30
    if (/^\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}$/.test(s)) return false; // Phone
    if (/^https?:\/\//.test(s)) return false;             // URL
    if (/\S+@\S+\.\S+/.test(s)) return false;             // Email
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(s)) return false; // UUID-like

    // Phase 2: Positive patterns
    return /[0-9$%]/.test(s) ||
        /[+\-*/^()]/.test(s) ||
        /\b(sqrt|abs|min|max|round|floor|ceil|pow|log|exp)\s*\(/i.test(s);
};

/**
 * Builds an evaluator function with the given scope (variables).
 * The evaluator safely executes math expressions using Function constructor.
 * 
 * @param {Object} scope - Object mapping variable names to values
 * @returns {Function} - A function that takes an expression and returns the result
 */
export const buildEvaluator = (scope) => {
    const names = [...Object.keys(SAFE_FUNCS), ...Object.keys(scope)];
    const values = [...Object.values(SAFE_FUNCS), ...Object.values(scope)];
    return (expr) => {
        try {
            const code = '"use strict"; return (' + expr + ');';
            // eslint-disable-next-line no-new-func
            const fn = Function(...names, code);
            return fn(...values);
        } catch (e) {
            return null;
        }
    };
};

/**
 * Classifies the format of a number based on the raw line.
 * Used to determine how to display the result (currency vs plain number).
 */
export const classifyFormat = (rawLine) => /\$/.test(rawLine) ? 'currency' : 'number';

// ============================================
// MAIN EVALUATION FUNCTION
// ============================================

/**
 * Evaluates an entire document line by line.
 * 
 * This is the core local evaluation engine that processes text input
 * and produces computed results for each line that contains math.
 * 
 * @param {string} fullText - The full document text
 * @returns {Object} - Map of line indices to result objects
 * 
 * Result object structure:
 * {
 *   value: number,           // The computed value
 *   type: string,            // 'variable' | 'calc' | 'total'
 *   format: string,          // 'currency' | 'number'
 *   explanation: string,     // Human-readable description
 *   formula: string,         // The original expression
 *   source: 'local'          // Always 'local' for this engine
 * }
 */
export const evaluateDocument = (fullText) => {
    const lines = fullText.split('\n');
    const mathScope = Object.create(null); // Valid JS identifiers only
    const fullScope = Object.create(null); // All variables including friendly names
    const variableLines = Object.create(null); // Map variable name -> line index
    const lineValues = [];               // Value for each line (for L{n} references)
    const lineTags = [];                 // Tag for each line (for sum:tag)
    const results = {};                  // Final results keyed by line index

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        // 1. Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('//')) {
            lineValues.push(null);
            lineTags.push(extractTag(raw));
            continue;
        }

        // 2. Handle "sum: tagName" - sums all previous lines with that tag
        // Strip comment first
        const textOnly = stripInlineComment(trimmed);
        const sumMatch = textOnly.match(/^sum\s*:\s*([A-Za-z0-9][\w\s-]*)\s*$/i);
        if (sumMatch) {
            const tag = sumMatch[1].toLowerCase();
            let sum = 0;
            let count = 0;
            for (let j = 0; j < i; j++) {
                if (lineTags[j] === tag && Number.isFinite(lineValues[j])) {
                    sum += lineValues[j];
                    count++;
                }
            }
            results[i] = {
                value: sum,
                type: 'total',
                format: 'number',
                explanation: count ? `Sum of #${tag}` : `No #${tag} found`,
                formula: `sum(${tag})`,
                source: 'local'
            };
            lineValues.push(sum);
            lineTags.push(tag);

            // Export to scope so it can be referenced (e.g., "Income - sum:food")
            const rawLabel = `sum:${tag}`;
            const formattedLabel = `sum: ${tag}`;
            fullScope[rawLabel] = sum;
            fullScope[formattedLabel] = sum;
            fullScope[`sum(${tag})`] = sum;
            // Note: sums are not typically valid JS identifiers, so don't add to mathScope unless valid

            continue;
        }

        // 3. Handle variable assignment: "Name = expression"
        const eqIdx = trimmed.indexOf('=');
        let isAssignment = false;

        if (eqIdx > 0) {
            const left = trimmed.slice(0, eqIdx);
            const right = trimmed.slice(eqIdx + 1);
            const varId = normalizeVarName(left);

            if (varId && right.trim()) {
                const exprRaw = removeTags(stripInlineComment(right));
                // First substitute any variable references (e.g., "Room Length" → 18)
                const exprSubstituted = substituteVariables(exprRaw, fullScope);
                const expr = preprocessExpression(exprSubstituted);
                const evalFn = buildEvaluator(mathScope);
                const val = evalFn(expr);

                if (Number.isFinite(val)) {
                    // Internal evaluation needs safe names
                    mathScope[varId] = val;

                    // UI/AI can use friendly names
                    const friendlyName = left.trim();
                    fullScope[friendlyName] = val;
                    fullScope[varId] = val;
                    variableLines[friendlyName] = i;

                    results[i] = {
                        value: val,
                        type: 'variable',
                        format: classifyFormat(raw),
                        explanation: `Set ${friendlyName}`,
                        formula: exprRaw.trim(),
                        source: 'local'
                    };
                    lineValues.push(val);
                    lineTags.push(extractTag(raw));
                    isAssignment = true;
                }
            }
        }

        if (isAssignment) continue;

        // 4. Handle labeled value: "Label: expression" (e.g., "Rent: $1500")
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
            const left = trimmed.slice(0, colonIdx);
            const right = trimmed.slice(colonIdx + 1);

            const exprRaw = removeTags(stripInlineComment(right));
            const expr = preprocessExpression(exprRaw);

            if (looksLikeMath(expr)) {
                // Substitute variable references before evaluation
                const exprSubstituted = substituteVariables(exprRaw, fullScope);
                const exprFinal = preprocessExpression(exprSubstituted);
                const evalFn = buildEvaluator(mathScope);
                const val = evalFn(exprFinal);
                if (Number.isFinite(val)) {
                    const friendlyName = left.trim();
                    const varId = normalizeVarName(friendlyName);

                    if (varId) mathScope[varId] = val;
                    fullScope[friendlyName] = val;
                    if (varId) fullScope[varId] = val;
                    variableLines[friendlyName] = i;

                    results[i] = {
                        value: val,
                        type: 'calc',
                        format: classifyFormat(raw),
                        explanation: left.trim(),
                        formula: exprRaw.trim(),
                        source: 'local'
                    };
                    lineValues.push(val);
                    lineTags.push(extractTag(raw));
                    continue;
                }
            }
        }

        // 5. Handle standalone expression (e.g., "100 + 50")
        const exprRaw = removeTags(stripInlineComment(raw));
        const expr = preprocessExpression(exprRaw);
        const tag = extractTag(raw);

        if (looksLikeMath(expr)) {
            // Substitute variable references before evaluation
            const exprSubstituted = substituteVariables(exprRaw, fullScope);
            const exprFinal = preprocessExpression(exprSubstituted);
            const evalFn = buildEvaluator(mathScope);
            const val = evalFn(exprFinal);

            if (Number.isFinite(val)) {
                results[i] = {
                    value: val,
                    type: /\btotal\b/i.test(raw) ? 'total' : 'calc',
                    format: classifyFormat(raw),
                    explanation: tag ? `Tagged #${tag}` : '',
                    formula: exprRaw.trim(),
                    source: 'local'
                };
                lineValues.push(val);
                lineTags.push(tag);
                continue;
            }
        }

        // 6. Fallback: Text line with no calculable value
        lineValues.push(null);
        lineTags.push(tag);
    }

    return { results, variables: fullScope, variableLines };
};
