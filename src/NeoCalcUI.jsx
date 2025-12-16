/**
 * NeoCalcUI - AI-Powered Smart Calculator
 * 
 * This is the main UI component for the NeoCalc application.
 * It provides a document-based interface where users can write
 * natural language math and get computed results.
 * 
 * Key Features:
 * - Local evaluation engine for basic math
 * - AI-powered logic extraction for complex expressions
 * - Multi-file support with IndexedDB persistence
 * - PWA capabilities (offline, installable)
 * - Debug panel for monitoring LLM requests
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Plus, Search, Command, X, FolderOpen, Download,
    LayoutGrid, Settings, FileText, FilePlus, Undo, Redo,
    ChevronRight, Save, MoreVertical, Terminal, Eye, EyeOff,
    Sidebar, PanelRight, Cloud, Zap, Copy, Scissors,
    Edit2, Trash2 as TrashIcon, MoreHorizontal, Sun, Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Local modules
import { createFile, saveFile, getFile, getAllFiles, renameFile, deleteFile, addLog } from './lib/db';
import SplashScreen from './components/SplashScreen';
import InstallPrompt from './components/InstallPrompt';
import DebugPanel from './components/DebugPanel';
import ConfirmationModal from './components/ConfirmationModal';
import {
    LOCAL_API_URL,
    SAFE_FUNCS,
    LLM_SYSTEM_PROMPT
} from './utils/constants';
import {
    evaluateDocument,
    extractTag,
    classifyFormat,
    substituteVariables
} from './utils/evaluator';
import { formatValue, formatRelativeTime } from './utils/formatters';
import { generateUUID, computeInfoHash } from './utils/security';

// ============================================
// THEME CONSTANTS - UPDATED FOR LIGHT MODE
// ============================================
const BORDER_COLOR = "border-zinc-200 dark:border-zinc-800";
const ACTIVE_TAB_COLOR = "bg-white dark:bg-zinc-900 border-b-white dark:border-b-zinc-900 text-zinc-900 dark:text-zinc-100";
const INACTIVE_TAB_COLOR = "text-zinc-500 dark:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-900/50 hover:text-zinc-700 dark:hover:text-zinc-400";

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

// ============================================
// MAIN COMPONENT
// ============================================
// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Detects if an AI formula is a self-reference (X = X, X = f(X))
 */
const isSelfReference = (varName, formula) => {
    if (!varName || !formula) return false;

    // Check if RHS references the variable being defined
    // Normalize both to be safe (remove spaces, lowercase)
    const normalize = (s) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

    // Check if normalized RHS contains normalized varName
    if (normalize(formula).includes(normalize(varName))) return true;

    return false;
};

/**
 * Validates AI output before accepting it
 * Returns { valid: boolean, reason?: string }
 */
const validateAiFormula = (formula, varName, availableVars) => {
    if (!formula) return { valid: false, reason: 'Empty formula' };

    // Self-reference check
    if (varName && isSelfReference(varName, formula)) {
        return { valid: false, reason: 'Self-reference detected' };
    }

    // 1. Substitute known variables with "1" using the existing substitution logic
    // We create a dummy scope with all keys mapping to 1
    const dummyScope = {};
    if (availableVars) {
        Object.keys(availableVars).forEach(k => dummyScope[k] = 1);
    }

    let checkExpr = substituteVariables(formula, dummyScope);

    // 2. Remove L{n} / L{prev}
    checkExpr = checkExpr.replace(/L\{?\d+\}?/gi, '1').replace(/L\{prev\}/gi, '1');

    // 3. Remove Math functions
    const mathFuncs = ['sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'pow', 'log', 'log10', 'exp', 'sin', 'cos', 'tan'];
    checkExpr = checkExpr.replace(new RegExp(`\\b(${mathFuncs.join('|')})`, 'gi'), '');

    // 4. Remove operators and numbers (including Allowlisted constants)
    checkExpr = checkExpr.replace(/[0-9.]+/g, '');
    checkExpr = checkExpr.replace(/[+\-*/^()=,]/g, '');
    checkExpr = checkExpr.trim();

    // 5. If anything substantial remains, it's likely an undefined variable
    if (checkExpr.length > 0) {
        // Allow pure whitespace
        if (/\S/.test(checkExpr)) {
            // Exception for legitimate words that might remain if not strict (like 'sum')
            if (!/^(sum)$/i.test(checkExpr)) {
                return { valid: false, reason: `Unknown token/variable: "${checkExpr}"` };
            }
        }
    }

    // Try to parse (dry run) using simple JS syntax check
    try {
        // Use existing substituteVariables to prep for JS eval
        let evalExpr = substituteVariables(formula, dummyScope);
        evalExpr = evalExpr.replace(/L\{?\d+\}?/gi, '1').replace(/L\{prev\}/gi, '1');

        // Simple JS syntax check
        new Function(`return (${evalExpr})`)();
    } catch (e) {
        return { valid: false, reason: `Parse error: ${e.message}` };
    }

    return { valid: true };
};

/**
 * Validates the entire AI response schema
 */
const validateAiResponseSchema = (response, requestDocId, requestLinesHash) => {
    if (!response || typeof response !== 'object') {
        return { valid: false, reason: 'Response is not a valid JSON object' };
    }

    // 1. Check Meta
    if (!response.meta) {
        return { valid: false, reason: 'Missing "meta" field in response' };
    }
    if (response.meta.doc_id !== requestDocId) {
        return { valid: false, reason: `ID Mismatch: Request ${requestDocId} != Response ${response.meta.doc_id}` };
    }
    if (response.meta.lines_hash !== requestLinesHash) {
        return { valid: false, reason: `Hash Mismatch: Content changed. Req: ${requestLinesHash}, Res: ${response.meta.lines_hash}` };
    }

    // 2. Check Results
    if (!response.results || typeof response.results !== 'object') {
        return { valid: false, reason: 'Missing or invalid "results" object' };
    }

    return { valid: true };
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

    // File Management State
    const [contextMenu, setContextMenu] = useState(null); // { x, y, fileId }
    const [renamingFileId, setRenamingFileId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [modalConfig, setModalConfig] = useState(null); // { type, title, message, onConfirm }
    const [globalContextMenu, setGlobalContextMenu] = useState(null); // { x, y }
    const [theme, setTheme] = useState(() => localStorage.getItem('neocalc_theme') || 'dark');
    const [toast, setToast] = useState(null); // { message, icon }
    const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'unsaved', 'saving'
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandSearch, setCommandSearch] = useState('');
    const [outputPanelWidth, setOutputPanelWidth] = useState(350);
    const [isDragging, setIsDragging] = useState(false);
    const [tracePopup, setTracePopup] = useState(null); // { lineIdx, x, y } - shows calculation breakdown
    const [isPopupDragging, setIsPopupDragging] = useState(false);
    const [popupDragOffset, setPopupDragOffset] = useState({ x: 0, y: 0 });
    const commandInputRef = useRef(null);

    // Trace popup drag handlers
    const handlePopupDragStart = useCallback((e) => {
        if (!tracePopup) return;
        e.preventDefault();
        setIsPopupDragging(true);
        setPopupDragOffset({
            x: e.clientX - tracePopup.x,
            y: e.clientY - tracePopup.y
        });
    }, [tracePopup]);

    useEffect(() => {
        if (!isPopupDragging) return;

        const handleMouseMove = (e) => {
            setTracePopup(prev => prev ? {
                ...prev,
                x: e.clientX - popupDragOffset.x,
                y: e.clientY - popupDragOffset.y
            } : null);
        };

        const handleMouseUp = () => {
            setIsPopupDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isPopupDragging, popupDragOffset]);

    // Resize divider drag handlers
    const handleDividerMouseDown = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e) => {
            const containerRect = outputRef.current?.getBoundingClientRect();
            if (!containerRect) return;

            // Calculate new width based on mouse position from right edge
            const newWidth = containerRect.right - e.clientX;
            // Clamp between min and max
            const clampedWidth = Math.max(200, Math.min(600, newWidth));
            setOutputPanelWidth(clampedWidth);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    // Apply theme class
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('neocalc_theme', theme);
    }, [theme]);

    const textareaRef = useRef(null);
    const outputRef = useRef(null);
    const lineNumbersRef = useRef(null);
    const isScrolling = useRef(false);
    const saveTimeoutRef = useRef(null);

    // Sync scrolling logic
    const handleScroll = (source, e) => {
        if (isScrolling.current) return;
        isScrolling.current = true;

        const scrollTop = e.target.scrollTop;

        if (source === 'editor') {
            if (outputRef.current) outputRef.current.scrollTop = scrollTop;
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = scrollTop;
        } else if (source === 'output') {
            if (textareaRef.current) textareaRef.current.scrollTop = scrollTop;
            if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = scrollTop;
        }

        // Reset lock after a short delay
        setTimeout(() => { isScrolling.current = false; }, 50);
    };

    const ROW_HEIGHT = 32;

    const showToast = useCallback((message, icon = null) => {
        setToast({ message, icon });
        setTimeout(() => setToast(null), 2000);
    }, []);

    // --- MENU DISMISSAL ---
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (activeMenu) {
                setActiveMenu(null);
            }
            if (contextMenu) {
                // If context menu is open, only close if click is not inside the menu
                // However, usually context menus close on any click elsewhere.
                // We'll let the menu implementation handle its own dismissal or add generic one here.
                setContextMenu(null);
            }
        };

        if (activeMenu || contextMenu) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => document.removeEventListener('click', handleClickOutside);
    }, [activeMenu, contextMenu]);

    // --- INITIALIZE ---
    useEffect(() => {
        const init = async () => {
            // Load files from IndexedDB
            let dbFiles = await getAllFiles();

            // If no files exist, create a blank file to start
            // Use sessionStorage to prevent duplicate creation on hot reload
            if (dbFiles.length === 0 && !sessionStorage.getItem('neocalc_init')) {
                await createFile('Untitled.calc', '# New Document\n\n');
                dbFiles = await getAllFiles();
                sessionStorage.setItem('neocalc_init', 'true');
            }

            setFiles(dbFiles);

            // Open first file if none selected
            if (dbFiles.length > 0 && !currentFileId) {
                const firstFile = dbFiles[0];
                setCurrentFileId(firstFile.id);
                setText(firstFile.content);
                setAiLogic(firstFile.aiLogic || {});
                setTabs([{ id: firstFile.id, title: firstFile.title, active: true }]);
            }

            // Hide splash after loading
            setTimeout(() => setIsLoading(false), 800);
        };

        // Close context menu on global click
        const handleClickOutside = () => setContextMenu(null);
        window.addEventListener('click', handleClickOutside);

        init();
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    // --- AUTO-SAVE ---
    useEffect(() => {
        if (!currentFileId || !hasUnsavedChanges) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(async () => {
            setSaveStatus('saving');
            await saveFile(currentFileId, text, aiLogic);
            setSaveStatus('saved');
            setHasUnsavedChanges(false);
            setFiles(await getAllFiles());
        }, 2000);

        return () => clearTimeout(saveTimeoutRef.current);
    }, [text, currentFileId, hasUnsavedChanges, aiLogic]);

    // Track text changes
    const handleTextChange = (e) => {
        setText(e.target.value);
        setHasUnsavedChanges(true);
        setSaveStatus('unsaved');
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

        // 1. Calculate remaining tabs
        const remainingTabs = tabs.filter(t => t.id !== id);

        // Safety check: ensure we don't end up with empty tabs
        if (remainingTabs.length === 0) {
            // Can't close the last tab
            return;
        }

        if (id === currentFileId) {
            // Closing the active tab implies switching
            const nextTab = remainingTabs[remainingTabs.length - 1];

            // 2. Optimistic UI update: Remove tab AND set next tab as active immediately
            const optimisticTabs = remainingTabs.map(t => ({
                ...t,
                active: t.id === nextTab.id
            }));
            setTabs(optimisticTabs);

            // 3. Kick off content load
            const file = await getFile(nextTab.id);
            if (file) {
                // Manually set state instead of calling openFile to avoid using stale 'tabs' state
                setCurrentFileId(file.id);
                setText(file.content);
                setAiLogic(file.aiLogic || {});
                setView('editor');
                setActiveMenu(null);
            }
        } else {
            // Closing an inactive tab - just update list
            setTabs(remainingTabs);
        }
    };
    // --- CONTEXT MENU HANDLERS ---
    const handleContextMenu = (e, file) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, file });

        // Also close global menu if open
        setGlobalContextMenu(null);
    };

    const handleDeleteFile = (e) => {
        e?.stopPropagation();
        if (!contextMenu?.file) return;

        const file = contextMenu.file;
        const fileId = file.id;

        // Don't delete if it's the only file
        if (files.length <= 1) {
            setModalConfig({
                type: 'alert',
                title: 'Cannot Delete',
                message: 'You cannot delete the only active file. Please create another file before deleting this one.',
                onConfirm: () => setModalConfig(null),
                onCancel: () => setModalConfig(null)
            });
            setContextMenu(null);
            return;
        }

        setModalConfig({
            type: 'confirm',
            title: `Delete ${file.title}?`,
            message: `Are you sure you want to delete "${file.title}"? This action cannot be undone.`,
            onConfirm: async () => {
                // If deleting current file, switch to another first
                if (currentFileId === fileId) {
                    const remaining = files.filter(f => f.id !== fileId);
                    if (remaining.length > 0) {
                        // Switch to the first remaining file without opening a new tab
                        const nextFile = remaining[0];
                        setCurrentFileId(nextFile.id);
                        setText(nextFile.content || '');
                        setComputedResults({});
                        setAiLogic({});
                        // Update tabs to make the next file active
                        setTabs(prev => {
                            const filtered = prev.filter(t => t.id !== fileId);
                            // If next file isn't in tabs, add it
                            if (!filtered.find(t => t.id === nextFile.id)) {
                                return [...filtered, { id: nextFile.id, title: nextFile.title, active: true }];
                            }
                            return filtered.map(t => ({ ...t, active: t.id === nextFile.id }));
                        });
                    }
                } else {
                    // Just remove from tabs if it's there
                    setTabs(prev => prev.filter(t => t.id !== fileId));
                }

                // Now delete and update files list
                await deleteFile(fileId);
                setFiles(prev => prev.filter(f => f.id !== fileId));
                setModalConfig(null);
            },
            onCancel: () => setModalConfig(null)
        });
        setContextMenu(null);
    };

    // --- RENAME HANDLERS ---
    const handleRenameStart = (e) => {
        e?.stopPropagation();
        if (!contextMenu?.file) return;

        // Get suggestion from first line of content (like Google Docs)
        const content = contextMenu.file.content || '';
        const firstLine = content.split('\n')[0]?.trim() || '';
        // Clean up: remove markdown headers, comments, etc.
        const suggestion = firstLine
            .replace(/^#+\s*/, '')  // Remove # headers
            .replace(/^\/\/\s*/, '') // Remove // comments
            .trim()
            .slice(0, 50); // Limit length

        setRenamingFileId(contextMenu.file.id);
        // Use first line as suggestion, or fall back to current title
        setRenameValue(suggestion || contextMenu.file.title.replace('.calc', ''));
        setContextMenu(null);
    };

    const handleRenameSubmit = async (e) => {
        e.preventDefault();
        if (!renamingFileId) return;

        if (!renameValue.trim()) {
            setRenamingFileId(null);
            return;
        }

        const newTitle = renameValue.trim().endsWith('.calc')
            ? renameValue.trim()
            : `${renameValue.trim()}.calc`;

        await renameFile(renamingFileId, newTitle);

        // Update local state
        const updatedFiles = await getAllFiles();
        setFiles(updatedFiles);
        setTabs(tabs.map(t => t.id === renamingFileId ? { ...t, title: newTitle } : t));

        setRenamingFileId(null);
    };

    // --- IMPORT FILE ---
    const fileInputRef = useRef(null);

    const handleImportFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target.result;
            // Remove .calc from filename if present to avoid double extension (createFile appends nothing but title expects logic?)
            // Actually createFile appends nothing if I pass full name, but my logic usually appends .calc if missing.
            // Let's rely on standard naming: just use filename.
            const newFileId = await createFile(file.name, content);
            const newFiles = await getAllFiles();
            setFiles(newFiles);
            const importedFile = newFiles.find(f => f.id === newFileId);
            if (importedFile) openFile(importedFile);
        };
        reader.readAsText(file);
        // Reset input so same file can be selected again if needed
        e.target.value = null;
        setActiveMenu(null);
    };

    const triggerImport = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };


    const handleDuplicateFile = async (e) => {
        e?.stopPropagation();
        if (!contextMenu?.file) return;

        const original = contextMenu.file;
        const newTitle = `${original.title.replace('.calc', '')} (Copy).calc`;
        await createFile(newTitle, original.content);

        const updatedFiles = await getAllFiles();
        setFiles(updatedFiles);
        setContextMenu(null);
    };
    const handleNewFile = async () => {
        const title = `Untitled_${Date.now()}.calc`;
        const id = await createFile(title, '# New Document\n\n');
        const newFile = await getFile(id);
        setFiles(await getAllFiles());
        await openFile(newFile);
        setActiveMenu(null);
        showToast('New File Created', <FilePlus className="w-4 h-4" />);
    };

    const handleSaveFile = async () => {
        if (currentFileId) {
            setSaveStatus('saving');
            await saveFile(currentFileId, text, aiLogic);
            setSaveStatus('saved');
            setHasUnsavedChanges(false);
            setFiles(await getAllFiles());
            await addLog('info', 'File saved', { id: currentFileId });
            showToast('Saved', <Save className="w-4 h-4" />);
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
                } else if (e.key === 'k') {
                    e.preventDefault();
                    setShowCommandPalette(prev => !prev);
                }
            }
            if (e.key === 'Escape') {
                setShowCommandPalette(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [currentFileId, text, aiLogic]);

    // Command Palette Actions
    const commands = [
        { id: 'new', label: 'New File', icon: <FilePlus className="w-4 h-4" />, action: handleNewFile, shortcut: '⌘N' },
        { id: 'open', label: 'Open File...', icon: <FolderOpen className="w-4 h-4" />, action: triggerImport, shortcut: '⌘O', desc: 'Import .calc or .txt files' },
        { id: 'save', label: 'Save File', icon: <Save className="w-4 h-4" />, action: handleSaveFile, shortcut: '⌘S' },
        { id: 'sidebar', label: showSidebar ? 'Hide Sidebar' : 'Show Sidebar', icon: showSidebar ? <Sidebar className="w-4 h-4" /> : <Sidebar className="w-4 h-4" />, action: () => setShowSidebar(!showSidebar) },
        { id: 'theme', label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode', icon: theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />, action: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
        { id: 'debug', label: showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel', icon: <Terminal className="w-4 h-4" />, action: () => setShowDebugPanel(!showDebugPanel) },
    ];

    // Filter commands based on search
    const isCommandMode = commandSearch.startsWith('>');
    const searchQuery = isCommandMode ? commandSearch.slice(1).trim() : commandSearch;

    // Filter files: show all files when empty, filter by title AND content when typing
    const matchingFiles = isCommandMode ? [] : files
        .map(file => {
            const title = file.title || file.name || 'Untitled';
            const content = file.content || '';
            const titleMatch = !searchQuery || title.toLowerCase().includes(searchQuery.toLowerCase());
            const contentMatch = searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase());

            // Find matching line in content for preview
            let matchingLine = null;
            if (contentMatch && !titleMatch) {
                const lines = content.split('\n');
                const matchIdx = lines.findIndex(line =>
                    line.toLowerCase().includes(searchQuery.toLowerCase())
                );
                if (matchIdx >= 0) {
                    matchingLine = lines[matchIdx].trim().slice(0, 50);
                }
            }

            return {
                file,
                title,
                titleMatch,
                contentMatch,
                matchingLine,
                matches: titleMatch || contentMatch
            };
        })
        .filter(item => !searchQuery || item.matches)
        .slice(0, 10)
        .map(({ file, title, contentMatch, matchingLine }) => ({
            id: `file-${file.id}`,
            label: title,
            icon: <FileText className="w-4 h-4" />,
            action: () => openFile(file),
            desc: matchingLine
                ? `...${matchingLine}...`
                : (file.id === currentFileId ? 'Current file' : 'Open file'),
            isFile: true
        }));

    // Filter commands
    const matchingCommands = commands.filter(cmd =>
        !searchQuery || cmd.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cmd.desc && cmd.desc.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // Combine: files first (if any match), then commands
    const filteredCommands = isCommandMode
        ? matchingCommands
        : (searchQuery ? [...matchingFiles, ...matchingCommands] : [...matchingFiles.slice(0, 5), ...matchingCommands]);

    useEffect(() => {
        if (showCommandPalette) {
            setTimeout(() => commandInputRef.current?.focus(), 10);
            setCommandSearch('');
        }
    }, [showCommandPalette]);

    // ============================================
    // LLM API CALL
    // ============================================
    // Note: evaluateDocument, extractTag, classifyFormat are imported from utils/evaluator

    /**
     * Calls the local LLM server to extract logic from user input.
     * This runs after a debounce delay when text changes.
     */
    const callLocalLLM = async (inputText) => {
        if (!inputText.trim()) {
            setAiLogic({});
            setServerStatus('unknown');
            return;
        }
        setLoading(true);
        setServerStatus('connecting...');

        // 1. Run local evaluation FIRST to get actual computed values
        // This ensures we never send regex-guessed numbers to the AI
        const { results: localResults, variables: localVariables, variableLines } = evaluateDocument(inputText);

        const lineMap = {};
        const variables = {};
        const lines = inputText.split('\n');

        lines.forEach((line, idx) => {
            if (line.trim()) {
                lineMap[idx] = line;
            }
        });

        // ONLY include variables that were SUCCESSFULLY evaluated locally
        if (localVariables && variableLines) {
            Object.entries(localVariables).forEach(([name, value]) => {
                if (Number.isFinite(value)) {
                    const line = variableLines[name];
                    if (line !== undefined) {
                        variables[name] = { line, value };
                    }
                }
            });
        }

        const systemPrompt = `You are a Syntax Rewriter for a smart calculator.

Your job is to convert natural language math expressions into evaluable formulas.
You do NOT compute values. You do NOT invent variables. You ONLY rewrite syntax.

INPUT FORMAT:
{
  "meta": {
    "doc_id": "uuid",
    "lines_hash": "hash"
  },
  "lines": { "lineIndex": "raw text" },
  "variables": { "VarName": { "line": lineIndex, "value": number } }
}

OUTPUT FORMAT (for each line):
{
  "meta": {
    "doc_id": "uuid" (ECHO BACK EXACTLY),
    "lines_hash": "hash" (ECHO BACK EXACTLY)
  },
  "results": {
      "lineIndex": {
        "kind": "rewrite" | "header" | "note" | "skip" | "question" | "ignore",
        "rhs": "expression" (ONLY the right-hand side, no variable name),
        "explanation": "what this calculates",
        "confidence": 0.0 to 1.0
      }
  }
}

CRITICAL RULES:
1. **RHS ONLY**: Never include the variable name in "rhs". Only the expression.
   - Line: "Rent = $1500" → rhs: "1500"
   - Line: "Total = A + B" → rhs: "A + B"
   - Line: "Header" → kind: "header", rhs ""

2. **NO SELF-REFERENCES**: Never reference the variable being defined.
   - ❌ WRONG: { "rhs": "Staffing" } for a line defining Staffing
   - ✅ RIGHT: { "rhs": "2 * 15 * 8 * 30" }

3. **USE EXACT NAMES**: Use variable names exactly as they appear in "variables".
   - If "Selling Price" exists, use "Selling Price", not "SellingPrice"

4. **LINE REFERENCES**: Use L{n} for values from line n. Do not use L{prev}. Always use explicit variable names or explicit line numbers L{n}.

5. **NO INVENTED NUMBERS**: Only use numbers that appear in the original line.
   - EXCEPTION: Common calendar/math constants are allowed: 12, 52, 365, 30, 24, 60, 7, 100.

6. **CONFIDENCE**:
   - 1.0 = Obvious math, no ambiguity
   - 0.7 = Likely correct interpretation
   - 0.5 = Uncertain, multiple interpretations possible
   - If < 0.5, use kind: "question" instead

7. **KINDS**:
   - "rewrite": Math expression to evaluate (RHS must be pure expression)
   - "header": Section heading (RHS must be empty)
   - "note": Pure comment (RHS must be empty)
   - "skip": Empty or unparseable
   - "ignore": Already valid math or assignment
   - "question": Ambiguous, needs user clarification

Return ONLY valid JSON. If unsure, use kind: "question".`;

        // Generate binding IDs
        const docId = generateUUID();
        // Compute hash of lines + variables for binding
        const linesHash = await computeInfoHash({ lines: lineMap, variables });

        const llmInput = {
            meta: { doc_id: docId, lines_hash: linesHash },
            lines: lineMap,
            variables
        };
        setLastInput(llmInput);

        try {
            const startTime = Date.now();
            const response = await fetch(LOCAL_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "qwen2.5-7b-instruct-q4_k_m.gguf",
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

                    // STRICT VALIDATION
                    const validation = validateAiResponseSchema(parsed, docId, linesHash);
                    if (!validation.valid) {
                        console.error('AI Response Rejected:', validation.reason);
                        await addLog('error', 'AI Response Rejected', { reason: validation.reason, doc_id: docId, hash: linesHash });
                        return; // Discard invalid response
                    }

                    setAiLogic(parsed.results);
                    setLastOutput({ raw: data, parsed, elapsed });
                    setHasUnsavedChanges(true); // Mark as changed to save AI logic

                    // Comprehensive logging
                    await addLog('llm', `Response in ${elapsed}ms`, {
                        doc_id: docId,
                        lines_hash: linesHash,
                        prompt_start: systemPrompt.slice(0, 300),
                        input_preview: JSON.stringify(llmInput).slice(0, 300),
                        output_meta: parsed.meta
                    });
                } catch (e) {
                    await addLog('error', 'JSON parse error', { error: e.message, raw: textResult });
                }
            }
        } catch (e) {
            setServerStatus('error');
            console.error(e);
            await addLog('error', 'LLM Request Failed', { error: e.message });
        }
        setLoading(false);
    };

    // --- AI/LOGIC PROCESSING ---
    useEffect(() => {
        // Debounce processing to avoid flickering
        const timeout = setTimeout(() => {
            // 1. Run local evaluation first (FAST)
            const { results: localResults, variables: localVariables } = evaluateDocument(text);
            const finalResults = { ...localResults };
            const currentValues = {};

            // Populate currentValues from local results
            Object.keys(localResults).forEach(key => {
                currentValues[key] = localResults[key].value;
            });

            // Variable lookup from local results is already in localVariables
            const variableValues = { ...localVariables };

            // (No extra loop needed here as we use localVariables direct from evaluator)

            lines.forEach((_, idx) => {
                // Case A: Local result takes priority
                if (localResults[idx]) {
                    finalResults[idx] = {
                        ...localResults[idx],
                        source: 'local'
                    };
                    return;
                }

                // Case B: AI Logic
                const aiItem = aiLogic[idx];

                if (aiItem) {
                    // Handle non-rewrite types first
                    if (aiItem.kind === 'header' || aiItem.kind === 'note' || aiItem.kind === 'variable') {
                        if (aiItem.explanation) {
                            finalResults[idx] = {
                                value: null,
                                formatted: '',
                                type: aiItem.kind === 'variable' ? 'note' : aiItem.kind, // Fallback for variable type to note if AI misclassifies
                                explanation: aiItem.explanation,
                                formula: '',
                                source: 'ai'
                            };
                        }
                        return;
                    }

                    // Handle 'rewrite' type or legacy fallback
                    // New contract uses 'kind: rewrite' and 'rhs'
                    // Fallback to checking formula/format for safety if model misbehaves
                    const isRewrite = aiItem.kind === 'rewrite' || (!aiItem.kind && (aiItem.formula || aiItem.format));
                    const rawFormula = aiItem.rhs || aiItem.formula || aiItem.format;

                    if (isRewrite && rawFormula) {
                        try {
                            let parsable = rawFormula;

                            // If formula contains "=", take only the right side (legacy protection)
                            if (parsable.includes('=')) {
                                const eqIdx = parsable.indexOf('=');
                                parsable = parsable.slice(eqIdx + 1).trim();
                            }

                            // EXTRACT VARIABLE NAME from current line for self-ref check
                            const currentLine = lines[idx] || '';
                            let varName = null;
                            if (currentLine.includes('=')) varName = currentLine.split('=')[0].trim();
                            else if (currentLine.includes(':')) varName = currentLine.split(':')[0].trim();

                            // VALIDATE before proceeding
                            const validation = validateAiFormula(parsable, varName, variableValues);
                            if (!validation.valid) {
                                // console.warn('Validation failed:', validation.reason);
                                return; // Reject invalid formulas
                            }

                            // Substitute variable names with values
                            const sortedVarNames = Object.keys(variableValues).sort((a, b) => b.length - a.length);
                            for (const vName of sortedVarNames) {
                                const escaped = vName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const regex = new RegExp(escaped, 'gi');
                                parsable = parsable.replace(regex, variableValues[vName]);
                            }

                            // Handle L{prev}
                            parsable = parsable.replace(/L\{prev\}/gi, () => {
                                for (let i = idx - 1; i >= 0; i--) {
                                    if (finalResults[i]?.value !== undefined) return finalResults[i].value;
                                    if (currentValues[i] !== undefined) return currentValues[i];
                                }
                                return 0;
                            });

                            // Handle L{n}
                            parsable = parsable.replace(/L\{?(\d+)\}?/g, (_, lineNum) => {
                                const v = finalResults[lineNum]?.value ?? currentValues[lineNum] ?? 0;
                                return v;
                            });

                            // Handle sum(tag)
                            parsable = parsable.replace(/sum\(([^)]+)\)/gi, (_, tag) => {
                                const targetTag = tag.trim().toLowerCase();
                                let sum = 0;
                                for (let i = 0; i < idx; i++) {
                                    const localTag = localResults[i]?.explanation?.match(/#([A-Za-z0-9][\w-]*)/)?.[1];
                                    if (localTag?.toLowerCase() === targetTag) {
                                        sum += (localResults[i]?.value || 0);
                                        continue;
                                    }
                                    const lineContent = lines[i] || '';
                                    if (extractTag(lineContent) === targetTag) {
                                        const v = finalResults[i]?.value ?? currentValues[i] ?? 0;
                                        if (Number.isFinite(v)) sum += v;
                                    }
                                }
                                return sum;
                            });

                            // Math functions
                            parsable = parsable.replace(/sqrt\(([^)]+)\)/gi, (_, arg) => `Math.sqrt(${arg})`);
                            parsable = parsable.replace(/round\(([^,]+),\s*(\d+)\)/gi, (_, num, dec) => `(Math.round(${num} * Math.pow(10, ${dec})) / Math.pow(10, ${dec}))`);
                            parsable = parsable.replace(/max\(([^)]+)\)/gi, (_, args) => `Math.max(${args})`);
                            parsable = parsable.replace(/min\(([^)]+)\)/gi, (_, args) => `Math.min(${args})`);

                            if (!parsable || parsable === '' || parsable === '0') return;

                            // eslint-disable-next-line no-new-func
                            const val = new Function(`return (${parsable})`)();

                            if (Number.isFinite(val)) {
                                finalResults[idx] = {
                                    value: val,
                                    formatted: formatValue(val, aiItem.format), // AI passes format? Use strict or inference? 
                                    // For now relying on format inferred or passed (prompt doesn't explicitly return format field in new schema, but old one did.
                                    // If new schema doesn't return format, formatValue will handle undefined)
                                    type: aiItem.kind === 'rewrite' ? 'calc' : aiItem.kind,
                                    explanation: aiItem.explanation,
                                    formula: aiItem.rhs || aiItem.formula,
                                    source: 'ai'
                                };
                                currentValues[idx] = val;

                                // Add computed result to variableValues
                                if (varName) {
                                    variableValues[varName] = val;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            });

            // ===== RECALCULATE SUMS =====
            // Now that we have all AI results, recalculate any "sum: tagname" lines
            // to include AI-computed values that weren't available during initial local evaluation
            let changed = true;
            let iterations = 0;
            const maxIterations = 5;

            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;

                lines.forEach((line, idx) => {
                    const trimmed = line.trim();
                    const sumMatch = trimmed.match(/^sum\s*:\s*([A-Za-z0-9][\w\s-]*)\s*$/i);
                    if (sumMatch) {
                        const targetTag = sumMatch[1].toLowerCase().trim();
                        let sum = 0;
                        let count = 0;

                        // Sum all previous lines with this tag
                        for (let i = 0; i < idx; i++) {
                            const lineContent = lines[i] || '';
                            const lineTag = extractTag(lineContent);

                            if (lineTag === targetTag) {
                                // Get value from finalResults (includes both local and AI)
                                const value = finalResults[i]?.value;
                                if (Number.isFinite(value)) {
                                    sum += value;
                                    count++;
                                }
                            }
                        }

                        // Only update if the sum has changed or wasn't previously calculated
                        if (finalResults[idx]?.value !== sum) {
                            finalResults[idx] = {
                                value: sum,
                                type: 'total',
                                format: 'number',
                                explanation: count ? `Sum of #${targetTag}` : `No #${targetTag} found`,
                                formula: `sum(${targetTag})`,
                                source: 'local'
                            };
                            changed = true; // Mark that a change occurred
                        }

                        // Store sum value in variableValues so later AI formulas can reference it
                        // Check if previous line is a plain label (like "Material Total") and use that as the variable name
                        if (idx > 0) {
                            const prevLine = lines[idx - 1]?.trim();
                            // If previous line is just text (no =, no :, not a header, not empty)
                            if (prevLine && !prevLine.includes('=') && !prevLine.includes(':') && !prevLine.startsWith('#') && !prevLine.startsWith('//')) {
                                if (variableValues[prevLine] !== sum) {
                                    variableValues[prevLine] = sum;
                                    changed = true;
                                }
                            }
                        }
                        // Also store under the tag name
                        if (variableValues[`sum:${targetTag}`] !== sum) {
                            variableValues[`sum:${targetTag}`] = sum;
                            variableValues[`sum: ${targetTag}`] = sum; // Also with space for robustness
                            changed = true;
                        }
                    }
                });
            }

            // ===== ITERATIVE EVALUATION: Re-evaluate AI formulas until no more changes =====
            // This handles dependency chains like: line 25 depends on sum, line 27 depends on line 25
            changed = true;
            iterations = 0;
            // maxIterations already defined above

            while (changed && iterations < maxIterations) {
                changed = false;
                iterations++;

                lines.forEach((line, idx) => {
                    // Skip lines that already have a valid result with a value
                    // Merge Logic Hardening:
                    // 1. Only process if key matches current line index (implicit in forEach)
                    // 2. Only process if line failed local parse OR explicitly routed?
                    //    (Currently we skip if local is valid: if (Number.isFinite(finalResults[idx]?.value)) return;)
                    //    This effectively makes local win.

                    const aiItem = aiLogic[idx];
                    if (!aiItem) return;

                    // Skip 'ignore' type (explicitly requested to ignore valid lines)
                    if (aiItem.kind === 'ignore') return;

                    // Skip non-rewrite items
                    if (aiItem.kind === 'header' || aiItem.kind === 'note' || aiItem.kind === 'skip' || (aiItem.type === 'header' || aiItem.type === 'note')) return;

                    const rawFormula = aiItem.rhs || aiItem.formula; // formula for legacy
                    if (!rawFormula) return;

                    // Reject if kind is "question" but has RHS (schema violation)
                    if (aiItem.kind === 'question' && rawFormula) {
                        // Treat as rewrite? Or reject?
                        // Plan says: Reject kind:"question" if rhs is set.
                        // But model might put suggested answer in RHS. 
                        // Safer to treat as question and not apply.
                        return;
                    }

                    try {
                        let parsable = rawFormula;

                        if (parsable.includes('=')) {
                            parsable = parsable.slice(parsable.indexOf('=') + 1).trim();
                        }

                        // Extarct variable name for validation
                        const currentLine = lines[idx] || '';
                        let varName = null;
                        if (currentLine.includes('=')) varName = currentLine.split('=')[0].trim();
                        else if (currentLine.includes(':')) varName = currentLine.split(':')[0].trim();

                        // VALIDATE
                        const validation = validateAiFormula(parsable, varName, variableValues);
                        if (!validation.valid) return;

                        // Substitute variable values (now including sums and previously computed values)
                        const sortedVarNames = Object.keys(variableValues).sort((a, b) => b.length - a.length);
                        for (const vName of sortedVarNames) {
                            const escaped = vName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(escaped, 'gi');
                            parsable = parsable.replace(regex, variableValues[vName]);
                        }

                        // Clean up for JS evaluation
                        parsable = parsable.replace(/\$/g, '');
                        parsable = parsable.replace(/,(\d{3})/g, '$1');

                        // eslint-disable-next-line no-new-func
                        const val = new Function(`return (${parsable})`)();

                        if (Number.isFinite(val)) {
                            finalResults[idx] = {
                                value: val,
                                formatted: formatValue(val, aiItem.format),
                                type: aiItem.kind === 'rewrite' ? 'calc' : aiItem.type,
                                explanation: aiItem.explanation,
                                formula: aiItem.rhs || aiItem.formula,
                                source: 'ai'
                            };

                            // Add this result to variableValues for subsequent iterations
                            if (varName) {
                                variableValues[varName] = val;
                                changed = true;
                            }
                        }
                    } catch (e) { /* ignore */ }
                });
            }

            setComputedResults(finalResults);
        }, 100);
        return () => clearTimeout(timeout);
    }, [text, aiLogic]);

    useEffect(() => {
        const timer = setTimeout(() => callLocalLLM(text), 800);
        return () => clearTimeout(timer);
    }, [text]);

    // Note: formatValue is imported from utils/formatters

    const lines = text.split('\n');

    return (
        <div
            className={`h-screen w-full bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 font-mono flex flex-col overflow-hidden`}
            onContextMenu={(e) => {
                e.preventDefault();
                setGlobalContextMenu({ x: e.clientX, y: e.clientY });
                setActiveMenu(null);
                setContextMenu(null); // Close file context menu if open
            }}
            onClick={() => setGlobalContextMenu(null)} // Close on left click
        >
            {/* Hidden File Input for Import */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".calc,.txt"
                className="hidden"
            />

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
            <header className={`h-10 flex-none flex items-center px-3 gap-4 border-b ${BORDER_COLOR} bg-white dark:bg-zinc-950 text-xs relative z-50`}>
                <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-bold tracking-tight">
                    <div className="w-4 h-4 bg-blue-600 flex items-center justify-center rounded-sm">
                        <span className="text-[10px] text-white font-mono">Σ</span>
                    </div>
                    <span>NeoCalc</span>
                </div>

                <div className="h-4 w-[1px] bg-zinc-100 dark:bg-zinc-800 mx-2"></div>

                {/* File Menu */}
                <div className="relative">
                    <button
                        onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'file' ? null : 'file'); }}
                        className={`px-2 py-1 rounded hover:bg-zinc-100 dark:bg-zinc-800 transition-colors ${activeMenu === 'file' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : ''}`}
                    >
                        File
                    </button>
                    {activeMenu === 'file' && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="absolute top-full left-0 mt-1 w-48 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden"
                        >
                            <button onClick={handleNewFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <FilePlus className="w-3.5 h-3.5" /> New File <span className="ml-auto text-zinc-600">⌘N</span>
                            </button>
                            <button onClick={handleSaveFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Save className="w-3.5 h-3.5" /> Save <span className="ml-auto text-zinc-600">⌘S</span>
                            </button>
                            <button onClick={triggerImport} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <FileText className="w-3.5 h-3.5" /> Import <span className="ml-auto text-zinc-600">⌘O</span>
                            </button>
                            <button onClick={handleExportFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Download className="w-3.5 h-3.5" /> Export
                            </button>

                            <a href="/" className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left block">
                                Classic UI
                            </a>
                        </motion.div>
                    )}
                </div>

                {/* Edit Menu */}
                <div className="relative">
                    <button
                        onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'edit' ? null : 'edit'); }}
                        className={`px-2 py-1 rounded hover:bg-zinc-100 dark:bg-zinc-800 transition-colors ${activeMenu === 'edit' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : ''}`}
                    >
                        Edit
                    </button>
                    {activeMenu === 'edit' && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="absolute top-full left-0 mt-1 w-44 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden"
                        >
                            <button onClick={() => { document.execCommand('undo'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Undo className="w-3.5 h-3.5" /> Undo <span className="ml-auto text-zinc-600">⌘Z</span>
                            </button>
                            <button onClick={() => { document.execCommand('redo'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Redo className="w-3.5 h-3.5" /> Redo <span className="ml-auto text-zinc-600">⇧⌘Z</span>
                            </button>

                            <button onClick={() => { document.execCommand('cut'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Scissors className="w-3.5 h-3.5" /> Cut <span className="ml-auto text-zinc-600">⌘X</span>
                            </button>
                            <button onClick={() => { document.execCommand('copy'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Copy className="w-3.5 h-3.5" /> Copy <span className="ml-auto text-zinc-600">⌘C</span>
                            </button>
                        </motion.div>
                    )}
                </div>

                {/* View Menu */}
                <div className="relative">
                    <button
                        onClick={(e) => { e.stopPropagation(); setActiveMenu(activeMenu === 'view' ? null : 'view'); }}
                        className={`px-2 py-1 rounded hover:bg-zinc-100 dark:bg-zinc-800 transition-colors ${activeMenu === 'view' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : ''}`}
                    >
                        View
                    </button>
                    {activeMenu === 'view' && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="absolute top-full left-0 mt-1 w-48 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden"
                        >
                            <button onClick={() => { setShowSidebar(!showSidebar); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                {showSidebar ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                {showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
                            </button>
                            <button onClick={() => { setShowDebugPanel(!showDebugPanel); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                <Terminal className="w-3.5 h-3.5" />
                                {showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel'}
                            </button>

                            <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setActiveMenu(null); }} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left">
                                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                            </button>
                        </motion.div>
                    )}
                </div>

                {/* Centered Search Bar */}
                <div className="absolute left-1/2 -translate-x-1/2">
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowCommandPalette(true); }}
                        className="flex items-center gap-3 px-4 py-1.5 w-[400px] rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer group"
                    >
                        <Search className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-500 flex-none" />
                        <span className="text-zinc-400 text-xs flex-1 text-left truncate">Search files or type &gt; for commands...</span>
                        <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-zinc-400 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded flex-none">
                            <Command className="w-2.5 h-2.5" />K
                        </kbd>
                    </button>
                </div>

                <div className="flex-1" onClick={() => setActiveMenu(null)} />

                <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                    <div className="flex items-center px-2">
                        {saveStatus === 'unsaved' && <span className="text-yellow-500 text-xs">● Unsaved</span>}
                        {saveStatus === 'saving' && <span className="text-zinc-400 text-xs animate-pulse">Saving...</span>}
                        {saveStatus === 'saved' && <span className="text-zinc-300 dark:text-zinc-600 text-xs">Saved</span>}
                    </div>
                </div>
            </header>

            {/* --- MAIN CONTENT --- */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* SIDEBAR (Explorer) */}
                <AnimatePresence>
                    {showSidebar && (
                        <motion.aside
                            key="sidebar"
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 256, opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                            className={`flex-none border-r ${BORDER_COLOR} bg-white dark:bg-zinc-950 flex flex-col overflow-hidden`}
                        >
                            <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 flex justify-between items-center border-b border-zinc-100 dark:border-zinc-800">
                                <span>Explorer</span>
                                <button onClick={handleNewFile} className="hover:text-blue-500 transition-colors p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto pb-2">
                                {files.map(file => (
                                    <div
                                        key={file.id}
                                        onClick={() => openFile(file)}
                                        onContextMenu={(e) => handleContextMenu(e, file)}
                                        className={`px-3 py-1.5 flex items-center gap-2 cursor-pointer text-sm group relative ${currentFileId === file.id ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                                    >
                                        <FileText className={`w-3.5 h-3.5 flex-none ${currentFileId === file.id ? 'text-blue-500' : 'text-zinc-400 dark:text-zinc-600 group-hover:text-blue-500'}`} />

                                        {renamingFileId === file.id ? (
                                            <form onSubmit={handleRenameSubmit} className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={renameValue}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onBlur={handleRenameSubmit}
                                                    className="w-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-blue-500 rounded px-1 py-0.5 text-xs focus:outline-none"
                                                />
                                            </form>
                                        ) : (
                                            <span
                                                className="truncate flex-1 text-zinc-700 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors"
                                                title={file.title}
                                            >
                                                {file.title.replace('.calc', '')}
                                                <span className="text-zinc-400 dark:text-zinc-600 opacity-50 text-[10px] ml-1">.calc</span>
                                            </span>
                                        )}

                                        <span className="text-[10px] text-zinc-700 whitespace-nowrap">
                                            {formatRelativeTime(file.updatedAt)}
                                        </span>

                                        {/* Quick Actions (Hover) */}
                                        <div className="absolute right-0 top-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center pr-2 pl-6 bg-gradient-to-l from-zinc-100 via-zinc-100 to-transparent dark:from-zinc-800 dark:via-zinc-800 dark:to-transparent">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }}
                                                className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                                            >
                                                <MoreHorizontal className="w-3 h-3 text-zinc-500 dark:text-zinc-400" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.aside>
                    )}
                </AnimatePresence>

                {/* --- CONTEXT MENU --- */}
                <AnimatePresence>
                    {contextMenu && (
                        <>
                            <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}></div>
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.1 }}
                                className="fixed z-50 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl w-48 overflow-hidden"
                                style={{ top: contextMenu.y, left: contextMenu.x }}
                            >
                                <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                                    {contextMenu.file.title}
                                </div>
                                <button onClick={handleRenameStart} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left text-sm text-zinc-300">
                                    <Edit2 className="w-3.5 h-3.5" /> Rename
                                </button>
                                <button onClick={handleDuplicateFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:bg-zinc-800 text-left text-sm text-zinc-300">
                                    <Copy className="w-3.5 h-3.5" /> Duplicate
                                </button>

                                <button onClick={handleDeleteFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-red-900/30 text-left text-sm text-red-400">
                                    <TrashIcon className="w-3.5 h-3.5" /> Delete
                                </button>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

                {/* --- EDITOR CONTENT --- */}
                <main className="flex-1 flex flex-col min-w-0 bg-black relative">
                    {/* TABS */}
                    <div className="flex-none flex items-center bg-white dark:bg-zinc-950 border-b border-zinc-900 overflow-x-auto no-scrollbar">
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                onClick={() => {
                                    const file = files.find(f => f.id === tab.id);
                                    if (file) openFile(file);
                                }}
                                onContextMenu={(e) => {
                                    const file = files.find(f => f.id === tab.id);
                                    if (file) handleContextMenu(e, file);
                                }}
                                className={`
                                    group flex items-center gap-2 px-3 py-2.5 text-xs cursor-pointer select-none min-w-[120px] max-w-[200px] border-r border-zinc-900
                                    ${tab.active ? ACTIVE_TAB_COLOR : INACTIVE_TAB_COLOR}
                                    transition-colors relative
                                `}
                            >
                                <FileText className={`w-3.5 h-3.5 ${tab.active ? 'text-blue-400' : 'text-zinc-600'}`} />
                                <span className="truncate flex-1" title={tab.title}>{tab.title}</span>
                                <button
                                    onClick={(e) => closeTab(e, tab.id)}
                                    className={`
                                        p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:bg-zinc-800 hover:text-red-400 transition-all
                                        ${tab.active ? 'opacity-100' : ''}
                                    `}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* ========== EDITOR AREA ========== */}
                    {currentFileId ? (
                        <div
                            className="flex-1 flex overflow-hidden bg-white dark:bg-zinc-950"
                            ref={outputRef}
                        >
                            {/* Line Numbers */}
                            <div
                                ref={lineNumbersRef}
                                className="w-12 flex-none border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 overflow-hidden"
                            >
                                <div className="pr-3 text-right">
                                    {lines.map((_, i) => (
                                        <div key={i} className="h-[32px] flex items-center justify-end text-zinc-500 dark:text-zinc-600 text-xs select-none">
                                            {i + 1}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Text Editor */}
                            <div className="flex-1 relative overflow-hidden">
                                <textarea
                                    ref={textareaRef}
                                    value={text}
                                    onChange={handleTextChange}
                                    onScroll={(e) => {
                                        // Sync all panels
                                        const scrollTop = e.target.scrollTop;
                                        if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = scrollTop;
                                        if (outputRef.current) {
                                            const outputPanel = outputRef.current.querySelector('#output-panel');
                                            if (outputPanel) outputPanel.scrollTop = scrollTop;
                                        }
                                    }}
                                    className="absolute inset-0 w-full h-full bg-transparent border-none outline-none resize-none px-4 font-mono text-sm leading-[32px] text-zinc-900 dark:text-zinc-300 caret-blue-500 placeholder-zinc-700 overflow-y-scroll"
                                    style={{ scrollbarWidth: 'none' }}
                                    spellCheck="false"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Tab') {
                                            e.preventDefault();
                                            document.execCommand('insertText', false, '    ');
                                        }
                                    }}
                                />
                            </div>

                            {/* Draggable Divider */}
                            <div
                                onMouseDown={handleDividerMouseDown}
                                className={`w-2 flex-none cursor-col-resize bg-zinc-200 dark:bg-zinc-800 hover:bg-blue-500 active:bg-blue-500 transition-colors flex items-center justify-center ${isDragging ? 'bg-blue-500' : ''}`}
                            >
                                {/* Grip dots */}
                                <div className="flex flex-col gap-1 opacity-40">
                                    <div className="w-1 h-1 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                                    <div className="w-1 h-1 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                                    <div className="w-1 h-1 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                                </div>
                            </div>

                            {/* Results Panel */}
                            <div
                                id="output-panel"
                                className="flex-none border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0a0a0c] overflow-y-scroll"
                                style={{ width: outputPanelWidth, scrollbarWidth: 'none' }}
                                onScroll={(e) => {

                                    // Sync back to textarea
                                    const scrollTop = e.target.scrollTop;
                                    if (textareaRef.current) textareaRef.current.scrollTop = scrollTop;
                                    if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = scrollTop;
                                }}
                            >
                                <div className="px-4">
                                    {lines.map((line, idx) => {
                                        const data = computedResults[idx];
                                        const trimmed = line.trim();

                                        // Empty line
                                        if (!trimmed) {
                                            return <div key={idx} className="h-[32px]">&nbsp;</div>;
                                        }

                                        // Header
                                        if (trimmed.startsWith('#')) {
                                            const headerText = trimmed.replace(/^#+\s*/, '');
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-500 dark:text-zinc-400 font-semibold text-sm">
                                                    {headerText}
                                                </div>
                                            );
                                        }

                                        // Comment
                                        if (trimmed.startsWith('//')) {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-600 italic text-xs opacity-60">
                                                    {trimmed.slice(2).trim()}
                                                </div>
                                            );
                                        }

                                        // Loading
                                        if (loading && !data) {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end">
                                                    <div className="w-16 h-3 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
                                                </div>
                                            );
                                        }

                                        // No data
                                        if (!data) {
                                            return <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-600 text-sm">—</div>;
                                        }

                                        // Note/Header type
                                        if (data.type === 'header' || data.type === 'note') {
                                            return (
                                                <div key={idx} className="h-[32px] flex items-center justify-end text-zinc-500 text-xs italic">
                                                    {data.explanation || '—'}
                                                </div>
                                            );
                                        }

                                        // Calculated value
                                        const isTotal = data.type === 'total' || trimmed.toLowerCase().includes('total');
                                        const isAI = data.source === 'ai';

                                        return (
                                            <div
                                                key={idx}
                                                className={`group h-[32px] flex items-center gap-2 cursor-pointer -mx-4 px-4 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors ${isTotal ? 'bg-blue-500/10 border-t border-blue-500/20' : ''}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setTracePopup(tracePopup?.lineIdx === idx ? null : {
                                                        lineIdx: idx,
                                                        x: e.clientX - 140, // Center the popup roughly on click
                                                        y: e.clientY + 10   // Slightly below click
                                                    });
                                                }}
                                            >
                                                {/* Spacer pushes everything to the right */}
                                                <span className="flex-1" />

                                                {/* Icon for AI-generated results */}
                                                {isAI && (
                                                    <span className="text-[10px] flex-none">
                                                        ✨
                                                    </span>
                                                )}

                                                {/* Explanation */}
                                                {data.explanation && (
                                                    <span className="text-zinc-500 dark:text-zinc-500 text-xs truncate max-w-[60%] text-right">
                                                        {data.explanation} =
                                                    </span>
                                                )}

                                                {/* Value */}
                                                <span className={`font-semibold flex-none ${isTotal ? 'text-blue-500 text-lg font-bold' : 'text-blue-400'}`}>
                                                    {formatValue(data.value, data.format || 'currency')}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-4">
                            <div className="w-16 h-16 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-2">
                                <Search className="w-8 h-8 opacity-50" />
                            </div>
                            <p>Select a file to start editing</p>
                            <button onClick={handleNewFile} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors">
                                Create New File
                            </button>
                        </div>
                    )}

                    {/* ===== TRACE POPUP - Shows formula breakdown ===== */}
                    {tracePopup && computedResults[tracePopup.lineIdx] && (
                        <div
                            className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl min-w-[280px] max-w-[400px]"
                            style={{
                                left: tracePopup.x,
                                top: tracePopup.y
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Draggable header */}
                            <div
                                className="flex justify-between items-center p-4 pb-2 cursor-move border-b border-zinc-800 mb-2"
                                onMouseDown={handlePopupDragStart}
                            >
                                <div className="text-xs text-zinc-400 uppercase tracking-wider select-none">
                                    Line {tracePopup.lineIdx + 1} Breakdown
                                </div>
                                <button
                                    onClick={() => setTracePopup(null)}
                                    className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    ×
                                </button>
                            </div>

                            <div className="px-4 pb-4">

                                {/* Input line */}
                                <div className="text-zinc-500 text-xs mb-2">Input:</div>
                                <div className="bg-zinc-800/50 rounded px-3 py-2 font-mono text-xs text-zinc-300 mb-3">
                                    {lines[tracePopup.lineIdx]}
                                </div>

                                {/* Formula */}
                                {computedResults[tracePopup.lineIdx].formula && (
                                    <>
                                        <div className="text-zinc-500 text-xs mb-2">
                                            {computedResults[tracePopup.lineIdx].source === 'ai' ? 'AI Formula:' : 'Evaluated as:'}
                                        </div>
                                        <div className="bg-zinc-800/50 rounded px-3 py-2 font-mono text-xs text-blue-400 mb-3">
                                            {computedResults[tracePopup.lineIdx].formula}
                                        </div>
                                    </>
                                )}

                                {/* Sum breakdown - show contributing tagged lines */}
                                {computedResults[tracePopup.lineIdx].type === 'total' && (() => {
                                    // Check if this is a sum: tagname line
                                    const inputLine = lines[tracePopup.lineIdx].trim();
                                    const sumMatch = inputLine.match(/^sum\s*:\s*([A-Za-z0-9][\w\s-]*)\s*$/i);
                                    if (!sumMatch) return null;

                                    const targetTag = sumMatch[1].toLowerCase().trim();
                                    const contributors = [];

                                    // Find all lines with this tag
                                    for (let i = 0; i < tracePopup.lineIdx; i++) {
                                        const lineTag = extractTag(lines[i] || '');
                                        if (lineTag === targetTag) {
                                            const value = computedResults[i]?.value;
                                            if (Number.isFinite(value)) {
                                                // Get a short label for this line
                                                const lineContent = lines[i].trim();
                                                const colonIdx = lineContent.indexOf(':');
                                                const eqIdx = lineContent.indexOf('=');
                                                let label = lineContent;
                                                if (colonIdx > 0) label = lineContent.slice(0, colonIdx);
                                                else if (eqIdx > 0) label = lineContent.slice(0, eqIdx);
                                                label = label.replace(/#\w+/g, '').trim(); // Remove tags from label

                                                contributors.push({ line: i + 1, label, value });
                                            }
                                        }
                                    }

                                    if (contributors.length === 0) return null;

                                    return (
                                        <>
                                            <div className="text-zinc-500 text-xs mb-2">
                                                Lines tagged #{targetTag}:
                                            </div>
                                            <div className="bg-zinc-800/50 rounded divide-y divide-zinc-700/50 mb-3">
                                                {contributors.map((c, i) => (
                                                    <div key={i} className="px-3 py-2 flex justify-between items-center text-xs">
                                                        <span className="text-zinc-400">
                                                            <span className="text-zinc-600 mr-2">L{c.line}</span>
                                                            {c.label}
                                                        </span>
                                                        <span className="text-blue-400 font-mono">
                                                            {formatValue(c.value, 'number')}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    );
                                })()}

                                {/* Result */}
                                <div className="flex justify-between items-center pt-2 border-t border-zinc-700">
                                    <span className="text-zinc-400 text-sm">Result:</span>
                                    <span className="text-blue-400 font-bold text-lg">
                                        {formatValue(computedResults[tracePopup.lineIdx].value, computedResults[tracePopup.lineIdx].format || 'number')}
                                    </span>
                                </div>

                                {/* Source indicator */}
                                <div className="flex items-center gap-1 mt-2 text-[10px] text-zinc-500">
                                    {computedResults[tracePopup.lineIdx].source === 'ai' ? (
                                        '✨ Calculated by AI'
                                    ) : (
                                        'Calculated locally'
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Click outside to close trace popup */}
                    {tracePopup && (
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setTracePopup(null)}
                        />
                    )}

                    {/* STATUS BAR */}
                    <div className={`h-8 flex-none border-t ${BORDER_COLOR} bg-white dark:bg-zinc-950 flex items-center px-3 gap-4 text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider`}>
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

                {/* DEBUG PANEL */}
                <DebugPanel
                    isOpen={showDebugPanel}
                    onClose={() => setShowDebugPanel(false)}
                    serverStatus={serverStatus}
                    lastInput={lastInput}
                    lastOutput={lastOutput}
                    computedResults={computedResults}
                />

                {/* CONFIRMATION MODAL */}
                <ConfirmationModal
                    isOpen={!!modalConfig}
                    type={modalConfig?.type}
                    title={modalConfig?.title}
                    message={modalConfig?.message}
                    onConfirm={modalConfig?.onConfirm}
                    onCancel={modalConfig?.onCancel}
                />

            </div>
            {/* TOAST NOTIFICATION */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        key="toast"
                        initial={{ opacity: 0, y: 20, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 20, x: '-50%' }}
                        className="fixed bottom-12 left-1/2 flex items-center gap-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-4 py-2 rounded-full shadow-lg text-sm z-[200]"
                    >
                        {toast.icon}
                        <span>{toast.message}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* COMMAND PALETTE */}
            <AnimatePresence>
                {showCommandPalette && (
                    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[20vh] px-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm"
                            onClick={() => setShowCommandPalette(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[60vh]"
                        >
                            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                                <Search className="w-5 h-5 text-zinc-400" />
                                <input
                                    ref={commandInputRef}
                                    type="text"
                                    placeholder="Search files or type > for commands..."
                                    value={commandSearch}
                                    onChange={e => setCommandSearch(e.target.value)}
                                    className="flex-1 bg-transparent border-none outline-none text-base placeholder-zinc-400 text-zinc-900 dark:text-zinc-100"
                                    autoFocus
                                />
                                <div className="flex gap-1">
                                    <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-500">ESC</span>
                                </div>
                            </div>
                            <div className="overflow-y-auto p-2">
                                {filteredCommands.length === 0 ? (
                                    <div className="p-4 text-center text-zinc-500 text-sm">No results found</div>
                                ) : (
                                    filteredCommands.map(cmd => (
                                        <button
                                            key={cmd.id}
                                            onClick={() => {
                                                cmd.action();
                                                setShowCommandPalette(false);
                                            }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left group"
                                        >
                                            <div className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                                                {cmd.icon}
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{cmd.label}</div>
                                                {cmd.desc && <div className="text-xs text-zinc-500">{cmd.desc}</div>}
                                            </div>
                                            {cmd.shortcut && (
                                                <span className="text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800">
                                                    {cmd.shortcut}
                                                </span>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Global Context Menu */}
            <AnimatePresence>
                {globalContextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="fixed z-[100] w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden"
                        style={{ top: globalContextMenu.y, left: globalContextMenu.x }}
                        onClick={(e) => e.stopPropagation()} // Prevent closing immediately
                    >
                        <button onClick={handleNewFile} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left text-sm text-zinc-700 dark:text-zinc-200">
                            <FilePlus className="w-3.5 h-3.5" /> New File
                        </button>
                        <button onClick={triggerImport} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left text-sm text-zinc-700 dark:text-zinc-200">
                            <FileText className="w-3.5 h-3.5" /> Import File
                        </button>

                        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left text-sm text-zinc-700 dark:text-zinc-200">
                            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                            Toggle Theme
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};


// Force HMR update
export default NeoCalcUI;
