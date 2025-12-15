import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, Copy, ChevronDown, ChevronUp, Zap, Cloud, AlertCircle, CheckCircle } from 'lucide-react';
import { getLogs, clearLogs } from '../lib/db';

const DebugPanel = ({ isOpen, onClose, serverStatus, lastInput, lastOutput }) => {
    const [logs, setLogs] = useState([]);
    const [expanded, setExpanded] = useState({});
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            loadLogs();
        }
    }, [isOpen]);

    const loadLogs = async () => {
        const dbLogs = await getLogs(50);
        setLogs(dbLogs);
    };

    const handleClear = async () => {
        await clearLogs();
        setLogs([]);
    };

    const handleCopy = (data) => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    };

    const toggleExpand = (id) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const formatTime = (timestamp) => {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });
    };

    const getStatusColor = () => {
        switch (serverStatus) {
            case 'connected': return 'text-green-500';
            case 'error': return 'text-red-500';
            default: return 'text-yellow-500';
        }
    };

    const getStatusIcon = () => {
        switch (serverStatus) {
            case 'connected': return <CheckCircle className="w-4 h-4" />;
            case 'error': return <AlertCircle className="w-4 h-4" />;
            default: return <Zap className="w-4 h-4 animate-pulse" />;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 h-72 bg-zinc-950 border-t border-zinc-800 z-40 flex flex-col font-mono text-xs">
            {/* Header */}
            <div className="h-9 flex items-center justify-between px-3 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="font-semibold text-zinc-300 uppercase tracking-wider">Debug Console</span>

                    {/* Status */}
                    <div className={`flex items-center gap-1.5 ${getStatusColor()}`}>
                        {getStatusIcon()}
                        <span className="capitalize">{serverStatus}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleCopy({ input: lastInput, output: lastOutput, logs })}
                        className="px-2 py-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors flex items-center gap-1"
                    >
                        <Copy className="w-3 h-3" /> Copy All
                    </button>
                    <button
                        onClick={loadLogs}
                        className="px-2 py-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                    >
                        Refresh
                    </button>
                    <button
                        onClick={handleClear}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
                {/* Logs list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {/* Current request info */}
                    {lastInput && (
                        <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-blue-400 font-medium flex items-center gap-1">
                                    <Cloud className="w-3 h-3" /> Last LLM Request
                                </span>
                                <button onClick={() => handleCopy(lastInput)} className="text-zinc-600 hover:text-zinc-400">
                                    <Copy className="w-3 h-3" />
                                </button>
                            </div>
                            <pre className="text-zinc-500 overflow-x-auto max-h-20 text-[10px]">
                                {typeof lastInput === 'string' ? lastInput : JSON.stringify(lastInput, null, 2)}
                            </pre>
                        </div>
                    )}

                    {lastOutput && (
                        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-green-400 font-medium flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" /> Last LLM Response
                                </span>
                                <button onClick={() => handleCopy(lastOutput)} className="text-zinc-600 hover:text-zinc-400">
                                    <Copy className="w-3 h-3" />
                                </button>
                            </div>
                            <pre className="text-zinc-500 overflow-x-auto max-h-20 text-[10px]">
                                {typeof lastOutput === 'string' ? lastOutput : JSON.stringify(lastOutput, null, 2)}
                            </pre>
                        </div>
                    )}

                    {/* Historical logs */}
                    {logs.map((log) => (
                        <div
                            key={log.id}
                            className={`p-2 rounded cursor-pointer transition-colors ${log.type === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                                log.type === 'llm' ? 'bg-blue-500/5 border border-zinc-800' :
                                    'bg-zinc-900 border border-zinc-800'
                                }`}
                            onClick={() => toggleExpand(log.id)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-zinc-600">{formatTime(log.timestamp)}</span>
                                    <span className={`font-medium ${log.type === 'error' ? 'text-red-400' :
                                        log.type === 'llm' ? 'text-blue-400' :
                                            'text-zinc-400'
                                        }`}>
                                        [{log.type.toUpperCase()}]
                                    </span>
                                    <span className="text-zinc-500 truncate">{log.message}</span>
                                </div>
                                {log.data && (
                                    expanded[log.id] ? <ChevronUp className="w-3 h-3 text-zinc-600" /> : <ChevronDown className="w-3 h-3 text-zinc-600" />
                                )}
                            </div>

                            {expanded[log.id] && log.data && (
                                <pre className="mt-2 p-2 bg-zinc-950 rounded text-zinc-600 overflow-x-auto text-[10px]">
                                    {JSON.stringify(log.data, null, 2)}
                                </pre>
                            )}
                        </div>
                    ))}

                    {logs.length === 0 && !lastInput && !lastOutput && (
                        <div className="text-zinc-600 text-center py-8">No logs yet</div>
                    )}

                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    );
};

export default DebugPanel;
