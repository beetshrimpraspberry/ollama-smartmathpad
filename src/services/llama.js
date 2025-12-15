export const checkServerStatus = async () => {
    try {
        const response = await fetch('http://localhost:8080/health');
        return response.ok;
    } catch (e) {
        return false;
    }
};

export const runMathAnalysis = async (content) => {
    try {
        const response = await fetch('http://localhost:8080/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [
                    {
                        role: "system",
                        content: "You are a smart calculator assistant. Your task is to analyze the user's math notes line-by-line. For each line that contains a math expression or question, provide the calculated result or answer. If a line is just text/comment, output null or empty string. Return your response as a JSON array of strings, matching the number of lines in the input. Example: Input:\n10 + 5\nHello\n2 * 4\nOutput: [\"15\", \"\", \"8\"]"
                    },
                    { role: "user", content: content }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" } // Qwen/Llama might support json mode
            }),
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling Llama:', error);
        throw error;
    }
};
