/**
 * DebugPanel Component
 * 
 * A collapsible panel that displays debugging information for the LLM integration.
 * Features:
 * - Taller view (600px)
 * - Syntax highlighted JSON
 * - Collapsible Request/Response sections
 * - Auto-scroll to new logs
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Copy, ChevronDown, ChevronRight, Zap, Cloud, AlertCircle, CheckCircle, Maximize2, Minimize2, Check } from 'lucide-react';
import { getLogs, clearLogs } from '../lib/db';

/**
 * Simple JSON Syntax Highlighter
 */
const SyntaxHighlight = ({ data }) => {
    if (data === undefined || data === null) return <span className="text-zinc-500">null</span>;

    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    // Regex to tokenise JSON
    const html = jsonStr.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'text-orange-400 dark:text-orange-300'; // number
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'text-blue-500 dark:text-blue-400 font-semibold'; // key
            } else {
                cls = 'text-green-600 dark:text-green-400'; // string
            }
        } else if (/true|false/.test(match)) {
            cls = 'text-purple-600 dark:text-purple-400 font-semibold'; // boolean
        } else if (/null/.test(match)) {
            cls = 'text-zinc-500 italic'; // null
        }
        // Escape content
        const content = match;
        return `<span class="${cls}">${content}</span>`;
    });

    return <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} />;
};

const Section = ({ title, icon, data, colorClass, defaultOpen = true, onCopy }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (!data) return null;

    return (
        <div className={`mb-4 rounded-lg border ${colorClass} bg-opacity-5 overflow-hidden`}>
            <div
                className={`flex items-center justify-between px-3 py-2 cursor-pointer bg-opacity-10 border-b ${colorClass} hover:bg-opacity-20 transition-colors`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2 font-medium text-xs uppercase tracking-wide">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {icon}
                    {title}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onCopy(data); }}
                    className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-colors"
                    title="Copy JSON"
                >
                    <Copy className="w-3.5 h-3.5" />
                </button>
            </div>

            {isOpen && (
                <div className="p-3 bg-white/50 dark:bg-black/20 overflow-x-auto max-h-[300px]">
                    <SyntaxHighlight data={data} />
                </div>
            )}
        </div>
    );
};

const DebugPanel = ({ isOpen, onClose, serverStatus, lastInput, lastOutput, computedResults }) => {
    const [logs, setLogs] = useState([]);
    const [expandedLogs, setExpandedLogs] = useState({});
    const logsEndRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [copyStatus, setCopyStatus] = useState('idle'); // 'idle' | 'copied'

    useEffect(() => {
        if (isOpen) {
            loadLogs();
        }
    }, [isOpen]);

    // Auto-scroll logic
    useEffect(() => {
        if (isOpen && autoScroll && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, isOpen, lastInput, lastOutput, autoScroll]);

    const loadLogs = async () => {
        const dbLogs = await getLogs(100); // Increased limit
        setLogs(dbLogs);
    };

    const handleClear = async () => {
        await clearLogs();
        setLogs([]);
    };

    const handleCopy = async (data) => {
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Copy failed:', err);
            // Fallback
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    };

    const toggleLogExpand = (id) => {
        setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
            fractionalSecondDigits: 3
        });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ y: 600, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 600, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed bottom-0 left-0 right-0 h-[600px] bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 z-40 flex flex-col font-mono text-xs shadow-2xl"
                >
                    {/* Header */}
                    <div className="h-10 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
                        <div className="flex items-center gap-4">
                            <span className="font-bold text-zinc-700 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                                <Terminal className="w-4 h-4" /> Debug Console
                            </span>

                            {/* Status Badge */}
                            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${serverStatus === 'connected' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' :
                                serverStatus === 'error' ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' :
                                    'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800'
                                }`}>
                                {serverStatus === 'connected' ? <CheckCircle className="w-3 h-3" /> :
                                    serverStatus === 'error' ? <AlertCircle className="w-3 h-3" /> :
                                        <Zap className="w-3 h-3 animate-pulse" />}
                                <span className="capitalize">{serverStatus}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center px-2 border-r border-zinc-200 dark:border-zinc-800 mr-2">
                                <label className="flex items-center gap-2 text-zinc-500 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200">
                                    <input
                                        type="checkbox"
                                        checked={autoScroll}
                                        onChange={(e) => setAutoScroll(e.target.checked)}
                                        className="rounded border-zinc-300 text-blue-500 focus:ring-0 w-3 h-3"
                                    />
                                    Auto-scroll
                                </label>
                            </div>

                            <button
                                onClick={async () => {
                                    const inputStr = lastInput ? JSON.stringify(lastInput, null, 2) : 'No request data';
                                    const outputStr = lastOutput ? JSON.stringify(lastOutput, null, 2) : 'No response data';
                                    const uiOutputStr = computedResults && Object.keys(computedResults).length > 0
                                        ? JSON.stringify(computedResults, null, 2)
                                        : 'No UI output data';
                                    const combined = `===== INPUT (REQUEST) =====\n${inputStr}\n\n===== OUTPUT (RESPONSE) =====\n${outputStr}\n\n===== UI OUTPUT (DISPLAYED) =====\n${uiOutputStr}`;
                                    await handleCopy(combined);
                                    setCopyStatus('copied');
                                    setTimeout(() => setCopyStatus('idle'), 2000);
                                }}
                                disabled={!lastInput && !lastOutput && (!computedResults || Object.keys(computedResults).length === 0)}
                                className={`px-2 py-1 text-[10px] ${copyStatus === 'copied' ? 'bg-green-500' : 'bg-blue-500 hover:bg-blue-600'} disabled:bg-zinc-600 disabled:cursor-not-allowed text-white rounded flex items-center gap-1 transition-colors`}
                                title="Copy All (Input, Output, UI)"
                            >
                                {copyStatus === 'copied' ? (
                                    <><Check className="w-3 h-3" /> Copied!</>
                                ) : (
                                    <><Copy className="w-3 h-3" /> Copy All</>
                                )}
                            </button>

                            <button onClick={loadLogs} className="p-1.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded" title="Refresh">
                                <RefreshCw className="w-4 h-4" />
                            </button>
                            <button onClick={handleClear} className="p-1.5 text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" title="Clear Logs">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <button onClick={onClose} className="p-1.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded ml-2" title="Close">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 overflow-hidden flex flex-col md:flex-row">

                        {/* Left Panel: Request/Response Monitor (40% width on large screens) */}
                        <div className="flex-1 md:flex-none md:w-[450px] border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-4 bg-zinc-50/50 dark:bg-zinc-900/50">
                            <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">Live Inspector</h3>

                            {!lastInput && !lastOutput && (
                                <div className="text-zinc-400 italic text-center py-10 opacity-50">
                                    Waiting for LLM activity...
                                </div>
                            )}

                            <Section
                                title="Latest Request"
                                icon={<Cloud className="w-3.5 h-3.5" />}
                                data={lastInput}
                                colorClass="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-900/20 dark:text-blue-400"
                                onCopy={handleCopy}
                            />

                            <Section
                                title="Latest Response"
                                icon={<CheckCircle className="w-3.5 h-3.5" />}
                                data={lastOutput}
                                colorClass="border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-900/20 dark:text-green-400"
                                onCopy={handleCopy}
                            />

                            <Section
                                title="UI Output (What's Displayed)"
                                icon={<Zap className="w-3.5 h-3.5" />}
                                data={computedResults && Object.keys(computedResults).length > 0 ? computedResults : null}
                                colorClass="border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-900/20 dark:text-purple-400"
                                onCopy={handleCopy}
                            />
                        </div>

                        {/* Right Panel: Historical Logs */}
                        <div className="flex-1 overflow-y-auto p-4 bg-white dark:bg-zinc-950">
                            <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3 flex justify-between">
                                <span>Log History</span>
                                <span className="text-zinc-500 font-normal normal-case">{logs.length} entries</span>
                            </h3>

                            <div className="space-y-2">
                                {logs.map((log) => (
                                    <div
                                        key={log.id}
                                        className={`border rounded-lg transition-all ${log.type === 'error' ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10' :
                                            log.type === 'llm' ? 'border-blue-100 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-900/5' :
                                                'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'
                                            }`}
                                    >
                                        <div
                                            className="flex items-center gap-3 p-2 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                                            onClick={() => toggleLogExpand(log.id)}
                                        >
                                            {expandedLogs[log.id] ? <ChevronDown className="w-3 h-3 text-zinc-400" /> : <ChevronRight className="w-3 h-3 text-zinc-400" />}

                                            <span className="text-zinc-400 font-mono text-[10px] min-w-[60px]">{formatTime(log.timestamp)}</span>

                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${log.type === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400' :
                                                log.type === 'llm' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400' :
                                                    'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
                                                }`}>
                                                {log.type}
                                            </span>

                                            <span className="text-zinc-600 dark:text-zinc-300 flex-1 truncate">{log.message}</span>
                                        </div>

                                        {expandedLogs[log.id] && log.data && (
                                            <div className="p-3 border-t border-black/5 dark:border-white/5 bg-black/5 dark:bg-black/20 overflow-x-auto">
                                                <div className="flex justify-end mb-2">
                                                    <button onClick={() => handleCopy(log.data)} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1">
                                                        <Copy className="w-3 h-3" /> Copy Data
                                                    </button>
                                                </div>
                                                <SyntaxHighlight data={log.data} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// Icons needed that might not be in the top import
import { RefreshCw, Terminal } from 'lucide-react';

export default DebugPanel;
