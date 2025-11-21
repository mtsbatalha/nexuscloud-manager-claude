#!/bin/bash

# NexusCloud Manager Installation Script

set -e

echo "=€ Installing NexusCloud Manager..."

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null || echo "not installed")
if [[ "$NODE_VERSION" == "not installed" ]]; then
    echo "L Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1 | sed 's/v//')
if [[ "$NODE_MAJOR" -lt 18 ]]; then
    echo "L Node.js version $NODE_VERSION is not supported. Please install Node.js 18 or higher."
    exit 1
fi

echo " Node.js $NODE_VERSION detected"

# Install dependencies
echo "=æ Installing dependencies..."
npm install

# Build the frontend
echo "=( Building frontend..."
npm run build

# Create necessary directories
mkdir -p uploads_temp logs

echo ""
echo " Installation complete!"
echo ""
echo "To start the application:"
echo "  npm start"
echo ""
echo "To start in development mode:"
echo "  npm run dev"
echo ""
echo "Default credentials:"
echo "  Email: admin@nexus.com"
echo "  Password: admin123"
echo ""
echo "   Remember to:"
echo "  1. Set VITE_GEMINI_API_KEY in .env.local for AI features"
echo "  2. Change the default admin password"
echo "  3. Set a secure JWT_SECRET in production"
