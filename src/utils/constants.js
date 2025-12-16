/**
 * Constants for NeoCalc application
 * 
 * This file centralizes all configuration values and shared constants
 * to make them easy to modify and maintain.
 */

// API endpoint for local LLM server (llama.cpp)
export const LOCAL_API_URL = 'http://localhost:8080/v1/chat/completions';

// Background style used across the app


/**
 * Safe math functions available in user expressions.
 * These are passed to the expression evaluator to allow
 * mathematical functions like sqrt(16) or abs(-5).
 */
export const SAFE_FUNCS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  log: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  PI: Math.PI,
  E: Math.E
};

/**
 * System prompt sent to the LLM for logic extraction.
 * This instructs the AI how to parse natural language math.
 */
export const LLM_SYSTEM_PROMPT = `You are a Logic Extraction Engine for a smart calculator.

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
- Return ONLY valid JSON. Use variable names when available.`;
