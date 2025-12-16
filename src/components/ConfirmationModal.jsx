import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle, X } from 'lucide-react';

const ConfirmationModal = ({ isOpen, type = 'confirm', title, message, onConfirm, onCancel }) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onCancel}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    >
                        {/* Modal */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-sm w-full overflow-hidden"
                        >
                            <div className="p-6">
                                <div className="flex flex-col items-center text-center gap-4">
                                    <div className={`p-3 rounded-full ${type === 'alert' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                        {type === 'alert' ? <AlertCircle className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2 break-words">{title}</h3>
                                        <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">{message}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-zinc-50/50 dark:bg-zinc-950/50 px-6 py-4 flex items-center justify-end gap-3 border-t border-zinc-200/50 dark:border-zinc-800/50">
                                {type === 'confirm' && (
                                    <button
                                        onClick={onCancel}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    onClick={onConfirm}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${type === 'alert'
                                        ? 'bg-red-600 hover:bg-red-500'
                                        : 'bg-blue-600 hover:bg-blue-500'
                                        }`}
                                >
                                    {type === 'alert' ? 'Close' : 'Confirm'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default ConfirmationModal;
