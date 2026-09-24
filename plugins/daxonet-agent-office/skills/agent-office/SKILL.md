---
name: agent-office
description: Start and explain the DAXONET agent office - a cyberpunk pixel office with three apps. Use when the user wants to watch their Claude Code sessions or subagents as characters ("agent office", "visualizer", "show my agents"), run the DAXONET AI town simulation where characters think with Claude, or have the DAXONET virtual company (CEO, CTO, developer, reviewer, QA) build a small project from an idea.
---

# DAXONET agent office

The app is the plugin's `app/` folder, two levels up from this skill's base directory: `<skill base directory>/../../app`
(call it APP below). It needs Node.js 20+. Each app is a small local web server; start it in the background and give the user the URL.

| App | Start (from APP) | URL | Needs API key |
|---|---|---|---|
| 1. Claude Code visualizer | `node 1-claude-code-visualizer/server.mjs` | http://localhost:4801 | No |
| 2. AI town | `node 2-ai-town/server.mjs` | http://localhost:4802 | Yes |
| 3. Virtual company | `node 3-virtual-company/server.mjs` | http://localhost:4803 | Yes |

## 1. Claude Code visualizer
- This plugin already registers the hooks, so every **new** Claude Code session reports to the visualizer automatically. Sessions started before the server was running still appear once they next use a tool.
- The page has a **RUN DEMO SESSION** button for a scripted walkthrough.
- Where a character stands tells you what it's doing: desk = reading/editing files, server racks = shell commands, research lab = searching code or the web, planning room = plans and briefing subagents, reception = MCP connectors, pantry = turn finished, amber `!` = waiting for the user.
- If the visualizer isn't running the hook exits silently in milliseconds; it never blocks Claude Code. To stop the per-event overhead entirely, disable the plugin: `claude plugin disable daxonet-agent-office@AutoCountSkill`.

## 2 and 3 - apps that call Claude
- First run only: `npm install` inside APP (installs `@anthropic-ai/sdk`). Re-run it after a plugin update if the server can't find the SDK.
- They need `ANTHROPIC_API_KEY` in the environment of the terminal that starts the server. Tell the user to create a key in the Anthropic Console and set it themselves (PowerShell: `$env:ANTHROPIC_API_KEY = "sk-ant-..."`). Never ask the user to paste their key into the chat.
- Default model is `claude-opus-5`; set `CLAUDE_MODEL` (e.g. `claude-sonnet-5`) before starting to use a cheaper one. Both pages show live token use and estimated spend.
- **AI town** starts paused - nothing is spent until the user presses START. Calls are capped (`TOWN_CALLS_PER_MIN`, default 6).
- **Virtual company** writes each project to `~/daxonet-studio-projects/<name>-<timestamp>/` (override with `COMPANY_WORKSPACE`). File writes cannot leave that folder. QA only executes tests when the user ticks "Let QA run the tests", because that runs agent-written code on their machine.

## Ports
Override with `AGENT_OFFICE_PORT` (visualizer - the hook reads the same variable), `TOWN_PORT`, `COMPANY_PORT`.
