#!/bin/bash
# Agent Skills Link Script
# Use this to link this skill to your Gemini CLI.
# Usage: ./skills.sh

if command -v gemini &> /dev/null; then
  echo "Linking 'orch' skill to Gemini CLI..."
  gemini skills link .
else
  echo "Error: Gemini CLI (gemini) is not installed."
  echo "Visit https://geminicli.com for installation instructions."
  exit 1
fi
