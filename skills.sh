#!/bin/bash
# Agent Skills Link Script
# Links this skill to a supported AI coding agent CLI.
# Usage: ./skills.sh

linked=0

if command -v gemini &> /dev/null; then
  echo "Linking 'orch' skill to Gemini CLI..."
  gemini skills link .
  linked=1
fi

if [ $linked -eq 0 ]; then
  echo "No supported agent CLI found."
  echo "Supported tools: Gemini CLI (gemini)"
  echo ""
  echo "You can also use this skill manually:"
  echo "  1. Copy assets/orchestrator-template.js to your project as .orch/cli.js"
  echo "  2. Create .orch/plan/TASKS.md and .orch/plan/AGENT_STATUS.json"
  echo "  3. Run: node .orch/cli.js --init"
  exit 1
fi
