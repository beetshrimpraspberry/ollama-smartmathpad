import React from 'react';

const SplashScreen = ({ isLoading }) => {
    if (!isLoading) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-zinc-950 flex flex-col items-center justify-center">
            {/* Logo */}
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-blue-500/20">
                <span className="text-4xl text-white font-mono font-bold">Σ</span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-zinc-100 tracking-tight mb-2">NeoCalc</h1>
            <p className="text-sm text-zinc-500 mb-8">AI-Powered Smart Calculator</p>

            {/* Loading indicator */}
            <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"
                        style={{ animationDelay: `${i * 150}ms` }}
                    />
                ))}
            </div>
        </div>
    );
};

export default SplashScreen;
