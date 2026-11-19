#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  MindCare AI — macOS Setup Script
#  Run once:  bash setup_mac.sh
# ═══════════════════════════════════════════════════════════════════
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   MindCare AI — macOS Setup Script    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"

# ── 1. Homebrew ──────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo -e "${YELLOW}Installing Homebrew…${NC}"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo -e "${GREEN}✅ Homebrew already installed${NC}"
fi

# ── 2. Python 3.11 ──────────────────────────────────────────────────
if ! command -v python3.11 &>/dev/null; then
  echo -e "${YELLOW}Installing Python 3.11…${NC}"
  brew install python@3.11
else
  echo -e "${GREEN}✅ Python 3.11 already installed${NC}"
fi

PYTHON=python3.11

# ── 3. libsndfile (required by librosa on macOS) ────────────────────
if ! brew list libsndfile &>/dev/null; then
  echo -e "${YELLOW}Installing libsndfile (needed by librosa)…${NC}"
  brew install libsndfile
else
  echo -e "${GREEN}✅ libsndfile already installed${NC}"
fi

# ── 4. ffmpeg (needed by librosa for .webm decoding) ────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo -e "${YELLOW}Installing ffmpeg…${NC}"
  brew install ffmpeg
else
  echo -e "${GREEN}✅ ffmpeg already installed${NC}"
fi

# ── 5. Node / npm ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${YELLOW}Installing Node.js…${NC}"
  brew install node
else
  echo -e "${GREEN}✅ Node.js already installed${NC}"
fi

# ── 6. Ollama ────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  echo -e "${YELLOW}Installing Ollama…${NC}"
  brew install ollama
else
  echo -e "${GREEN}✅ Ollama already installed${NC}"
fi

# Pull mistral model (skip if already present)
echo -e "${YELLOW}Pulling Mistral model (this may take a while on first run)…${NC}"
ollama pull mistral

# ── 7. Python virtual environment ───────────────────────────────────
echo -e "${YELLOW}Creating Python virtual environment (.venv)…${NC}"
$PYTHON -m venv .venv
source .venv/bin/activate

echo -e "${YELLOW}Installing Python dependencies…${NC}"
pip install --upgrade pip
pip install -r requirements.txt

deactivate

# ── 8. Node dependencies ─────────────────────────────────────────────
echo -e "${YELLOW}Installing Node dependencies…${NC}"
npm install

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  Setup complete!                                       ${NC}"
echo -e "${GREEN}                                                            ${NC}"
echo -e "${GREEN}  To run the project, open TWO terminal tabs:              ${NC}"
echo -e "${GREEN}                                                            ${NC}"
echo -e "${GREEN}  Tab 1 — Start Ollama:                                    ${NC}"
echo -e "${YELLOW}    ollama serve                                           ${NC}"
echo -e "${GREEN}                                                            ${NC}"
echo -e "${GREEN}  Tab 2 — Start Backend + Frontend:                        ${NC}"
echo -e "${YELLOW}    bash run.sh                                            ${NC}"
echo -e "${GREEN}                                                            ${NC}"
echo -e "${GREEN}  Then open: http://localhost:3000 in Chrome or Safari     ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
