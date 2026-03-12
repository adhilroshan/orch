@echo off
REM Agent Skills Link Script (Windows)
REM Links this skill to a supported AI coding agent CLI.
REM Usage: .\skills.cmd

where gemini >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Linking 'orch' skill to Gemini CLI...
    gemini skills link .
    goto :done
)

echo No supported agent CLI found.
echo Supported tools: Gemini CLI (gemini)
echo.
echo You can also use this skill manually:
echo   1. Copy assets\orchestrator-template.js to your project as .orch\cli.js
echo   2. Create .orch\plan\TASKS.md and .orch\plan\AGENT_STATUS.json
echo   3. Run: node .orch\cli.js --init
exit /b 1

:done
