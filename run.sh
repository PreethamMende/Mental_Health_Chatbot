#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  MindCare AI — Run Script
#  Usage:  bash run.sh
#  Starts FastAPI backend + npm frontend dev server concurrently.
#  Make sure Ollama is running first:  ollama serve
# ═══════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Activate Python venv
source .venv/bin/activate

echo -e "${GREEN}Starting MindCare AI…${NC}"
echo -e "${YELLOW}Backend  → http://127.0.0.1:8000${NC}"
echo -e "${YELLOW}Frontend → http://localhost:3000${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop both.${NC}"
echo ""

# Run backend and frontend in parallel
trap "kill 0" EXIT

# FastAPI backend
uvicorn app:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend dev server (npm start or npx serve .)
if grep -q '"start"' package.json; then
  npm start &
else
  npx serve . -p 3000 &
fi
FRONTEND_PID=$!

wait $BACKEND_PID $FRONTEND_PID
