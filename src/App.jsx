import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Sparkles, RefreshCcw, Moon, Sun, Calculator, Variable, Sigma, ArrowLeftRight, ArrowRight, Cloud, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import 'react-grab'; // Dev tool import

/* --- LOCAL LLM CONFIGURATION --- */
/* --- LOCAL LLM CONFIGURATION --- */
const LOCAL_API_URL = "http://localhost:8080/v1/chat/completions";

const SoulverClone = () => {
    // --- STATE ---
    const [text, setText] = useState('# Try variables and tagging\nRent = $2,400\nGroceries: 150 #food\nDining: 80 #food\n\nsum: food\n\n# Natural language (AI)\nSplit evenly per person');

    // aiLogic: Logic extracted by LLM
    const [aiLogic, setAiLogic] = useState({});

    // computedResults: The final merged values to display.
    const [computedResults, setComputedResults] = useState({});

    const [loading, setLoading] = useState(false);
    const [serverStatus, setServerStatus] = useState('unknown'); // local server status
    const [isDarkMode, setIsDarkMode] = useState(false);

    // --- REFS ---
    const textareaRef = useRef(null);
    const resultsRef = useRef(null);
    const highlightRef = useRef(null);

    // --- CONSTANTS ---
    const ROW_HEIGHT = 32;
    const FONT_SIZE = 16;
    const PADDING = 24;

    // ==========================================
    // 1. LOCAL SOULVER ENGINE (Regex/Eval)
    // ==========================================

    const SAFE_FUNCS = {
        sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
        round: (x, d = 0) => { const p = Math.pow(10, d); return Math.round(x * p) / p; },
        floor: Math.floor, ceil: Math.ceil, pow: Math.pow, log: Math.log, exp: Math.exp,
    };

    const stripInlineComment = (line) => {
        // Removes // comments and # comments (if not followed by a word char, e.g. # tag)
        const idx = line.search(/\s#(?!\w)/);
        if (idx >= 0) return line.slice(0, idx).trimEnd();
        const idx2 = line.indexOf('//');
        if (idx2 >= 0) return line.slice(0, idx2).trimEnd();
        return line;
    };

    // Helper to remove #tags from the expression so math evaluation works
    const removeTags = (line) => {
        return line.replace(/#([A-Za-z][\w-]*)/g, '').trim();
    };

    const extractTag = (line) => {
        const m1 = line.match(/\btag\s*:\s*([A-Za-z][\w-]*)/i);
        if (m1) return m1[1].toLowerCase();
        const m2 = line.match(/#([A-Za-z][\w-]*)/);
        if (m2) return m2[1].toLowerCase();
        return null;
    };

    const normalizeVarName = (raw) => raw.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || null;

    const tokenizeNaturalGlue = (expr) => {
        const glue = ['per', 'of', 'on', 'at', 'for', 'a', 'an', 'the', 'is', 'equals', 'equal'];
        const re = new RegExp('\\b(' + glue.join('|') + ')\\b', 'gi');
        return expr.replace(re, ' ');
    };

    const preprocessExpression = (expr) => {
        let s = expr.trim();
        s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
        s = s.replace(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/g, (_, num) => String(num).replace(/,/g, ''));
        s = s.replace(/([0-9]+(?:\.[0-9]+)?)\s*%/g, '($1/100)');
        s = s.replace(/\^/g, '**');
        s = tokenizeNaturalGlue(s);
        return s.replace(/\s+/g, ' ').trim();
    };

    const looksLikeMath = (s) => /[0-9$%]/.test(s) || /[+\-*/^()]/.test(s) || /\b(sqrt|abs|min|max|round|floor|ceil|pow|log|exp)\s*\(/i.test(s);

    const buildEvaluator = (scope) => {
        const names = [...Object.keys(SAFE_FUNCS), ...Object.keys(scope)];
        const values = [...Object.values(SAFE_FUNCS), ...Object.values(scope)];
        return (expr) => {
            try {
                const code = '"use strict"; return (' + expr + ');';
                // eslint-disable-next-line no-new-func
                const fn = Function(...names, code);
                return fn(...values);
            } catch (e) { return null; }
        };
    };

    const classifyFormat = (rawLine) => /\$/.test(rawLine) ? 'currency' : 'number';

    const evaluateDocument = (fullText) => {
        const lines = fullText.split('\n');
        const scope = Object.create(null);
        const lineValues = [];
        const lineTags = [];
        const results = {}; // key: lineIndex

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();

            // 1. Skip empty/comments
            if (!trimmed || trimmed.startsWith('//')) {
                lineValues.push(null);
                lineTags.push(extractTag(raw));
                continue;
            }

            // 2. Sum: Tag
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

            // 3. Assignment: Name = Expr
            const eqIdx = trimmed.indexOf('=');
            let isAssignment = false;

            if (eqIdx > 0) {
                const left = trimmed.slice(0, eqIdx);
                const right = trimmed.slice(eqIdx + 1);
                const varId = normalizeVarName(left);

                if (varId && right.trim()) {
                    // Remove comments AND tags before evaluating expression
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

            // 3.5. Explicit Label: Expression (e.g. "Flight: 1200")
            const colonIdx = trimmed.indexOf(':');
            if (colonIdx > 0) {
                const left = trimmed.slice(0, colonIdx);
                const right = trimmed.slice(colonIdx + 1);

                // Remove tags from the right side so "150 #food" becomes "150"
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

            // 4. Standard Expression or Text
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

            // Fallback: Text line (no value)
            lineValues.push(null);
            lineTags.push(tag);
        }

        return results;
    };

    // ==========================================
    // 2. API LOGIC (LOCAL LLM)
    // ==========================================
    // --- DEBUGGING ---
    const [debugInfo, setDebugInfo] = useState({ lastError: null, lastResponse: null, url: LOCAL_API_URL });
    const [showDebug, setShowDebug] = useState(false);

    // ==========================================
    // 2. API LOGIC (LOCAL LLM)
    // ==========================================
    const callLocalLLM = async (inputText) => {
        if (!inputText.trim()) {
            setAiLogic({});
            setServerStatus('unknown');
            return;
        }
        setLoading(true);
        setServerStatus('connecting...');
        setDebugInfo(prev => ({ ...prev, lastError: null }));

        // Build line map and extract variables
        const lineMap = {};
        const variables = {}; // { varName: { line: idx, value: number } }
        const lines = inputText.split('\n');

        lines.forEach((line, idx) => {
            if (line.trim()) {
                lineMap[idx] = line;

                // Extract variable assignments (e.g., "Rent = $2400")
                const eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    const varName = line.slice(0, eqIdx).trim();
                    const rightSide = line.slice(eqIdx + 1).trim();
                    // Try to parse the value
                    const numMatch = rightSide.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
                    if (numMatch) {
                        const value = parseFloat(numMatch[1].replace(/,/g, ''));
                        if (!isNaN(value)) {
                            variables[varName] = { line: idx, value };
                        }
                    }
                }

                // Extract labeled values (e.g., "Groceries: 150")
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0 && !line.match(/^(sum|tag)\s*:/i)) {
                    const label = line.slice(0, colonIdx).trim();
                    const rightSide = line.slice(colonIdx + 1).trim();
                    const numMatch = rightSide.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
                    if (numMatch) {
                        const value = parseFloat(numMatch[1].replace(/,/g, ''));
                        if (!isNaN(value)) {
                            variables[label] = { line: idx, value };
                        }
                    }
                }
            }
        });

        // Build enhanced input with variables context
        const llmInput = {
            lines: lineMap,
            variables: variables
        };

        // Store input for debugging
        setDebugInfo(prev => ({ ...prev, lastInput: JSON.stringify(llmInput, null, 2) }));

        const systemPrompt = `You are a Logic Extraction Engine for a smart calculator.

INPUT FORMAT:
{
  "lines": { "lineIndex": "text content" },
  "variables": { "VarName": { "line": lineIndex, "value": number } }
}

OUTPUT FORMAT:
{ "lineIndex": { "formula": string, "type": string, "format": string, "explanation": string } }

RULES:
1. **Use Variable Names**: If a variable exists, use its name in formulas (e.g., "Rent + Utilities") instead of line refs.
2. **Line References**: Use L{n} for lines without variable names, or L{prev} for previous line.
3. **Implicit Values**: "Tax is 5%" → formula "0.05".
4. **Natural Language Math**: 
   - "Split evenly" or "per person" → divide by number of people (default 2 if not specified)
   - "What's left" or "remaining" → subtract from total
   - "Double" → multiply by 2
   - "Half" → divide by 2
5. **Types**: "variable", "formula", "total", "header", "note"
6. **Explanations**: Concise labels describing what the line calculates.

IMPORTANT: 
- Natural language like "Split evenly per person" MUST produce a formula (e.g., "L{prev} / 2"), NOT a note.
- Only mark as "note" if line is pure comment with no calculation intent.
- Return ONLY valid JSON. Use variable names when available.`;

        try {
            const response = await fetch(LOCAL_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: JSON.stringify(llmInput) }
                    ],
                    temperature: 0.1,
                    stream: true // Enable streaming
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            setServerStatus('connected');

            // Read the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta?.content || '';
                            fullContent += delta;

                            // Try to parse partial JSON and update UI
                            // We attempt to "close" the JSON by adding missing braces
                            try {
                                let testJson = fullContent;
                                // Count open braces and try to close them
                                const openBraces = (testJson.match(/{/g) || []).length;
                                const closeBraces = (testJson.match(/}/g) || []).length;
                                for (let i = 0; i < openBraces - closeBraces; i++) {
                                    testJson += '}';
                                }
                                const partialLogic = JSON.parse(testJson);
                                setAiLogic(partialLogic);
                            } catch {
                                // Still incomplete, wait for more
                            }
                        } catch {
                            // Skip malformed chunks
                        }
                    }
                }
            }

            setDebugInfo(prev => ({ ...prev, lastResponse: fullContent }));

            // Final parse
            try {
                setAiLogic(JSON.parse(fullContent));
            } catch {
                setDebugInfo(prev => ({ ...prev, lastError: "Invalid JSON from LLM" }));
            }

        } catch (err) {
            console.error("LLM API Error:", err);
            setServerStatus('error');
            setDebugInfo(prev => ({ ...prev, lastError: err.message || String(err) }));
        } finally {
            setLoading(false);
        }
    };

    // ==========================================
    // 3. ORCHESTRATOR & RENDER LOGIC
    // ==========================================

    useEffect(() => {
        const localResults = evaluateDocument(text);

        const finalResults = {};
        const lines = text.split('\n');
        const currentValues = {};
        Object.keys(localResults).forEach(k => currentValues[k] = localResults[k].value);

        // Build a variable lookup map from local results
        const variableValues = {}; // { "Rent": 2400, "Utilities": 180 }
        lines.forEach((line, idx) => {
            if (localResults[idx]) {
                // Extract variable name from assignment (e.g., "Rent = $2400" -> "Rent")
                const eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    const varName = line.slice(0, eqIdx).trim();
                    variableValues[varName] = localResults[idx].value;
                }
                // Extract label from colon syntax (e.g., "Groceries: 150" -> "Groceries")
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0 && !line.match(/^(sum|tag)\s*:/i)) {
                    const label = line.slice(0, colonIdx).trim();
                    variableValues[label] = localResults[idx].value;
                }
            }
        });

        lines.forEach((_, idx) => {
            let merged = null;
            if (localResults[idx]) {
                merged = {
                    ...localResults[idx],
                    formatted: formatValue(localResults[idx].value, localResults[idx].format),
                    source: 'local'
                };
                finalResults[idx] = merged;
                return;
            }

            // Case B: AI Logic
            const aiItem = aiLogic[idx];
            if (aiItem && aiItem.formula) {
                try {
                    let parsable = aiItem.formula;

                    // If formula contains "=", take only the right side (the expression)
                    // e.g., "Total Fixed Costs = Venue Rental + Stage & Sound" -> "Venue Rental + Stage & Sound"
                    if (parsable.includes('=')) {
                        const eqIdx = parsable.indexOf('=');
                        parsable = parsable.slice(eqIdx + 1).trim();
                    }

                    // Handle header/note types - show explanation only, no calculation
                    if (['header', 'note', 'variable'].includes(parsable.toLowerCase()) || aiItem.type === 'header' || aiItem.type === 'note') {
                        if (aiItem.explanation) {
                            finalResults[idx] = {
                                value: null,
                                formatted: '',
                                type: aiItem.type,
                                explanation: aiItem.explanation,
                                formula: '',
                                source: 'ai'
                            };
                        }
                        return;
                    }

                    // First, replace variable names with their values
                    // Sort by length descending to avoid partial matches (e.g., "Rent" vs "Rent Total")
                    const sortedVarNames = Object.keys(variableValues).sort((a, b) => b.length - a.length);
                    for (const varName of sortedVarNames) {
                        // Escape special regex chars and create pattern that handles spaces
                        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(escaped, 'gi');
                        parsable = parsable.replace(regex, variableValues[varName]);
                    }

                    // Handle L{prev} - replace with previous line's value
                    parsable = parsable.replace(/L\{prev\}/gi, () => {
                        // Find the closest previous line with a value
                        for (let i = idx - 1; i >= 0; i--) {
                            if (finalResults[i]?.value !== undefined) return finalResults[i].value;
                            if (currentValues[i] !== undefined) return currentValues[i];
                        }
                        return 0;
                    });

                    // Handle L{digit} with curly braces (e.g., L{2}, L{10})
                    parsable = parsable.replace(/L\{(\d+)\}/g, (_, lineNum) => {
                        const v = finalResults[lineNum]?.value ?? currentValues[lineNum] ?? 0;
                        return v;
                    });

                    // Handle L followed by number without braces (e.g., L5)
                    parsable = parsable.replace(/L(\d+)/g, (_, lineNum) => {
                        const v = finalResults[lineNum]?.value ?? currentValues[lineNum] ?? 0;
                        return v;
                    });

                    // Handle sum(tag) - sum all values with that tag
                    parsable = parsable.replace(/sum\((\w+)\)/gi, (_, tag) => {
                        // For now, just use 0 - the local engine handles sum() better
                        return 0;
                    });

                    // Handle math functions the AI might use
                    parsable = parsable.replace(/sqrt\(([^)]+)\)/gi, (_, arg) => `Math.sqrt(${arg})`);
                    parsable = parsable.replace(/round\(([^,]+),\s*(\d+)\)/gi, (_, num, dec) => `(Math.round(${num} * Math.pow(10, ${dec})) / Math.pow(10, ${dec}))`);
                    parsable = parsable.replace(/max\(([^)]+)\)/gi, (_, args) => `Math.max(${args})`);
                    parsable = parsable.replace(/min\(([^)]+)\)/gi, (_, args) => `Math.min(${args})`);

                    // Skip if formula is empty or non-numeric
                    if (!parsable || parsable === '' || parsable === '0') {
                        return;
                    }

                    // eslint-disable-next-line no-new-func
                    const val = new Function(`return (${parsable})`)();

                    if (Number.isFinite(val)) {
                        finalResults[idx] = {
                            value: val,
                            formatted: formatValue(val, aiItem.format),
                            type: aiItem.type,
                            explanation: aiItem.explanation,
                            formula: aiItem.formula,
                            source: 'ai'
                        };
                        currentValues[idx] = val;

                        // Also add computed result to variableValues so later formulas can use it
                        // Extract variable name from left side of "=" in original formula
                        const originalFormula = aiItem.formula;
                        if (originalFormula.includes('=')) {
                            const computedVarName = originalFormula.slice(0, originalFormula.indexOf('=')).trim();
                            if (computedVarName) {
                                variableValues[computedVarName] = val;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        });

        setComputedResults(finalResults);
    }, [text, aiLogic]); // This effect only MERGES results, doesn't call LLM

    // Separate useEffect for debounced LLM call - only depends on text
    useEffect(() => {
        const timer = setTimeout(() => callLocalLLM(text), 800);
        return () => clearTimeout(timer);
    }, [text]); // Only re-call LLM when text changes, NOT when aiLogic changes

    // Helper formatter
    const formatValue = (val, format) => {
        if (!Number.isFinite(val)) return '';
        if (format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
        if (format === 'percent') return (val * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%';
        return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    // --- UI HELPERS ---
    const handleScroll = (e) => {
        if (resultsRef.current) resultsRef.current.scrollTop = e.target.scrollTop;
        if (highlightRef.current) {
            highlightRef.current.scrollTop = e.target.scrollTop;
            highlightRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    const getHighlightedText = (content) => {
        let safeText = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        safeText = safeText.replace(/(\d{1,3}(,\d{3})*(\.\d+)?)/g, '%%%NUM%%%$1%%%END%%%');
        safeText = safeText.replace(/([#][a-zA-Z0-9_]+)/g, '%%%TAG%%%$1%%%END%%%');

        return safeText
            .replace(/%%%NUM%%%/g, '<span class="text-blue-500 font-bold">')
            .replace(/%%%TAG%%%/g, '<span class="text-purple-400 font-medium">')
            .replace(/%%%END%%%/g, '</span>') + '<br>';
    };

    return (
        <div className={`flex flex-col h-screen w-full transition-colors duration-500 font-mono ${isDarkMode ? 'bg-[#1e1e1e] text-gray-300' : 'bg-white text-gray-800'}`}>

            {/* DEBUG MODAL */}
            <AnimatePresence>
                {showDebug && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="absolute top-16 right-6 z-50 w-96 bg-white dark:bg-[#252526] border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-lg overflow-hidden text-xs"
                    >
                        <div className="p-3 border-b dark:border-zinc-700 font-semibold flex justify-between items-center">
                            <span>LLM Debugger</span>
                            <button onClick={() => setShowDebug(false)} className="hover:text-red-500">Close</button>
                        </div>
                        <div className="p-3 space-y-3">
                            <div>
                                <span className="block opacity-50 mb-1">API URL</span>
                                <code className="block p-2 bg-zinc-100 dark:bg-zinc-800 rounded break-all">{debugInfo.url}</code>
                            </div>

                            {debugInfo.lastError && (
                                <div>
                                    <span className="block text-red-500 font-bold mb-1">Last Error</span>
                                    <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded break-words">
                                        {debugInfo.lastError}
                                    </div>
                                </div>
                            )}

                            <div>
                                <span className="block opacity-50 mb-1">Last Response</span>
                                <pre className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded overflow-auto max-h-40">
                                    {debugInfo.lastResponse || "No response yet"}
                                </pre>
                            </div>

                            <button
                                onClick={() => callLocalLLM(text)}
                                className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium"
                            >
                                Force Retry Connection
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* HEADER */}
            <header className={`flex-none h-14 flex items-center justify-between px-6 border-b z-30 ${isDarkMode ? 'border-gray-800 bg-[#252526]' : 'border-gray-100 bg-white'}`}>
                <div className="flex items-center gap-2">
                    <Calculator className={`w-5 h-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <span className="font-semibold tracking-tight text-sm">Smart Sheet</span>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded-full transition-all duration-300 cursor-pointer hover:opacity-80 ${serverStatus === 'connected' ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100/50 text-green-600') : (isDarkMode ? 'bg-slate-800' : 'bg-slate-100')}`}
                    >
                        {serverStatus === 'connected' ? (
                            <Zap className="w-3 h-3" />
                        ) : serverStatus === 'error' ? (
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                        ) : (
                            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                        )}

                        <span>{serverStatus === 'connected' ? 'Connected' : 'Connecting...'}</span>
                        <span className="text-gray-300 opacity-50">|</span>
                        <Cloud className={`w-3 h-3 ${loading ? 'text-blue-500 animate-pulse' : 'text-gray-400'}`} />
                        <span>AI</span>
                    </button>
                    <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-1.5 rounded-md ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}>
                        {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                </div>
            </header>

            {/* MAIN */}
            <div className="flex-1 flex overflow-hidden relative">
                {/* Editor */}
                <div className="w-1/2 relative h-full border-r border-transparent">
                    <pre
                        ref={highlightRef}
                        className={`absolute inset-0 m-0 overflow-hidden whitespace-pre pointer-events-none z-0 ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}
                        style={{ fontFamily: '"Menlo", monospace', fontSize: `${FONT_SIZE}px`, lineHeight: `${ROW_HEIGHT}px`, padding: `${PADDING}px` }}
                        dangerouslySetInnerHTML={{ __html: getHighlightedText(text) }}
                    />
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onScroll={handleScroll}
                        spellCheck="false"
                        className={`absolute inset-0 w-full h-full m-0 overflow-auto whitespace-pre resize-none bg-transparent text-transparent caret-blue-500 z-10 focus:outline-none`}
                        style={{ fontFamily: '"Menlo", monospace', fontSize: `${FONT_SIZE}px`, lineHeight: `${ROW_HEIGHT}px`, padding: `${PADDING}px` }}
                    />
                </div>

                {/* Results */}
                <div className={`w-1/2 h-full border-l z-20 flex flex-col ${isDarkMode ? 'bg-[#252526] border-gray-800' : 'bg-gray-50 border-gray-100'}`}>
                    <div ref={resultsRef} className="flex-1 overflow-hidden opacity-90" style={{ fontFamily: '"Menlo", monospace', fontSize: `${FONT_SIZE}px`, padding: `${PADDING}px` }}>
                        {text.split('\n').map((line, index) => {
                            const data = computedResults[index];
                            // If no data, but we are loading and line has content, show skeleton
                            const isPending = loading && !data && line.trim().length > 0;

                            if (!data && !isPending) return <div key={index} className="w-full" style={{ height: `${ROW_HEIGHT}px` }}>&nbsp;</div>;

                            let ResultColor = isDarkMode ? 'text-gray-400' : 'text-gray-600';
                            let ExprColor = isDarkMode ? 'text-gray-500' : 'text-gray-400';
                            let Icon = null;

                            if (data?.type === 'total') { ResultColor = isDarkMode ? 'text-blue-400 font-bold' : 'text-blue-600 font-bold'; Icon = <Sigma className="w-3 h-3 mr-2 opacity-50" />; }
                            else if (data?.type === 'variable') { ResultColor = isDarkMode ? 'text-purple-400 font-medium' : 'text-purple-600 font-medium'; Icon = <Variable className="w-3 h-3 mr-2 opacity-50" />; }

                            // Clean formula for display
                            const displayFormula = data?.formula
                                ? data.formula.replace(/L(\d+)/g, (_, l) => `Line ${parseInt(l) + 1}`).replace(/\*/g, '×').replace(/\//g, '÷')
                                : '';

                            return (
                                <div key={index} className="flex items-center justify-end w-full relative group px-6" style={{ height: `${ROW_HEIGHT}px` }}>

                                    {isPending ? (
                                        <motion.div
                                            initial={{ opacity: 0.3 }}
                                            animate={{ opacity: [0.3, 0.6, 0.3] }}
                                            transition={{ duration: 1.5, repeat: Infinity }}
                                            className="w-24 h-4 rounded bg-gray-200 dark:bg-gray-700"
                                        />
                                    ) : (
                                        <>
                                            {(data.explanation) && (
                                                <div className={`mr-4 flex items-center justify-end text-xs tracking-tight transition-all duration-500 ease-out ${ExprColor} flex-1 min-w-0 opacity-80 sm:opacity-100`}>

                                                    {/* Source Indicator */}
                                                    <div className="mr-2 opacity-50">
                                                        {data.source === 'local' ? <Zap className="w-3 h-3 text-yellow-500" /> : <Cloud className="w-3 h-3 text-blue-400" />}
                                                    </div>

                                                    {/* Label */}
                                                    <span className="truncate opacity-90 font-medium shrink-0">{data.explanation}</span>

                                                    <span className="ml-3 mr-2 opacity-30 shrink-0">=</span>
                                                </div>
                                            )}

                                            {/* Result with Tooltip */}
                                            <div className={`relative flex items-center justify-end shrink-0 ${ResultColor}`}>
                                                {Icon}
                                                <span className="truncate">{data.formatted}</span>

                                                {/* Formula Tooltip */}
                                                {displayFormula && !displayFormula.match(/^[\d.]+$/) && (
                                                    <div className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50">
                                                        <span className="font-mono">{displayFormula}</span>
                                                        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SoulverClone;
