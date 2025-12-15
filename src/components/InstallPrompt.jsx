import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

const InstallPrompt = () => {
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Check if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        const handler = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
            setShowPrompt(true);
        };

        window.addEventListener('beforeinstallprompt', handler);

        // Check if installed after mount
        window.addEventListener('appinstalled', () => {
            setIsInstalled(true);
            setShowPrompt(false);
        });

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setShowPrompt(false);
        }
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowPrompt(false);
    };

    if (isInstalled || !showPrompt) return null;

    return (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-2xl z-50 animate-in slide-in-from-bottom-4">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-lg text-white font-mono font-bold">Σ</span>
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-100 mb-1">Install NeoCalc</h3>
                    <p className="text-xs text-zinc-500 mb-3">Add to your home screen for quick access</p>

                    <div className="flex gap-2">
                        <button
                            onClick={handleInstall}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Install
                        </button>
                        <button
                            onClick={handleDismiss}
                            className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
                        >
                            Not now
                        </button>
                    </div>
                </div>

                <button
                    onClick={handleDismiss}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default InstallPrompt;
