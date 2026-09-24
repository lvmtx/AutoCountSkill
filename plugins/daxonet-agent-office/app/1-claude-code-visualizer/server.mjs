// App 1 - live visualizer: every Claude Code session becomes a character; subagents get their own.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, escapeHtml } from "../shared/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AGENT_OFFICE_PORT || 4801);
const IDLE_REMOVE_MS = 45 * 60 * 1000;
const COLORS = ["#00fff2", "#7cff6b", "#7c9bff", "#ffb000", "#ff8a3d", "#c38bff"];

const sessions = new Map();   // session_id -> { charId, name, project, lastSeen, subs:Set<charId> }
const chars = new Map();      // charId -> last upsert payload (for snapshots)
const logs = [];
let eventCount = 0;
let colorIdx = 0;

const app = startServer({
  port: PORT, appDir: HERE, name: "claude-code-visualizer",
  snapshot: () => [
    ...Array.from(chars.values()).map(agent => ({ type:"upsert", agent })),
    ...logs.slice(-40).map(html => ({ type:"log", html })),
    stats()
  ],
  routes: {
    "POST /hook": async (input) => { handle(input); return { ok:true }; },
    "POST /demo": async () => { runDemo(); return { ok:true }; }
  }
});

function stats(){
  let subs = 0;
  sessions.forEach(s => { subs += s.subs.size; });
  return { type:"stats", sessions:sessions.size, subagents:subs, events:eventCount };
}
function emit(evt){ app.broadcast(evt); }
function log(html){
  logs.push(html);
  if (logs.length > 200) logs.shift();
  emit({ type:"log", html });
}
function upsert(agent){
  const prev = chars.get(agent.id) || {};
  const next = Object.assign({}, prev, agent);
  delete next.spawn; delete next.force;
  chars.set(agent.id, next);
  emit({ type:"upsert", agent });
}
function removeChar(id){ chars.delete(id); emit({ type:"remove", id }); }
function say(id, text){ emit({ type:"say", id, text, ms:2600 }); }

const base = p => (p || "").split(/[\\/]/).filter(Boolean).pop() || p || "";
const short = (s, n = 34) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function ensureSession(sid, cwd){
  let s = sessions.get(sid);
  if (!s){
    const project = base(cwd) || "session";
    s = { charId:"s:" + sid, name:short(project.toUpperCase(), 14), project, lastSeen:Date.now(), subs:new Set(),
          color:COLORS[colorIdx++ % COLORS.length] };
    sessions.set(sid, s);
    upsert({ id:s.charId, name:s.name, role:"claude · " + sid.slice(0, 6), color:s.color, home:"DESK_B",
             spawn:"entrance", go:{ kind:"home" }, state:"idle", task:"just arrived" });
    log(`<b>${escapeHtml(s.name)}</b> started a session in <i>${escapeHtml(project)}</i>`);
  }
  s.lastSeen = Date.now();
  return s;
}

function ensureSub(s, agentId, agentType){
  const id = "a:" + agentId;
  if (!chars.has(id)){
    s.subs.add(id);
    const name = short((agentType || "subagent").toUpperCase(), 12);
    upsert({ id, name, role:"subagent of " + s.name, color:"#ff2ec4", home:"DESK_A",
             spawn:{ near:s.charId }, go:{ kind:"home" }, state:"working", task:"getting briefed" });
    log(`<b>${escapeHtml(s.name)}</b> spun up a <span class="alert">${escapeHtml(agentType || "subagent")}</span>`);
  }
  return id;
}

function activity(tool, input){
  const t = tool || "";
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t)) return { go:{ kind:"home" }, task:"editing " + base(input.file_path || input.notebook_path), bubble:"editing " + base(input.file_path || input.notebook_path) };
  if (t === "Read") return { go:{ kind:"home" }, task:"reading " + base(input.file_path), bubble:null };
  if (/^(Grep|Glob|LS)$/.test(t)) return { go:{ room:"DESK_C", tag:"screen" }, task:`searching ${short(input.pattern || input.path || "", 24)}`, bubble:"searching…" };
  if (/^(Bash|PowerShell)$/.test(t)) return { go:{ room:"DESK_B", tag:"rack" }, task:"running " + short(input.command, 30), bubble:"$ " + short(input.command, 26) };
  if (/^(WebSearch|WebFetch)$/.test(t)) return { go:{ room:"DESK_C", tag:"screen" }, task:"web: " + short(input.query || input.url, 30), bubble:"looking it up" };
  if (/^(Agent|Task)$/.test(t)) return { go:{ room:"MEETING", tag:"head" }, task:"briefing: " + short(input.description, 30), bubble:"briefing a subagent" };
  if (/^(TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode)$/.test(t)) return { go:{ room:"MEETING" }, task:"updating the plan", bubble:"planning" };
  if (t.startsWith("mcp__")){ const parts = t.split("__"); return { go:{ room:"RECEPTION", tag:"desk" }, task:`calling ${parts[1] || "connector"}`, bubble:"calling " + short(parts[2] || parts[1], 20) }; }
  if (t === "Skill") return { go:{ kind:"home" }, task:"using skill " + short(input.skill, 24), bubble:null };
  return { go:{ kind:"home" }, task:"using " + t, bubble:null };
}

function handle(input){
  if (!input || !input.session_id || !input.hook_event_name) return;
  eventCount++;
  const ev = input.hook_event_name;
  const s = ensureSession(input.session_id, input.cwd);
  const actor = input.agent_id ? ensureSub(s, input.agent_id, input.agent_type) : s.charId;
  const who = escapeHtml((chars.get(actor) || {}).name || s.name);
  const ti = input.tool_input || {};

  switch (ev){
    case "UserPromptSubmit":
      upsert({ id:actor, go:{ kind:"home" }, state:"thinking", task:"thinking about your prompt" });
      if (input.prompt) say(actor, "“" + short(input.prompt, 36) + "”");
      log(`<b>${who}</b> got a prompt: <i>${escapeHtml(short(input.prompt, 80))}</i>`);
      break;
    case "PreToolUse": {
      const a = activity(input.tool_name, ti);
      upsert({ id:actor, go:a.go, state:"working", task:a.task });
      if (a.bubble) say(actor, a.bubble);
      break;
    }
    case "PostToolUseFailure":
      say(actor, "✗ " + (input.tool_name || "tool") + " failed");
      log(`<b>${who}</b> <span class="err">${escapeHtml(input.tool_name || "tool")} failed</span>${input.error ? ": " + escapeHtml(short(input.error, 90)) : ""}`);
      break;
    case "PostToolUse":
      if (/^(Agent|Task)$/.test(input.tool_name || "")) upsert({ id:actor, go:{ kind:"home" }, state:"working", task:"reviewing subagent results" });
      break;
    case "SubagentStart":
      ensureSub(s, input.agent_id || ("x" + eventCount), input.agent_type);
      break;
    case "SubagentStop": {
      const id = input.agent_id ? "a:" + input.agent_id : null;
      if (id && chars.has(id)){
        say(id, "done ✓");
        log(`<b>${escapeHtml(chars.get(id).name)}</b> <span class="ok">finished</span> and left`);
        s.subs.delete(id);
        setTimeout(() => removeChar(id), 1200);
      }
      break;
    }
    case "Notification":
    case "PermissionRequest":
      upsert({ id:actor, state:"waiting", task:ev === "PermissionRequest" ? "asking permission: " + (input.tool_name || "") : "needs you: " + short(input.message, 30) });
      say(actor, "need you!");
      log(`<b>${who}</b> <span class="warn">is waiting for you</span>${input.message ? " - " + escapeHtml(short(input.message, 90)) : ""}`);
      break;
    case "PreCompact":
      upsert({ id:actor, go:{ room:"MEETING" }, state:"working", task:"compacting context" });
      say(actor, "tidying my notes…");
      break;
    case "Stop":
      upsert({ id:s.charId, go:{ room:"PANTRY", tag:"coffee" }, state:"idle", task:"done - grabbing coffee" });
      say(s.charId, "done! your turn");
      log(`<b>${escapeHtml(s.name)}</b> <span class="ok">finished its turn</span>`);
      break;
    case "StopFailure":
      upsert({ id:s.charId, state:"idle", task:"stopped with an error" });
      log(`<b>${escapeHtml(s.name)}</b> <span class="err">stopped with an error</span>`);
      break;
    case "SessionEnd":
      endSession(input.session_id, input.reason);
      break;
  }
  emit(stats());
}

function endSession(sid, reason){
  const s = sessions.get(sid);
  if (!s) return;
  s.subs.forEach(removeChar);
  removeChar(s.charId);
  sessions.delete(sid);
  log(`<b>${escapeHtml(s.name)}</b> ended the session${reason ? " (" + escapeHtml(reason) + ")" : ""}`);
  emit(stats());
}

setInterval(() => {
  const now = Date.now();
  sessions.forEach((s, sid) => { if (now - s.lastSeen > IDLE_REMOVE_MS) endSession(sid, "idle"); });
}, 60_000);

// ---------------- demo: a scripted fake session, so the page can be tried without hooks ----------------
let demoRunning = false;
function runDemo(){
  if (demoRunning) return;
  demoRunning = true;
  const sid = "demo-" + Math.random().toString(36).slice(2, 8);
  const sub = "demo-sub-" + Math.random().toString(36).slice(2, 6);
  const cwd = "C:/projects/demo-shop";
  const steps = [
    [0,    { hook_event_name:"SessionStart", source:"startup" }],
    [2500, { hook_event_name:"UserPromptSubmit", prompt:"Add a discount code field to checkout and cover it with tests" }],
    [5500, { hook_event_name:"PreToolUse", tool_name:"Grep", tool_input:{ pattern:"checkout" } }],
    [10000,{ hook_event_name:"PreToolUse", tool_name:"Read", tool_input:{ file_path:"src/checkout.ts" } }],
    [14000,{ hook_event_name:"PreToolUse", tool_name:"TodoWrite", tool_input:{} }],
    [19000,{ hook_event_name:"PreToolUse", tool_name:"Agent", tool_input:{ description:"write discount tests", subagent_type:"test-writer" } }],
    [22000,{ hook_event_name:"SubagentStart", agent_id:sub, agent_type:"test-writer" }],
    [25000,{ hook_event_name:"PreToolUse", agent_id:sub, agent_type:"test-writer", tool_name:"Write", tool_input:{ file_path:"tests/discount.test.ts" } }],
    [26000,{ hook_event_name:"PreToolUse", tool_name:"Edit", tool_input:{ file_path:"src/checkout.ts" } }],
    [32000,{ hook_event_name:"PreToolUse", agent_id:sub, agent_type:"test-writer", tool_name:"Bash", tool_input:{ command:"npm test -- discount" } }],
    [38000,{ hook_event_name:"SubagentStop", agent_id:sub, agent_type:"test-writer" }],
    [39000,{ hook_event_name:"PostToolUse", tool_name:"Agent" }],
    [43000,{ hook_event_name:"PreToolUse", tool_name:"Bash", tool_input:{ command:"npm run build" } }],
    [49000,{ hook_event_name:"PermissionRequest", tool_name:"Bash" }],
    [55000,{ hook_event_name:"PreToolUse", tool_name:"Bash", tool_input:{ command:"git commit -m 'discount codes'" } }],
    [60000,{ hook_event_name:"Stop" }],
    [80000,{ hook_event_name:"SessionEnd", reason:"demo over" }]
  ];
  steps.forEach(([ms, e]) => setTimeout(() => handle(Object.assign({ session_id:sid, cwd }, e)), ms));
  setTimeout(() => { demoRunning = false; }, 81000);
}
