@echo off
REM Agent Skills Link Script (Windows)
REM Use this to link this skill to your Gemini CLI.
REM Usage: .\skills.cmd

where gemini >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Gemini CLI (gemini) is not installed.
    echo Visit https://geminicli.com for installation instructions.
    exit /b 1
)

echo Linking 'orch' skill to Gemini CLI...
gemini skills link .
