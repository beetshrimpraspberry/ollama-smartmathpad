import { useState } from 'react';
import { runMathAnalysis } from '../services/llama';

export function useMathEngine() {
    const [results, setResults] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);

    const processContent = async (text) => {
        setIsProcessing(true);
        setError(null);
        try {
            // For demo, we might just mock if server isn't running, but let's try real call
            const jsonStr = await runMathAnalysis(text);
            if (jsonStr) {
                try {
                    // Parse the JSON response. Qwen might wrap it in invalid JSON sometimes if not strict
                    // Expected: { "results": ["...", "..."] } or just ["...", "..."]
                    const parsed = JSON.parse(jsonStr);
                    // Handle different potential formats
                    const resultArray = Array.isArray(parsed) ? parsed : (parsed.results || parsed.answers || []);
                    setResults(resultArray.map(r => String(r || '')));
                } catch (e) {
                    console.error("JSON Parse Error", e);
                    // Fallback: try to split by lines?
                    setResults(jsonStr.split('\n'));
                }
            }
        } catch (err) {
            setError(err.message);
            // Fallback for demo if server is down:
            console.warn("Server likely down, using mock math");
            const lines = text.split('\n');
            setResults(lines.map(line => {
                try {
                    if (line.match(/[\d]/)) {
                        // simplistic eval for integers
                        return String(eval(line.replace(/[^\d+*/()-]/g, '')));
                    }
                    return "";
                } catch { return ""; }
            }));
        } finally {
            setIsProcessing(false);
        }
    };

    return { results, isProcessing, error, processContent };
}
