import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RefreshCcw, Moon, Sun, Calculator, Variable, Sigma, Server, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import 'react-grab'; // Import as side-effect to trigger auto-init

/* --- LOCAL LLM CONFIGURATION --- 
   Ensure your local server is running.
   Example: ./llama-server -m model.gguf --port 8080 -c 4096
*/
const LOCAL_API_URL = "http://localhost:8080/v1/chat/completions";

const SoulverClone = () => {
    // --- STATE ---
    const [text, setText] = useState('Trip Budget 🇯🇵\n\nFlight: $1,200\nHotel: $900 (1 night)\nRuba, Aadithya, and Nidhi are going\n\nSplit evenly per person');

    // aiLogic: The "Blueprint" returned by the LLM. Maps lineIndex -> { formula, type, format }
    const [aiLogic, setAiLogic] = useState({});

    // computedResults: The final calculated values. Maps lineIndex -> { value, formatted, expression }
    const [computedResults, setComputedResults] = useState({});

    const [loading, setLoading] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [serverStatus, setServerStatus] = useState('unknown'); // 'connected', 'error', 'unknown'

    // --- REFS ---
    const textareaRef = useRef(null);
    const resultsRef = useRef(null);
    const highlightRef = useRef(null);

    // --- API LOGIC (LOCAL LLM) ---
    const callLocalLLM = async (inputText) => {
        if (!inputText.trim()) {
            setAiLogic({});
            return;
        }

        // Convert raw text to line-indexed JSON
        const lines = inputText.split('\n');
        const inputMap = {};
        lines.forEach((line, index) => {
            if (line.trim()) {
                inputMap[index.toString()] = line;
            }
        });

        setLoading(true);
        setServerStatus('unknown');

        const systemPrompt = `
      You are a Logic Extraction Engine. Do NOT calculate the final answers. 
      Your job is to translate natural language into JavaScript-evaluable formulas.

      INPUT: JSON object where keys are 0-indexed line numbers and values are the text lines.
      OUTPUT: JSON object where keys are the SAME 0-indexed line numbers.

      JSON SCHEMA per line:
      {
        "formula": "Math expression string. Use 'L{n}' to refer to the result of line n (e.g. 'L0 + L1'). Use javascript math (Math.pow, etc)",
        "type": "value" | "calc" | "total" | "variable",
        "format": "currency" | "number" | "percent",
        "explanation": "Brief natural language explanation of the logic (e.g. 'Sum of expenses', 'Split per person', 'Rent cost')"
      }

      RULES:
      1. **Strict Indexing**: If input has key "5", output logic MUST be at key "5". Do not shift lines.
      2. **Extraction**: If a line says "Flight $1200", formula is "1200", explanation is "Flight cost".
      3. **Implicit Values**: If a line says "Tax is 5%", formula is "0.05", explanation is "Tax rate". Extract numbers even if implicit.
      4. **Counting**: If a line lists items or names (e.g. "Ruba, Aadithya, and Nidhi"), formula is the count (e.g. "3").
      5. **Logic**: If a line says "3 people * $50", formula is "3 * 50", explanation is "3 people × $50".
      5. **References**: If line 2 says "Total", and lines 0 and 1 are numbers, formula is "L0 + L1", explanation is "Sum of above".
      6. **Splitting**: If line 3 says "Split by 3", formula is "L2 / 3", explanation is "Split by 3 people".
      7. **Safety**: Return ONLY the JSON. No Markdown.

      EXAMPLE INPUT:
      {
        "0": "Salary $5000",
        "1": "Rent $1200",
        "2": "Leftover"
      }

      EXAMPLE OUTPUT:
      {
        "0": { "formula": "5000", "type": "value", "format": "currency", "explanation": "Salary income" },
        "1": { "formula": "1200", "type": "variable", "format": "currency", "explanation": "Rent deduction" },
        "2": { "formula": "L0 - L1", "type": "calc", "format": "currency", "explanation": "Net remaining" }
      }
    `;

        try {
            const response = await fetch(LOCAL_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: JSON.stringify(inputMap) }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }),
            });

            if (!response.ok) {
                throw new Error("Local Server Error");
            }

            const data = await response.json();
            const textResult = data.choices?.[0]?.message?.content;

            if (textResult) {
                setServerStatus('connected');
                const jsonResult = JSON.parse(textResult);
                setAiLogic(jsonResult);
            }
        } catch (err) {
            console.error("LLM API Error:", err);
            setServerStatus('error');
        } finally {
            setLoading(false);
        }
    };

    // --- CALCULATION ENGINE (CLIENT SIDE) ---
    // This runs whenever aiLogic updates. It computes the actual numbers.
    useEffect(() => {
        const results = {};
        const lineIndices = Object.keys(aiLogic).sort((a, b) => parseInt(a) - parseInt(b));

        lineIndices.forEach(idx => {
            const item = aiLogic[idx];
            let val = 0;

            try {
                // Replace L{n} with actual values from previous lines
                const parsableFormula = item.formula.replace(/L(\d+)/g, (match, lineNum) => {
                    const refVal = results[lineNum]?.value;
                    return refVal !== undefined ? refVal : 0;
                });

                // Safe evaluation
                // eslint-disable-next-line no-new-func
                val = new Function(`return (${parsableFormula})`)();

                // Formatting
                let formatted = val;
                if (typeof val === 'number') {
                    if (item.format === 'currency') {
                        formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
                    } else if (item.format === 'percent') {
                        formatted = val + '%';
                    } else {
                        formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(val);
                    }
                }

                results[idx] = {
                    value: val,
                    formatted: formatted,
                    type: item.type,
                    expression: item.formula, // Store the raw formula
                    explanation: item.explanation // Store the human explanation
                };

            } catch (e) {
                console.warn(`Error evaluating line ${idx}:`, e);
                results[idx] = { value: 0, formatted: "Error", type: "error", expression: "Invalid Logic", explanation: "Error" };
            }
        });

        setComputedResults(results);
    }, [aiLogic]);

    // Debounce API calls - Reduced to 500ms for "live" feel
    useEffect(() => {
        const timer = setTimeout(() => {
            callLocalLLM(text);
        }, 500);
        return () => clearTimeout(timer);
    }, [text]);

    // --- SCROLL SYNC ---
    const handleScroll = (e) => {
        const scrollTop = e.target.scrollTop;
        if (resultsRef.current) resultsRef.current.scrollTop = scrollTop;
        if (highlightRef.current) highlightRef.current.scrollTop = scrollTop;
        if (highlightRef.current) highlightRef.current.scrollLeft = e.target.scrollLeft;
    };

    // --- SYNTAX HIGHLIGHTING ---
    const getHighlightedText = (content) => {
        let safeText = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Slightly richer highlighting
        safeText = safeText.replace(/(\d{1,3}(,\d{3})*(\.\d+)?)/g, '%%%NUM%%%$1%%%END%%%');
        safeText = safeText.replace(/(\$|€|£|¥|₹)/g, '%%%CUR%%%$1%%%END%%%');
        safeText = safeText.replace(/(\+|\-|\*|\/|=)/g, '%%%OP%%%$1%%%END%%%');
        safeText = safeText.replace(/\b(Total|Sum|Budget|Cost|Split|Per person|remaining|left|plus|minus|times|divided)\b/gi, '%%%KEY%%%$1%%%END%%%');

        safeText = safeText
            .replace(/%%%NUM%%%/g, '<span class="text-blue-500 font-bold">')
            .replace(/%%%CUR%%%/g, '<span class="text-green-600 font-bold">')
            .replace(/%%%OP%%%/g, '<span class="text-purple-400 font-bold">')
            .replace(/%%%KEY%%%/g, '<span class="text-orange-500 font-semibold">')
            .replace(/%%%END%%%/g, '</span>');

        return safeText + '<br>';
    };

    const lines = text.split('\n');

    // CONSTANTS for alignment
    const ROW_HEIGHT = 40; // Increased for comfort
    const FONT_SIZE = '16px';

    return (
        <div className={`flex flex-col h-screen w-full transition-colors duration-500 font-sans tracking-tight ${isDarkMode ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'}`}>

            {/* --- HEADER --- */}
            <header className={`flex-none h-14 flex items-center justify-between px-6 border-b z-30 transition-colors ${isDarkMode ? 'border-zinc-800 bg-zinc-900/50 backdrop-blur' : 'border-zinc-100 bg-white/80 backdrop-blur'}`}>
                <div className="flex items-center gap-2.5 group cursor-default">
                    <div className={`p-2 rounded-xl transition-all ${isDarkMode ? 'bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20' : 'bg-blue-50 text-blue-600 group-hover:bg-blue-100'}`}>
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-semibold text-sm leading-tight">Smart Sheet</span>
                        <span className="text-[10px] opacity-50 font-medium leading-tight">Local Intelligence</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {serverStatus === 'error' && (
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 text-xs font-medium animate-pulse">
                            <Server className="w-3 h-3" />
                            <span>Check Server (:8080)</span>
                        </div>
                    )}

                    {loading && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-500 text-xs font-medium">
                            <RefreshCcw className="w-3 h-3 animate-spin" />
                            <span className="hidden sm:inline">Processing...</span>
                        </div>
                    )}

                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className={`p-2 rounded-lg transition-all active:scale-95 ${isDarkMode ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'}`}
                    >
                        {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                </div>
            </header>

            {/* --- MAIN EDITOR AREA --- */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* LINE NUMBERS GUTTER */}
                <div className={`w-12 flex-none pt-6 text-right pr-4 select-none text-xs font-mono opacity-30 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'} bg-transparent transition-colors z-20`}>
                    {lines.map((_, i) => (
                        <div key={i} style={{ height: `${ROW_HEIGHT}px`, lineHeight: `${ROW_HEIGHT}px` }}>{i + 1}</div>
                    ))}
                </div>

                {/* LEFT COLUMN: Input */}
                <div className="flex-1 relative h-full group">
                    {/* Syntax Highlighter Layer */}
                    <pre
                        ref={highlightRef}
                        className={`absolute inset-0 pl-2 pr-6 pt-6 m-0 overflow-hidden whitespace-pre pointer-events-none z-0 ${isDarkMode ? 'text-zinc-300' : 'text-zinc-800'}`}
                        style={{
                            fontFamily: '"Menlo", "Consolas", monospace',
                            fontSize: FONT_SIZE,
                            lineHeight: `${ROW_HEIGHT}px`
                        }}
                        dangerouslySetInnerHTML={{ __html: getHighlightedText(text) }}
                    />

                    {/* Editable Textarea Layer */}
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onScroll={handleScroll}
                        spellCheck="false"
                        autoCorrect="off"
                        autoCapitalize="off"
                        className={`absolute inset-0 w-full h-full pl-2 pr-6 pt-6 m-0 overflow-auto whitespace-pre resize-none bg-transparent text-transparent caret-blue-500 z-10 focus:outline-none selection:bg-blue-500/20`}
                        style={{
                            fontFamily: '"Menlo", "Consolas", monospace',
                            fontSize: FONT_SIZE,
                            lineHeight: `${ROW_HEIGHT}px`
                        }}
                        placeholder="Type your math here..."
                    />
                </div>

                {/* DRAGGABLE GUTTER (Visual only for now) */}
                <div className={`w-px h-full z-20 ${isDarkMode ? 'bg-zinc-800' : 'bg-zinc-100'}`} />

                {/* RIGHT COLUMN: Results & Logic */}
                <div
                    className={`w-[40%] h-full z-20 flex flex-col transition-colors ${isDarkMode ? 'bg-zinc-900/50' : 'bg-zinc-50/50'}`}
                >
                    <div
                        ref={resultsRef}
                        className="flex-1 overflow-hidden pt-6 pl-4 pr-6 text-right opacity-90"
                    >
                        {lines.map((_, index) => {
                            const data = computedResults[index];
                            const isWaiting = loading && !data;

                            // Empty placeholder row
                            if (!data) {
                                return (
                                    <div key={index} className="flex items-center justify-end" style={{ height: `${ROW_HEIGHT}px` }}>
                                        {isWaiting && index < lines.length && lines[index].trim() && (
                                            <div className="h-2 w-12 bg-zinc-200 dark:bg-zinc-700/50 rounded-full animate-pulse" />
                                        )}
                                    </div>
                                );
                            }

                            // Logic for styling
                            let ResultColor = isDarkMode ? 'text-zinc-400' : 'text-zinc-500';
                            let Icon = null;

                            if (data.type === 'total') {
                                ResultColor = isDarkMode ? 'text-blue-400 font-bold text-lg' : 'text-blue-600 font-bold text-lg';
                                Icon = <Sigma className="w-3.5 h-3.5 mr-1.5 opacity-60" />;
                            }
                            else if (data.type === 'variable') {
                                ResultColor = isDarkMode ? 'text-purple-400 font-medium' : 'text-purple-600 font-medium';
                                Icon = <Variable className="w-3.5 h-3.5 mr-1.5 opacity-60" />;
                            }
                            else if (data.type === 'calc') {
                                ResultColor = isDarkMode ? 'text-green-400 font-semibold' : 'text-green-600 font-semibold';
                            }

                            // Format Formula
                            const friendlyExpression = data.expression
                                .replace(/L(\d+)/g, (_, line) => `Line ${parseInt(line) + 1}`)
                                .replace(/\*/g, '×')
                                .replace(/\//g, '÷');

                            return (
                                <div key={index} className="flex items-center justify-end group/row relative w-full" style={{ height: `${ROW_HEIGHT}px` }}>

                                    {/* Logic Explanation / Formula Preview */}
                                    <AnimatePresence>
                                        {(data.explanation || (data.expression && !data.expression.match(/^[\d.]+$/))) && (
                                            <motion.div
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0 }}
                                                className={`mr-4 flex items-center justify-end text-xs tracking-tight ${isDarkMode ? 'text-zinc-600' : 'text-zinc-400'} flex-1 min-w-0`}
                                            >
                                                {/* Explanation */}
                                                {data.explanation && (
                                                    <span className="font-medium truncate shrink-0 max-w-[140px] hidden xl:inline-block">{data.explanation}</span>
                                                )}

                                                {/* Formula */}
                                                {data.expression && !data.expression.match(/^[\d.]+$/) && (
                                                    <>
                                                        {data.explanation && <span className="mx-2 opacity-20 shrink-0">|</span>}
                                                        <span className="font-mono opacity-70 truncate max-w-[300px] xl:max-w-none">{friendlyExpression}</span>
                                                    </>
                                                )}

                                                <span className="ml-3 opacity-20 shrink-0 select-none">=</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Calculated Result */}
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className={`flex items-center justify-end ${ResultColor} ${data.type === 'total' ? 'scale-110 origin-right' : ''} shrink-0`}
                                    >
                                        {Icon}
                                        <span className="truncate tabular-nums tracking-normal">{data.formatted}</span>
                                    </motion.div>

                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* --- FOOTER --- */}
            <div className={`px-6 py-2 text-[10px] border-t flex justify-between uppercase tracking-widest font-semibold ${isDarkMode ? 'bg-[#1e1e1e] border-zinc-800 text-zinc-600' : 'bg-white border-zinc-50 text-zinc-300'}`}>
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${serverStatus === 'connected' ? 'bg-green-500' : serverStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                    <span>Llama Engine Active</span>
                </div>

            </div>

        </div>
    );
};

export default SoulverClone;
