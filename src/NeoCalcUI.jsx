import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Plus, Search, Command, X, FolderOpen, Download,
    LayoutGrid, Settings, FileText, FilePlus, Undo, Redo,
    ChevronRight, Save, MoreVertical, Terminal, Eye, EyeOff,
    Sidebar, PanelRight, Cloud, Zap, Copy, Scissors
} from 'lucide-react';
import { createFile, saveFile, getFile, getAllFiles, renameFile, deleteFile, addLog } from './lib/db';
import SplashScreen from './components/SplashScreen';
import InstallPrompt from './components/InstallPrompt';
import DebugPanel from './components/DebugPanel';

// --- THEME ---
const BG_STYLE = "bg-zinc-950 text-zinc-400 font-mono";
const BORDER_COLOR = "border-zinc-800";
const ACTIVE_TAB_COLOR = "bg-zinc-900 text-zinc-100 border-t-2 border-t-blue-500";
const INACTIVE_TAB_COLOR = "bg-zinc-950 hover:bg-zinc-900 text-zinc-500";

// --- LOCAL LLM CONFIG ---
const LOCAL_API_URL = "http://localhost:8080/v1/chat/completions";

// --- MOCK FILES ---
const MOCK_FILES = [
    {
        id: 1, title: 'Q4_Marketing_Budget.calc', date: '2h ago', size: '12kb', content: `# Q4 Marketing Budget (Draft)

Social Ads: $15,000
Influencer Spend: 5 * $2000
Content Production: $4,500

# Platform Fees
Platform Fee Rate = 15%
Fees = (Social Ads + Influencer Spend) * Platform Fee Rate

Total Marketing Spend` },
    {
        id: 2, title: 'Home_Reno_v2.calc', date: '1d ago', size: '8kb', content: `# Home Renovation

Kitchen = $25,000
Bathroom = $12,000
Flooring = $8,000

Total Cost` },
    {
        id: 3, title: 'Freelance_Rates_2025.calc', date: '3d ago', size: '4kb', content: `# Freelance Rates

Hourly Rate = $150
Hours per Week = 20
Weekly Income = Hourly Rate * Hours per Week
Monthly Income = Weekly Income * 4` },
    {
        id: 4, title: 'Startup_Runway.calc', date: '1w ago', size: '2kb', content: `# Startup Runway

Monthly Burn = $50,000
Cash on Hand = $600,000
Runway = Cash on Hand / Monthly Burn` },
];

// --- SAFE MATH FUNCTIONS ---
const SAFE_FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
    round: (x, d = 0) => { const p = Math.pow(10, d); return Math.round(x * p) / p; },
    floor: Math.floor, ceil: Math.ceil, pow: Math.pow,
};

const NeoCalcUI = () => {
    // --- STATE ---
    const [isLoading, setIsLoading] = useState(true); // Splash screen
    const [view, setView] = useState('editor');
    const [tabs, setTabs] = useState([]);
    const [files, setFiles] = useState([]);
    const [currentFileId, setCurrentFileId] = useState(null);
    const [showSidebar, setShowSidebar] = useState(true);
    const [showDebugPanel, setShowDebugPanel] = useState(false);
    const [text, setText] = useState('');
    const [computedResults, setComputedResults] = useState({});
    const [aiLogic, setAiLogic] = useState({});
    const [loading, setLoading] = useState(false);
    const [serverStatus, setServerStatus] = useState('unknown');
    const [lastInput, setLastInput] = useState(null);
    const [lastOutput, setLastOutput] = useState(null);
    const [activeMenu, setActiveMenu] = useState(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const textareaRef = useRef(null);
    const saveTimeoutRef = useRef(null);
    const ROW_HEIGHT = 32;

    // --- INITIALIZE ---
    useEffect(() => {
        const init = async () => {
            // Load files from IndexedDB
            let dbFiles = await getAllFiles();

            // If no files exist, create a blank file to start
            if (dbFiles.length === 0) {
                await createFile('Untitled.calc', '# New Document\n\n');
                dbFiles = await getAllFiles();
            }

            setFiles(dbFiles);

            // Open first file
            if (dbFiles.length > 0) {
                const firstFile = dbFiles[0];
                setCurrentFileId(firstFile.id);
                setText(firstFile.content);
                setAiLogic(firstFile.aiLogic || {});
                setTabs([{ id: firstFile.id, title: firstFile.title, active: true }]);
            }

            // Hide splash after loading
            setTimeout(() => setIsLoading(false), 800);
        };

        init();
    }, []);

    // --- AUTO-SAVE ---
    useEffect(() => {
        if (!currentFileId || !hasUnsavedChanges) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(async () => {
            await saveFile(currentFileId, text, aiLogic);
            setHasUnsavedChanges(false);
            setFiles(await getAllFiles());
        }, 1000);

        return () => clearTimeout(saveTimeoutRef.current);
    }, [text, currentFileId, hasUnsavedChanges, aiLogic]);

    // Track text changes
    const handleTextChange = (e) => {
        setText(e.target.value);
        setHasUnsavedChanges(true);
    };

    // --- FILE HANDLING ---
    const openFile = async (file) => {
        if (!tabs.find(t => t.id === file.id)) {
            setTabs([...tabs.map(t => ({ ...t, active: false })), { id: file.id, title: file.title, active: true }]);
        } else {
            setTabs(tabs.map(t => ({ ...t, active: t.id === file.id })));
        }
        setCurrentFileId(file.id);
        setText(file.content);
        setAiLogic(file.aiLogic || {});
        setView('editor');
        setActiveMenu(null);
    };

    const closeTab = async (e, id) => {
        e.stopPropagation();
        const newTabs = tabs.filter(t => t.id !== id);
        if (newTabs.length === 0) {
            setView('home');
            setText('');
            setCurrentFileId(null);
        } else {
            newTabs[newTabs.length - 1].active = true;
            const activeFile = files.find(f => f.id === newTabs[newTabs.length - 1].id);
            if (activeFile) {
                setCurrentFileId(activeFile.id);
                setText(activeFile.content);
                setAiLogic(activeFile.aiLogic || {});
            }
        }
        setTabs(newTabs);
    };

    const handleNewFile = async () => {
        const title = `Untitled_${Date.now()}.calc`;
        const id = await createFile(title, '# New Document\n\n');
        const newFile = await getFile(id);
        setFiles(await getAllFiles());
        await openFile(newFile);
        setActiveMenu(null);
    };

    const handleSaveFile = async () => {
        if (currentFileId) {
            await saveFile(currentFileId, text, aiLogic);
            setHasUnsavedChanges(false);
            setFiles(await getAllFiles());
            await addLog('info', 'File saved', { id: currentFileId });
        }
        setActiveMenu(null);
    };

    const handleExportFile = () => {
        const activeTab = tabs.find(t => t.active);
        const filename = activeTab?.title || 'export.calc';
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setActiveMenu(null);
    };

    const handleDeleteFile = async (id) => {
        await deleteFile(id);
        setFiles(await getAllFiles());
        // Close tab if open
        const tabIdx = tabs.findIndex(t => t.id === id);
        if (tabIdx !== -1) {
            closeTab({ stopPropagation: () => { } }, id);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e) => {
            if (e.metaKey || e.ctrlKey) {
                if (e.key === 's') {
                    e.preventDefault();
                    handleSaveFile();
                } else if (e.key === 'n') {
                    e.preventDefault();
                    handleNewFile();
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [currentFileId, text, aiLogic]);

    // --- LOCAL EVALUATION ENGINE ---
    const evaluateDocument = (inputText) => {
        const lines = inputText.split('\n');
        const results = {};
        const variables = {};
        const taggedValues = {};

        const preprocessExpression = (expr) => {
            let s = expr.trim();
            s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
            s = s.replace(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/g, (_, num) => String(num).replace(/,/g, ''));
            s = s.replace(/([0-9]+(?:\.[0-9]+)?)\s*%/g, '($1/100)');
            s = s.replace(/\^/g, '**');
            return s;
        };

        const extractTag = (line) => {
            const m = line.match(/#([A-Za-z][\w-]*)/);
            return m ? m[1].toLowerCase() : null;
        };

        const safeEval = (expr, localVars) => {
            try {
                const fn = new Function(...Object.keys(localVars), ...Object.keys(SAFE_FUNCS), `return (${expr})`);
                return fn(...Object.values(localVars), ...Object.values(SAFE_FUNCS));
            } catch { return null; }
        };

        lines.forEach((rawLine, idx) => {
            const line = rawLine.trim();
            if (!line || line.startsWith('#') || line.startsWith('//')) return;

            const tag = extractTag(rawLine);
            const cleanLine = rawLine.replace(/#([A-Za-z][\w-]*)/g, '').trim();

            // Variable assignment: Name = Expression
            const eqIdx = cleanLine.indexOf('=');
            if (eqIdx > 0) {
                const varName = cleanLine.slice(0, eqIdx).trim();
                const rightSide = preprocessExpression(cleanLine.slice(eqIdx + 1));
                const val = safeEval(rightSide, variables);
                if (val !== null && Number.isFinite(val)) {
                    variables[varName] = val;
                    results[idx] = { value: val, type: 'variable', format: 'number', expression: rightSide };
                    if (tag) taggedValues[tag] = (taggedValues[tag] || 0) + val;
                }
                return;
            }

            // Labeled value: Label: Value
            const colonIdx = cleanLine.indexOf(':');
            if (colonIdx > 0 && !cleanLine.match(/^(sum|tag)\s*:/i)) {
                const label = cleanLine.slice(0, colonIdx).trim();
                const rightSide = preprocessExpression(cleanLine.slice(colonIdx + 1));
                const val = safeEval(rightSide, variables);
                if (val !== null && Number.isFinite(val)) {
                    variables[label] = val;
                    results[idx] = { value: val, type: 'variable', format: 'number', expression: rightSide };
                    if (tag) taggedValues[tag] = (taggedValues[tag] || 0) + val;
                }
                return;
            }

            // Sum by tag: sum: tagname
            const sumMatch = cleanLine.match(/^sum\s*:\s*(\w+)/i);
            if (sumMatch) {
                const tagName = sumMatch[1].toLowerCase();
                const val = taggedValues[tagName] || 0;
                results[idx] = { value: val, type: 'total', format: 'currency', expression: `sum(${tagName})` };
                return;
            }

            // Standalone expression
            const expr = preprocessExpression(cleanLine);
            const val = safeEval(expr, variables);
            if (val !== null && Number.isFinite(val)) {
                results[idx] = { value: val, type: 'calc', format: 'number', expression: expr };
            }
        });

        return results;
    };

    // --- LLM CALL ---
    const callLocalLLM = async (inputText) => {
        if (!inputText.trim()) {
            setAiLogic({});
            setServerStatus('unknown');
            return;
        }
        setLoading(true);
        setServerStatus('connecting...');

        const lineMap = {};
        const variables = {};
        const lines = inputText.split('\n');

        lines.forEach((line, idx) => {
            if (line.trim()) {
                lineMap[idx] = line;
                const eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    const varName = line.slice(0, eqIdx).trim();
                    const numMatch = line.slice(eqIdx + 1).match(/\$?\s*([\d,]+(?:\.\d+)?)/);
                    if (numMatch) {
                        const value = parseFloat(numMatch[1].replace(/,/g, ''));
                        if (!isNaN(value)) variables[varName] = { line: idx, value };
                    }
                }
            }
        });

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
- The "formula" field MUST contain the actual calculation expression, NOT just the variable name.
- For example: "Fees = (Social Ads + Influencer Spend) * Platform Fee Rate" should have formula: "(Social Ads + Influencer Spend) * Platform Fee Rate"
- Return ONLY valid JSON. Use variable names when available.`;

        const llmInput = { lines: lineMap, variables };
        setLastInput(llmInput);

        try {
            const startTime = Date.now();
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
                }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const elapsed = Date.now() - startTime;
            const textResult = data.choices?.[0]?.message?.content;

            setLastOutput({ raw: data, parsed: null, elapsed });

            if (textResult) {
                setServerStatus('connected');
                try {
                    const parsed = JSON.parse(textResult);
                    setAiLogic(parsed);
                    setLastOutput({ raw: data, parsed, elapsed });
                    setHasUnsavedChanges(true); // Mark as changed to save AI logic
                    await addLog('llm', `Response in ${elapsed}ms`, { input: llmInput, output: parsed });
                } catch (e) {
                    await addLog('error', 'JSON parse error', { error: e.message, raw: textResult });
                }
            }
        } catch (err) {
            setServerStatus('error');
            setLastOutput({ error: err.message });
            await addLog('error', 'LLM request failed', { error: err.message });
        } finally {
            setLoading(false);
        }
    };

    // --- ORCHESTRATOR: Merge local + AI results ---
    useEffect(() => {
        const localResults = evaluateDocument(text);
        const lines = text.split('\n');
        const finalResults = {};
        const currentValues = {};

        // First pass: collect local values
        Object.keys(localResults).forEach(k => {
            currentValues[k] = localResults[k].value;
        });

        // Build variable lookup from local results
        const variableValues = {};
        lines.forEach((line, idx) => {
            if (localResults[idx]) {
                const eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                    const varName = line.slice(0, eqIdx).trim();
                    variableValues[varName] = localResults[idx].value;
                }
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0 && !line.match(/^(sum|tag)\s*:/i)) {
                    const label = line.slice(0, colonIdx).trim();
                    variableValues[label] = localResults[idx].value;
                }
            }
        });

        lines.forEach((_, idx) => {
            // Case A: Local result takes priority
            if (localResults[idx]) {
                finalResults[idx] = {
                    ...localResults[idx],
                    source: 'local'
                };
                return;
            }

            // Case B: Try AI logic (same as App.jsx)
            const aiItem = aiLogic[idx];
            if (aiItem) {
                console.log(`AI Item for line ${idx}:`, aiItem);
                try {
                    // Handle header/note types first
                    if (aiItem.type === 'header' || aiItem.type === 'note') {
                        finalResults[idx] = {
                            value: null,
                            formatted: '',
                            type: aiItem.type,
                            explanation: aiItem.explanation,
                            formula: '',
                            source: 'ai'
                        };
                        return;
                    }

                    // Get parsable formula - could be in formula or value field
                    let parsable = aiItem.formula || '';
                    const aiValue = aiItem.value;

                    // If value is a string with operators, use it as formula
                    if (typeof aiValue === 'string' && /[+\-*/()]/.test(aiValue)) {
                        parsable = aiValue;
                    } else if (typeof aiValue === 'number') {
                        // Direct numeric value from AI
                        finalResults[idx] = {
                            value: aiValue,
                            type: aiItem.type || 'variable',
                            format: aiItem.format || 'number',
                            expression: aiItem.formula,
                            explanation: aiItem.explanation,
                            source: 'ai'
                        };
                        currentValues[idx] = aiValue;
                        if (aiItem.formula) variableValues[aiItem.formula] = aiValue;
                        return;
                    }

                    if (!parsable) return;

                    // If formula contains "=", take only the right side (the expression)
                    if (parsable.includes('=')) {
                        const eqIdx = parsable.indexOf('=');
                        parsable = parsable.slice(eqIdx + 1).trim();
                    }

                    // Handle variable type - show explanation only
                    if (parsable.toLowerCase() === 'variable' || parsable.toLowerCase() === 'header' || parsable.toLowerCase() === 'note') {
                        if (aiItem.explanation) {
                            finalResults[idx] = {
                                value: null,
                                type: aiItem.type,
                                explanation: aiItem.explanation,
                                source: 'ai'
                            };
                        }
                        return;
                    }

                    // Replace variable names with their values (sort by length to avoid partial matches)
                    const sortedVarNames = Object.keys(variableValues).sort((a, b) => b.length - a.length);
                    for (const varName of sortedVarNames) {
                        const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(escaped, 'gi');
                        parsable = parsable.replace(regex, variableValues[varName]);
                    }

                    // Handle L{prev} - replace with previous line's value
                    parsable = parsable.replace(/L\{prev\}/gi, () => {
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

                    // Handle sum(tag)
                    parsable = parsable.replace(/sum\((\w+)\)/gi, (_, tag) => 0);

                    // Handle math functions
                    parsable = parsable.replace(/sqrt\(([^)]+)\)/gi, (_, arg) => `Math.sqrt(${arg})`);
                    parsable = parsable.replace(/round\(([^,]+),\s*(\d+)\)/gi, (_, num, dec) => `(Math.round(${num} * Math.pow(10, ${dec})) / Math.pow(10, ${dec}))`);
                    parsable = parsable.replace(/max\(([^)]+)\)/gi, (_, args) => `Math.max(${args})`);
                    parsable = parsable.replace(/min\(([^)]+)\)/gi, (_, args) => `Math.min(${args})`);

                    // Skip if formula is empty
                    if (!parsable || parsable === '' || parsable === '0') {
                        return;
                    }

                    const val = new Function(`return (${parsable})`)();

                    if (Number.isFinite(val)) {
                        finalResults[idx] = {
                            value: val,
                            type: aiItem.type || 'calc',
                            format: aiItem.format || 'number',
                            expression: aiItem.formula,
                            explanation: aiItem.explanation,
                            source: 'ai'
                        };
                        currentValues[idx] = val;

                        // Add computed result to variableValues for later formulas
                        const originalFormula = aiItem.formula;
                        if (originalFormula.includes('=')) {
                            const computedVarName = originalFormula.slice(0, originalFormula.indexOf('=')).trim();
                            if (computedVarName) {
                                variableValues[computedVarName] = val;
                            }
                        }
                    }
                } catch (e) {
                    console.log('Parse error for line', idx, ':', e.message);
                }
            }
        });

        setComputedResults(finalResults);
    }, [text, aiLogic]);

    useEffect(() => {
        const timer = setTimeout(() => callLocalLLM(text), 800);
        return () => clearTimeout(timer);
    }, [text]);

    // --- FORMAT VALUE ---
    const formatValue = (val, format) => {
        if (!Number.isFinite(val)) return '';
        if (format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
        if (format === 'percent') return (val * 100).toFixed(1) + '%';
        return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    const lines = text.split('\n');

    return (
        <div className={`h-screen w-full ${BG_STYLE} flex flex-col overflow-hidden`}>
            {/* Splash Screen */}
            <SplashScreen isLoading={isLoading} />

            {/* Install Prompt */}
            <InstallPrompt />

            {/* Debug Panel */}
            <DebugPanel
                isOpen={showDebugPanel}
                onClose={() => setShowDebugPanel(false)}
                serverStatus={serverStatus}
                lastInput={lastInput}
                lastOutput={lastOutput}
            />

            {/* --- STATUS BAR / MENU --- */}
            <header className={`h-10 flex-none flex items-center px-3 gap-4 border-b ${BORDER_COLOR} bg-zinc-950 text-xs relative z-50`}>
                <div className="flex items-center gap-2 text-zinc-100 font-bold tracking-tight">
                    <div className="w-4 h-4 bg-blue-600 flex items-center justify-center rounded-sm">
                        <span className="text-[10px] text-white font-mono">Σ</span>
                    </div>
                    <span>NeoCalc</span>
                    {hasUnsavedChanges && <span className="text-yellow-500">●</span>}
                </div>

                <div className="h-4 w-[1px] bg-zinc-800 mx-2"></div>

                {/* File Menu */}
                <div className="relative">
                    <button
                        onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
                        className={`px-2 py-1 rounded hover:bg-zinc-800 transition-colors ${activeMenu === 'file' ? 'bg-zinc-800 text-zinc-100' : ''}`}
                    >
                        File
                    </button>
                    {activeMenu === 'file' && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1">
                            <button onClick={handleNewFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <FilePlus className="w-3.5 h-3.5" /> New File <span className="ml-auto text-zinc-600">⌘N</span>
                            </button>
                            <button onClick={handleSaveFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Save className="w-3.5 h-3.5" /> Save <span className="ml-auto text-zinc-600">⌘S</span>
                            </button>
                            <button onClick={handleExportFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Download className="w-3.5 h-3.5" /> Export
                            </button>
                            <div className="border-t border-zinc-800 my-1"></div>
                            <a href="/" className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left block">
                                Classic UI
                            </a>
                        </div>
                    )}
                </div>

                {/* Edit Menu */}
                <div className="relative">
                    <button
                        onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
                        className={`px-2 py-1 rounded hover:bg-zinc-800 transition-colors ${activeMenu === 'edit' ? 'bg-zinc-800 text-zinc-100' : ''}`}
                    >
                        Edit
                    </button>
                    {activeMenu === 'edit' && (
                        <div className="absolute top-full left-0 mt-1 w-44 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1">
                            <button onClick={() => { document.execCommand('undo'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Undo className="w-3.5 h-3.5" /> Undo <span className="ml-auto text-zinc-600">⌘Z</span>
                            </button>
                            <button onClick={() => { document.execCommand('redo'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Redo className="w-3.5 h-3.5" /> Redo <span className="ml-auto text-zinc-600">⇧⌘Z</span>
                            </button>
                            <div className="border-t border-zinc-800 my-1"></div>
                            <button onClick={() => { document.execCommand('cut'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Scissors className="w-3.5 h-3.5" /> Cut <span className="ml-auto text-zinc-600">⌘X</span>
                            </button>
                            <button onClick={() => { document.execCommand('copy'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Copy className="w-3.5 h-3.5" /> Copy <span className="ml-auto text-zinc-600">⌘C</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* View Menu */}
                <div className="relative">
                    <button
                        onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
                        className={`px-2 py-1 rounded hover:bg-zinc-800 transition-colors ${activeMenu === 'view' ? 'bg-zinc-800 text-zinc-100' : ''}`}
                    >
                        View
                    </button>
                    {activeMenu === 'view' && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1">
                            <button onClick={() => { setShowSidebar(!showSidebar); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                {showSidebar ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                {showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
                            </button>
                            <button onClick={() => { setShowDebugPanel(!showDebugPanel); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-800 text-left">
                                <Terminal className="w-3.5 h-3.5" />
                                {showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1" onClick={() => setActiveMenu(null)}></div>

                <div className="flex items-center gap-3 text-zinc-500">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800">
                        <Command className="w-3 h-3" />
                        <span>P</span>
                    </div>
                    <span>v2.1.0</span>
                </div>
            </header>

            {/* --- MAIN CONTENT --- */}
            <div className="flex-1 flex overflow-hidden">

                {/* SIDEBAR (Explorer) */}
                {showSidebar && (
                    <aside className={`w-64 flex-none border-r ${BORDER_COLOR} bg-zinc-950 flex flex-col`}>
                        <div className="p-3 text-xs font-bold uppercase tracking-wider text-zinc-500 flex justify-between items-center">
                            <span>Explorer</span>
                            <button onClick={handleNewFile} className="hover:text-blue-500 transition-colors">
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto py-2">
                            {files.map(file => (
                                <div
                                    key={file.id}
                                    onClick={() => openFile(file)}
                                    className={`px-3 py-1.5 flex items-center gap-2 cursor-pointer text-sm group ${currentFileId === file.id ? 'bg-zinc-900 text-zinc-100' : 'hover:bg-zinc-900'}`}
                                >
                                    <FileText className={`w-3.5 h-3.5 ${currentFileId === file.id ? 'text-blue-500' : 'text-zinc-600 group-hover:text-blue-500'}`} />
                                    <span className="truncate flex-1 group-hover:text-zinc-200 transition-colors">{file.title}</span>
                                    <span className="text-[10px] text-zinc-700">
                                        {new Date(file.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </aside>
                )}

                {/* EDITOR AREA */}
                <main className="flex-1 flex flex-col min-w-0 bg-zinc-900/50">

                    {/* TAB BAR */}
                    <div className={`flex items-center border-b ${BORDER_COLOR} bg-zinc-950 overflow-x-auto no-scrollbar`}>
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                onClick={() => {
                                    setTabs(tabs.map(t => ({ ...t, active: t.id === tab.id })));
                                    const file = MOCK_FILES.find(f => f.id === tab.id);
                                    if (file) setText(file.content);
                                }}
                                className={`
                  flex items-center gap-2 px-4 h-9 text-xs border-r ${BORDER_COLOR} cursor-pointer select-none min-w-[140px] max-w-[200px]
                  ${tab.active ? ACTIVE_TAB_COLOR : INACTIVE_TAB_COLOR}
                `}
                            >
                                <span className="truncate flex-1">{tab.title}</span>
                                <button onClick={(e) => closeTab(e, tab.id)} className="hover:bg-white/10 rounded p-0.5">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        <button className="h-9 w-9 flex items-center justify-center hover:bg-zinc-900 text-zinc-500">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* SPLIT EDITOR */}
                    {view === 'editor' ? (
                        <div className="flex-1 flex overflow-hidden">

                            {/* LEFT: INPUT */}
                            <div className="flex-1 relative group bg-zinc-950">
                                <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-zinc-800 bg-zinc-950 text-zinc-600 text-xs text-right pr-3 pt-4 select-none leading-[32px]">
                                    {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
                                </div>
                                <textarea
                                    ref={textareaRef}
                                    value={text}
                                    onChange={handleTextChange}
                                    className="w-full h-full bg-transparent border-none outline-none resize-none pl-16 pr-4 py-4 font-mono text-sm leading-[32px] text-zinc-300 caret-blue-500 placeholder-zinc-700"
                                    spellCheck="false"
                                    autoFocus
                                />
                            </div>

                            {/* RIGHT: OUTPUT */}
                            <div className={`w-[400px] flex-none border-l ${BORDER_COLOR} bg-[#0c0c0e]`}>
                                <div className="h-full flex flex-col pt-4 px-4 text-sm leading-[32px] font-mono text-right overflow-y-auto">
                                    {lines.map((line, idx) => {
                                        const data = computedResults[idx];
                                        const trimmed = line.trim();

                                        // Markdown Header line
                                        if (trimmed.startsWith('#')) {
                                            const level = (trimmed.match(/^#+/) || [''])[0].length;
                                            const headerText = trimmed.replace(/^#+\s*/, '');
                                            return (
                                                <div key={idx} className={`h-[32px] flex items-center justify-end text-zinc-500 select-none truncate ${level === 1 ? 'font-bold text-zinc-400' :
                                                    level === 2 ? 'font-semibold text-zinc-500' : 'text-zinc-600'
                                                    }`}>
                                                    {headerText}
                                                </div>
                                            );
                                        }

                                        // Comment line
                                        if (trimmed.startsWith('//')) {
                                            return (
                                                <div key={idx} className="h-[32px] text-zinc-700 italic opacity-50 select-none truncate">
                                                    {trimmed.slice(2).trim()}
                                                </div>
                                            );
                                        }

                                        // Empty line
                                        if (!trimmed) {
                                            return <div key={idx} className="h-[32px]"></div>;
                                        }

                                        // Loading state
                                        if (loading && !data) {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end">
                                                    <div className="w-16 h-3 bg-zinc-800 rounded animate-pulse"></div>
                                                </div>
                                            );
                                        }

                                        // No result yet - show waiting for AI
                                        if (!data) {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-700 text-xs">
                                                    {loading ? <div className="w-16 h-3 bg-zinc-800 rounded animate-pulse"></div> : '—'}
                                                </div>
                                            );
                                        }

                                        // AI header/note with no value
                                        if (data.type === 'header' || data.type === 'note') {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-500 text-xs italic truncate">
                                                    {data.explanation || '—'}
                                                </div>
                                            );
                                        }

                                        // Calculated result
                                        const isTotal = data.type === 'total' || trimmed.toLowerCase().includes('total');
                                        const isVar = data.type === 'variable';
                                        const isAI = data.source === 'ai';

                                        return (
                                            <div
                                                key={idx}
                                                className={`h-[32px] flex items-center justify-end gap-2 group ${isTotal ? 'border-t border-blue-500/30 bg-blue-500/5 -mx-4 px-4' : ''}`}
                                            >
                                                {/* Source indicator */}
                                                <span className="text-[10px] opacity-40 mr-1">
                                                    {isAI ? <Cloud className="w-3 h-3 inline text-blue-400" /> : <Zap className="w-3 h-3 inline text-yellow-500" />}
                                                </span>

                                                {/* Explanation or expression */}
                                                {(data.explanation || data.expression) && data.expression !== String(data.value) && (
                                                    <span className="text-zinc-600 text-xs truncate max-w-[180px]">
                                                        {data.explanation || data.expression?.replace(/\*/g, '×').replace(/\//g, '÷')} =
                                                    </span>
                                                )}

                                                {isVar && <span className="text-purple-400 text-xs">var</span>}

                                                <span className={`font-bold ${isTotal ? 'text-blue-500 text-lg' : isVar ? 'text-zinc-100' : 'text-blue-400'}`}>
                                                    {formatValue(data.value, data.format || 'currency')}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                        </div>
                    ) : (
                        // EMPTY STATE / HOME
                        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
                            <div className="w-16 h-16 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
                                <LayoutGrid className="w-8 h-8 opacity-50" />
                            </div>
                            <p className="text-sm">No file open</p>
                            <p className="text-xs mt-2 opacity-50">Click a file to open it</p>
                        </div>
                    )}

                    {/* FOOTER */}
                    <div className={`h-8 flex-none border-t ${BORDER_COLOR} bg-zinc-950 flex items-center px-3 gap-4 text-[10px] text-zinc-500 uppercase tracking-wider`}>
                        <div
                            className="flex items-center gap-2 hover:text-zinc-300 cursor-pointer"
                            onClick={() => setShowSidebar(!showSidebar)}
                        >
                            <Sidebar className="w-3 h-3" />
                            <span>{showSidebar ? 'Hide' : 'Show'} Sidebar</span>
                        </div>

                        <div className="flex-1"></div>

                        <div
                            className="flex items-center gap-2 cursor-pointer hover:text-zinc-200"
                            onClick={() => setShowDebugPanel(!showDebugPanel)}
                        >
                            <span className={`w-2 h-2 rounded-full ${serverStatus === 'connected' ? 'bg-green-500' : serverStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`}></span>
                            <span>Local Engine</span>
                        </div>
                        <div
                            className="flex items-center gap-2 cursor-pointer hover:text-zinc-200"
                            onClick={() => setShowDebugPanel(!showDebugPanel)}
                        >
                            <Cloud className="w-3 h-3" />
                            <span>{loading ? 'Processing...' : 'AI Ready'}</span>
                        </div>
                        <div>Ln {lines.length}</div>
                        <div>UTF-8</div>
                    </div>

                </main>
            </div>
        </div>
    );
};

export default NeoCalcUI;
