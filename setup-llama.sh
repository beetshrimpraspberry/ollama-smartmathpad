#!/bin/bash

# setup-llama.sh
# Script to setup llama.cpp and download Qwen2.5-7B-Instruct

set -e

echo "Checking for llama-server..."

if [ ! -f "llama-server" ]; then
    echo "llama-server not found in current directory."
    
    # Check if brew installed
    if command -v llama-server &> /dev/null; then
        echo "llama-server found in PATH (via brew or other)."
        # Symlink
        ln -sf $(which llama-server) ./llama-server
    elif [ -f "/opt/homebrew/bin/llama-server" ]; then
         echo "llama-server found in /opt/homebrew/bin"
         ln -sf /opt/homebrew/bin/llama-server ./llama-server
    else
        echo "llama.cpp not found. Attempting to build from source or asking user to install..."
        
        if command -v brew &> /dev/null; then
           echo "Homebrew found. Please instal llama.cpp manually if this script fails:"
           echo "brew install llama.cpp"
        fi

        if ! command -v cmake &> /dev/null; then
            echo "Error: 'cmake' is not installed or not in PATH."
            echo "Please install it (e.g., 'brew install cmake') OR install llama.cpp directly via brew:"
            echo "  brew install llama.cpp"
            exit 1
        fi

        if [ -d "llama.cpp" ]; then
            cd llama.cpp
            git pull
        else
            git clone https://github.com/ggerganov/llama.cpp
            cd llama.cpp
        fi

        echo "Building with CMake..."
        cmake -B build
        cmake --build build --config Release -j
        
        # Copy binary to root
        if [ -f "build/bin/llama-server" ]; then
            cp build/bin/llama-server ../
        elif [ -f "build/src/llama-server" ]; then
            cp build/src/llama-server ../
        else
            echo "Could not find built llama-server binary. Please look in llama.cpp/build/bin"
            exit 1
        fi
        
        cd ..
        echo "Build complete. llama-server is now in the current directory."
    fi
fi

MODEL_DIR="models"
mkdir -p $MODEL_DIR

# Using bartowski repo which is reliable for GGUFs
MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf"
# Local filename (lowercase to match our config)
MODEL_FILE="$MODEL_DIR/qwen2.5-7b-instruct-q4_k_m.gguf"

# Check if model exists and is valid (size > 1MB)
if [ -f "$MODEL_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE" 2>/dev/null || echo 0)
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "Existing model file is too small (likely corrupted or 404 page). Deleting..."
        rm "$MODEL_FILE"
    fi
fi

if [ ! -f "$MODEL_FILE" ]; then
    echo "Downloading Qwen2.5-7B-Instruct (Q4_K_M) from bartowski repo..."
    if command -v wget &> /dev/null; then
        # wget usually handles redirects well
        wget -O "$MODEL_FILE" "$MODEL_URL"
    else
        # curl -L needed for redirects
        curl -L -o "$MODEL_FILE" "$MODEL_URL"
    fi
    echo "Download complete."
else
    echo "Model file already exists."
fi

echo ""
echo "Setup complete!"
echo "To run the server, execute:"
echo "./llama-server -m $MODEL_FILE --port 8080 -c 4096 --host 0.0.0.0"
