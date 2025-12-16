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

import { SAFE_FUNCS } from './constants';

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
export const removeTags = (line) => line.replace(/#([A-Za-z][\w-]*)/g, '').trim();

/**
 * Extracts a tag from a line. Tags can be:
 * - Explicit: "tag: myTag"
 * - Hashtag: "#myTag"
 * Returns the tag name in lowercase, or null if no tag found.
 */
export const extractTag = (line) => {
    const m1 = line.match(/\btag\s*:\s*([A-Za-z][\w-]*)/i);
    if (m1) return m1[1].toLowerCase();
    const m2 = line.match(/#([A-Za-z][\w-]*)/);
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
 * Removes natural language "glue" words that don't affect math.
 * Example: "20% of total" → "20%  total"
 */
export const tokenizeNaturalGlue = (expr) => {
    const glue = ['per', 'of', 'on', 'at', 'for', 'a', 'an', 'the', 'is', 'equals', 'equal'];
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
    s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    s = s.replace(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/g, (_, num) => String(num).replace(/,/g, ''));
    s = s.replace(/([0-9]+(?:\.[0-9]+)?)\s*%/g, '($1/100)');
    s = s.replace(/\^/g, '**');
    s = tokenizeNaturalGlue(s);
    return s.replace(/\s+/g, ' ').trim();
};

/**
 * Checks if a string looks like it contains math to evaluate.
 * Returns true if it has numbers, operators, or math function calls.
 */
export const looksLikeMath = (s) =>
    /[0-9$%]/.test(s) ||
    /[+\-*/^()]/.test(s) ||
    /\b(sqrt|abs|min|max|round|floor|ceil|pow|log|exp)\s*\(/i.test(s);

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
    const scope = Object.create(null);  // Variables defined so far
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
        const sumMatch = trimmed.match(/^sum\s*:\s*([A-Za-z][\w-]*)\s*$/i);
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
                const expr = preprocessExpression(exprRaw);
                const evalFn = buildEvaluator(scope);
                const val = evalFn(expr);

                if (Number.isFinite(val)) {
                    scope[varId] = val;
                    results[i] = {
                        value: val,
                        type: 'variable',
                        format: classifyFormat(raw),
                        explanation: `Set ${left.trim()}`,
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
                const evalFn = buildEvaluator(scope);
                const val = evalFn(expr);
                if (Number.isFinite(val)) {
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
            const evalFn = buildEvaluator(scope);
            const val = evalFn(expr);

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

    return results;
};
