'use strict';

/**
 * prompt-builder.js
 *
 * Shared prompt generator for ALL adapters.
 *
 * Every adapter calls buildPrompt(context) to get the text it passes to the
 * AI tool. This single place controls:
 *
 *   - The task identity header (who the agent is, what task it's on)
 *   - The mission brief (injected from MISSION_BRIEF.md)
 *   - Interrupt handling rules:
 *       • Permission prompts  → handled by CLI flags in each adapter,
 *                               but the prompt also tells the agent not to ask
 *       • Clarifying questions → write QUESTIONS.md + call --question
 *       • Runtime blockers     → write BLOCKER.md + call --fail
 *   - The done command the agent must run when finished
 *
 * Because this file is shared, fixing interrupt behaviour here fixes it for
 * claude-code, gemini-cli, opencode, qwen-code, kilocode, and any future
 * adapter automatically.
 */

const fs = require('node:fs');

/**
 * buildPrompt(params)
 *
 * @param {object} params
 * @param {string}  params.taskId      - e.g. "API-3"
 * @param {string}  params.agentName   - e.g. "priya"
 * @param {string}  params.brief       - full text of MISSION_BRIEF.md
 * @param {string}  params.doneCmd     - shell command agent runs on completion
 * @param {string}  params.orchCliPath - absolute path to .orch/cli.js
 * @param {boolean} params.headless    - true = background, no human watching
 * @returns {string} the full prompt text
 */
function buildPrompt({ taskId, agentName, brief, doneCmd, orchCliPath, headless }) {
  const questionCmd = `node "${orchCliPath}" --question ${taskId}`;
  const failCmd     = `node "${orchCliPath}" --fail ${taskId}`;

  const interruptRules = headless
    ? buildHeadlessRules(questionCmd, failCmd)
    : buildInteractiveRules(failCmd);

  return [
    `You are ${agentName}, an AI coding agent assigned to task ${taskId}.`,
    ``,
    `════════════════════════════════════════`,
    `MISSION BRIEF`,
    `════════════════════════════════════════`,
    brief.trim(),
    `════════════════════════════════════════`,
    ``,
    interruptRules,
    ``,
    `════════════════════════════════════════`,
    `COMPLETION`,
    `════════════════════════════════════════`,
    `When ALL objectives are done and the Definition of Done is satisfied,`,
    `run this exact command:`,
    ``,
    `  ${doneCmd}`,
    ``,
    `Do NOT run --done until the work is truly complete and tested.`,
    `Do NOT ask for permission before editing files listed in Authorized Files.`,
  ].join('\n');
}

// ─── Headless rules (no human is watching) ───────────────────────────────────

function buildHeadlessRules(questionCmd, failCmd) {
  return `════════════════════════════════════════
INTERRUPT PROTOCOL  (HEADLESS MODE)
════════════════════════════════════════
You are running NON-INTERACTIVELY. There is no human at this terminal.

── If you need to ask a question ────────────────────────────────────────────
1. Create QUESTIONS.md in your current working directory.
2. Write your question clearly. Include:
   - What you are trying to decide
   - What you already know / tried
   - What you need the human to specify
3. Run this command and then STOP all work:

   ${questionCmd} "<one sentence summary of your question>"

Do NOT guess on ambiguous architecture decisions.
Do NOT keep coding after writing QUESTIONS.md.
A human will answer and re-spawn you with the answer written into QUESTIONS.md.

── If you hit a hard blocker ────────────────────────────────────────────────
A hard blocker is: a missing dependency you cannot install, a failing test you
have tried 2+ approaches to fix, or a decision only a human can make.

1. Create BLOCKER.md explaining the issue and what you already tried.
2. Run:

   ${failCmd} "<one sentence description of the blocker>"

Do NOT spin retrying the same broken approach more than twice.

── Permissions ───────────────────────────────────────────────────────────────
You have permission to:
  - Run bash commands (git, npm, node, file operations)
  - Read and write any file listed in "Authorized Files" above
  - Run the orchestrator commands shown in this brief
Do NOT ask for permission before doing these things. Just do them.`.trim();
}

// ─── Interactive rules (human is present in the terminal) ────────────────────

function buildInteractiveRules(failCmd) {
  return `════════════════════════════════════════
INTERRUPT PROTOCOL  (INTERACTIVE MODE)
════════════════════════════════════════
A human is available in this session.

── If you have questions ────────────────────────────────────────────────────
Ask in the chat before proceeding on anything ambiguous.
Do not make assumptions on architecture decisions — ask first.

── If you hit a hard blocker ────────────────────────────────────────────────
Tell the human what is wrong and what you have tried.
If the human cannot help right now, run:

  ${failCmd} "<one sentence description of the blocker>"`.trim();
}

// ─── Helpers used by adapters ─────────────────────────────────────────────────

/**
 * readBrief(briefPath) → string
 * Safely reads MISSION_BRIEF.md. Returns empty string if file is missing.
 */
function readBrief(briefPath) {
  try { return fs.readFileSync(briefPath, 'utf8'); }
  catch { return '(Brief not found — check that --start was run before --spawn)'; }
}

module.exports = { buildPrompt, readBrief };
