// App 2 - AI Town: every character has a Claude "brain" (memory -> plan -> act -> talk -> reflect).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, escapeHtml } from "../shared/server.mjs";
import { askJSON, usage, MODEL } from "../shared/claude.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TOWN_PORT || 4802);
const SIM_RATE = Number(process.env.TOWN_SIM_RATE || 2);          // sim minutes per real second
const CALLS_PER_MIN = Number(process.env.TOWN_CALLS_PER_MIN || 6);  // hard budget on Claude calls
const MAX_INFLIGHT = 2;
const PRICES = { "claude-opus-5":[5, 25], "claude-sonnet-5":[2, 10], "claude-haiku-4-5":[1, 5], "claude-opus-5-5":[4, 20] };

const ROOMS = {
  DESK_A:    { label:"Support Desk",    about:"the support team's desks and ticket board" },
  DESK_B:    { label:"Engineering Bay", about:"engineers' desks, whiteboard and server racks" },
  DESK_C:    { label:"Analytics Hub",   about:"analysts' desks and the live KPI screen" },
  MEETING:   { label:"Meeting Room",    about:"glass-walled room with a big table and a wall TV" },
  PANTRY:    { label:"Pantry",          about:"coffee machine, fridge, vending machine, small tables" },
  RECEPTION: { label:"Reception",       about:"front desk, sofa and the main entrance" }
};
const LABEL_TO_ID = Object.fromEntries(Object.entries(ROOMS).map(([id, r]) => [r.label.toLowerCase(), id]));

const PERSONAS = [
  { id:"kai",   name:"KAI",   team:"Support",     home:"DESK_A", color:"#00fff2", role:"senior support lead",
    traits:"patient, remembers every customer by name, fiercely protective of the team's SLA", goal:"keep the ticket queue under control today" },
  { id:"zara",  name:"ZARA",  team:"Support",     home:"DESK_A", color:"#5ffff5", role:"new support hire",
    traits:"eager, a little anxious about escalations, asks lots of questions", goal:"close her first difficult ticket without help" },
  { id:"milo",  name:"MILO",  team:"Support",     home:"DESK_A", color:"#9ffffa", role:"night-shift support veteran",
    traits:"dry humour, hates meetings, secretly the best troubleshooter", goal:"get through the day with as few meetings as possible" },
  { id:"ren",   name:"REN",   team:"Engineering", home:"DESK_B", color:"#ff2ec4", role:"principal engineer",
    traits:"perfectionist, wants to refactor everything, mentors juniors", goal:"land the auth-service refactor this week" },
  { id:"nova",  name:"NOVA",  team:"Engineering", home:"DESK_B", color:"#ff6fd8", role:"full-stack developer",
    traits:"ships fast, loves demos, a bit careless with edge cases", goal:"demo the new checkout flow before Friday" },
  { id:"vex",   name:"VEX",   team:"Engineering", home:"DESK_B", color:"#ff9fe6", role:"security-minded backend developer",
    traits:"suspicious of shortcuts, blunt, cares deeply about audits", goal:"stop anyone shipping without a security review" },
  { id:"luna",  name:"LUNA",  team:"Business Analysis", home:"DESK_C", color:"#ffb000", role:"business analyst",
    traits:"turns chaos into requirement docs, diplomatic, loves sticky notes", goal:"get sign-off on the Q4 requirements" },
  { id:"orion", name:"ORION", team:"Business Analysis", home:"DESK_C", color:"#ffc94d", role:"data analyst",
    traits:"obsessed with dashboards, quiet, quietly competitive", goal:"prove the new dashboard saves the support team time" },
  { id:"echo",  name:"ECHO",  team:"Business Analysis", home:"DESK_C", color:"#ffdd8a", role:"product owner",
    traits:"juggles stakeholders, calls a lot of meetings, optimistic", goal:"align engineering and support on next sprint's priorities" }
];

const SYSTEM = `You are the mind of one character at DAXONET, a small cyberpunk-styled office simulation.
Characters work, take breaks, meet and chat like real colleagues. Stay in character, keep every text field short,
concrete and office-realistic (no magic, no violence). Rooms available: ${Object.values(ROOMS).map(r => `${r.label} (${r.about})`).join("; ")}.
Answer only with JSON that matches the provided schema.`;

// ---------------- world state ----------------
let simMinutes = 8*60;
let paused = true;
let authProblem = null;
let backoffUntil = 0;
const callTimes = [];
let inflight = 0;
const logs = [];

const agents = PERSONAS.map((p, i) => ({
  ...p, room:p.home, activity:"settling in at the desk", thought:"", busyUntil:simMinutes + i*4,
  busy:false, memories:[], reflections:[], sinceReflect:0, lastChatMin:-999, pending:null, state:"idle"
}));
const byId = Object.fromEntries(agents.map(a => [a.id, a]));

const app = startServer({
  port:PORT, appDir:HERE, name:"ai-town",
  snapshot: () => [
    ...agents.map(a => ({ type:"upsert", agent:agentView(a) })),
    ...agents.map(mindEvent),
    ...logs.slice(-50).map(html => ({ type:"log", html })),
    { type:"hour", hour:simMinutes/60 },
    statusEvent()
  ],
  routes: {
    "POST /control": async ({ paused:p }) => {
      paused = !!p;
      if (!paused){ authProblem = null; backoffUntil = 0; }
      log(`<b>SYSTEM</b> <span class="warn">simulation ${paused ? "paused" : "running"}</span>`);
      emit(statusEvent());
      return { paused };
    },
    "POST /command": async ({ id, text }) => {
      const a = byId[id];
      text = String(text || "").trim().slice(0, 160);
      if (!a || !text) return { ok:false };
      a.pending = text;
      remember(a, `My manager told me: "${text}"`);
      a.busyUntil = 0;
      log(`<b>OPERATOR</b> &rarr; <b>${a.name}</b>: <span class="alert">"${escapeHtml(text)}"</span>${paused ? " (resume the sim to let them act)" : ""}`);
      emit(mindEvent(a));
      return { ok:true };
    }
  }
});

// ---------------- helpers ----------------
function emit(e){ app.broadcast(e); }
function log(html){ logs.push(html); if (logs.length > 300) logs.shift(); emit({ type:"log", html }); }
function clock(m = simMinutes){ const h = Math.floor(m/60) % 24, mm = Math.floor(m % 60); return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`; }
function hourNow(){ return (simMinutes/60) % 24; }
function phase(){ const h = hourNow(); return h < 5 ? "night" : h < 8 ? "dawn" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night"; }
function remember(a, text){
  a.memories.push(`${clock()} ${text}`);
  if (a.memories.length > 40) a.memories.shift();
  a.sinceReflect++;
}
function agentView(a){
  return { id:a.id, name:a.name, role:a.team, color:a.color, home:a.home, state:a.state, task:a.activity,
           go: a.room === a.home ? { kind:"home" } : { room:a.room } };
}
function mindEvent(a){ return { type:"mind", id:a.id, thought:a.thought, memories:a.memories.slice(-6), reflections:a.reflections.slice(-3), pending:a.pending }; }
function statusEvent(){
  const p = PRICES[MODEL];
  const cost = p ? (usage.input*p[0] + usage.output*p[1]) / 1e6 : null;
  return { type:"status", paused, model:MODEL, clock:clock(), phase:phase(), calls:usage.calls, errors:usage.errors,
           input:usage.input, output:usage.output, cost, budget:CALLS_PER_MIN, authProblem };
}
function sync(a){ emit({ type:"upsert", agent:agentView(a) }); emit(mindEvent(a)); }
function occupancy(except){
  return Object.entries(ROOMS).map(([id, r]) => {
    const here = agents.filter(o => o !== except && o.room === id).map(o => `${o.name} (${o.activity})`);
    return `- ${r.label}: ${here.length ? here.join(", ") : "empty"}`;
  }).join("\n");
}
function canCall(){
  const now = Date.now();
  while (callTimes.length && now - callTimes[0] > 60_000) callTimes.shift();
  return !paused && !authProblem && now >= backoffUntil && inflight < MAX_INFLIGHT && callTimes.length < CALLS_PER_MIN;
}
async function call(fn){
  callTimes.push(Date.now());
  inflight++;
  try { return await fn(); }
  catch (e){
    const msg = String(e && e.message || e);
    if (/authentication|credentials|API_KEY/i.test(msg)){ authProblem = msg; paused = true; }
    else if (e && e.rateLimited) backoffUntil = Date.now() + 30_000;
    log(`<b>SYSTEM</b> <span class="err">${escapeHtml(msg)}</span>`);
    emit(statusEvent());
    return null;
  } finally { inflight--; }
}
function roomIdFrom(label, fallback){ return LABEL_TO_ID[String(label || "").toLowerCase()] || fallback; }
function stateFor(roomId, activity){
  if (/sleep|nap|doz/i.test(activity)) return "sleeping";
  if (roomId === "PANTRY" || roomId === "RECEPTION") return "idle";
  return "working";
}

// ---------------- brain: plan ----------------
const PLAN_SCHEMA = {
  type:"object",
  properties:{
    room:{ type:"string", enum:Object.values(ROOMS).map(r => r.label) },
    activity:{ type:"string", description:"what you will be doing there, under 8 words" },
    say:{ type:"string", description:"something you say out loud as you go, under 10 words, or empty" },
    thought:{ type:"string", description:"your private reasoning, one short sentence" },
    minutes:{ type:"integer", description:"how many minutes this will take, 15 to 120" }
  },
  required:["room", "activity", "say", "thought", "minutes"],
  additionalProperties:false
};

async function plan(a){
  a.busy = true;
  a.state = "thinking";
  sync(a);
  const instruction = a.pending;
  const prompt =
`You are ${a.name}, ${a.role} on the ${a.team} team. Personality: ${a.traits}. Your goal: ${a.goal}.
Time: ${clock()} (${phase()}). You are in the ${ROOMS[a.room].label}; last activity: ${a.activity}.
Your own desk is in the ${ROOMS[a.home].label}. Late at night most people go home, nap, or work quietly.

Who is where right now:
${occupancy(a)}

Your recent memories (oldest first):
${a.memories.slice(-12).join("\n") || "(none yet - the day is just starting)"}

Your reflections so far:
${a.reflections.slice(-3).join("\n") || "(none)"}
${instruction ? `\nYour manager just told you: "${instruction}". Act on it now.` : ""}

Decide what you do next.`;
  const out = await call(() => askJSON({ system:SYSTEM, prompt, schema:PLAN_SCHEMA, effort:"low", maxTokens:4000 }));
  a.busy = false;
  if (!out){ a.state = stateFor(a.room, a.activity); a.busyUntil = simMinutes + 20; sync(a); return; }
  if (instruction && a.pending === instruction) a.pending = null;

  const target = roomIdFrom(out.room, a.room);
  const moved = target !== a.room;
  a.room = target;
  a.activity = String(out.activity || "working").slice(0, 60);
  a.thought = String(out.thought || "").slice(0, 160);
  a.state = stateFor(target, a.activity);
  a.busyUntil = simMinutes + Math.max(15, Math.min(120, Number(out.minutes) || 30));
  remember(a, `I ${moved ? "went to the " + ROOMS[target].label + " to" : "decided to"} ${a.activity}. (${a.thought})`);
  sync(a);
  if (out.say){
    emit({ type:"say", id:a.id, text:out.say, ms:3500 });
    log(`<b>${a.name}</b>: ${escapeHtml(out.say)}`);
  }
  log(`<span class="ok">${a.name}</span> &rarr; ${escapeHtml(ROOMS[target].label)} &middot; ${escapeHtml(a.activity)}`);
  setTimeout(() => maybeChat(a), 7000);
}

// ---------------- brain: conversation ----------------
async function maybeChat(a){
  if (a.busy || paused) return;
  const others = agents.filter(o => o !== a && o.room === a.room && !o.busy && simMinutes - o.lastChatMin > 90);
  if (!others.length || simMinutes - a.lastChatMin < 90) return;
  const chance = (a.room === "PANTRY" || a.room === "MEETING") ? 0.8 : 0.45;
  if (Math.random() > chance || !canCall()) return;
  const b = others[Math.floor(Math.random()*others.length)];
  a.busy = b.busy = true;
  const schema = {
    type:"object",
    properties:{
      lines:{ type:"array", items:{ type:"object",
        properties:{ speaker:{ type:"string", enum:[a.name, b.name] }, text:{ type:"string" } },
        required:["speaker", "text"], additionalProperties:false } },
      takeaway_a:{ type:"string", description:`what ${a.name} remembers from this chat, one sentence` },
      takeaway_b:{ type:"string", description:`what ${b.name} remembers from this chat, one sentence` }
    },
    required:["lines", "takeaway_a", "takeaway_b"], additionalProperties:false
  };
  const prompt =
`Write a short, natural conversation (2 to 4 lines, each under 12 words) between two colleagues who just ran into each other in the ${ROOMS[a.room].label} at ${clock()}.

${a.name}: ${a.role} (${a.team}). Personality: ${a.traits}. Goal: ${a.goal}. Currently: ${a.activity}.
Recent memories: ${a.memories.slice(-6).join(" | ") || "none"}

${b.name}: ${b.role} (${b.team}). Personality: ${b.traits}. Goal: ${b.goal}. Currently: ${b.activity}.
Recent memories: ${b.memories.slice(-6).join(" | ") || "none"}

Let their goals, moods and recent events shape what they talk about.`;
  const out = await call(() => askJSON({ system:SYSTEM, prompt, schema, effort:"low", maxTokens:4000 }));
  if (!out){ a.busy = b.busy = false; return; }
  a.lastChatMin = b.lastChatMin = simMinutes;
  const lines = (out.lines || []).slice(0, 4);
  lines.forEach((ln, i) => setTimeout(() => {
    const who = ln.speaker === b.name ? b : a;
    emit({ type:"say", id:who.id, text:ln.text, ms:2700 });
    log(`<b>${who.name}</b> <span style="color:var(--text-dim)">to ${who === a ? b.name : a.name}:</span> ${escapeHtml(ln.text)}`);
  }, i*2800));
  setTimeout(() => {
    remember(a, `Talked with ${b.name}: ${out.takeaway_a}`);
    remember(b, `Talked with ${a.name}: ${out.takeaway_b}`);
    a.busy = b.busy = false;
    emit(mindEvent(a)); emit(mindEvent(b));
  }, lines.length*2800);
}

// ---------------- brain: reflection ----------------
const REFLECT_SCHEMA = {
  type:"object",
  properties:{ insights:{ type:"array", items:{ type:"string" }, description:"1 or 2 short higher-level insights" } },
  required:["insights"], additionalProperties:false
};
async function reflect(a){
  a.busy = true;
  const prompt =
`You are ${a.name}, ${a.role}. Personality: ${a.traits}. Goal: ${a.goal}.
Here is what happened to you recently:
${a.memories.slice(-12).join("\n")}

What 1-2 higher-level insights do you draw about your colleagues, your work or your goal? Each under 20 words.`;
  const out = await call(() => askJSON({ system:SYSTEM, prompt, schema:REFLECT_SCHEMA, effort:"low", maxTokens:3000 }));
  a.busy = false;
  a.sinceReflect = 0;
  if (!out) return;
  (out.insights || []).slice(0, 2).forEach(s => {
    a.reflections.push(`${clock()} ${s}`);
    log(`<span style="color:var(--text-dim)">${a.name} reflects: <i>${escapeHtml(s)}</i></span>`);
  });
  if (a.reflections.length > 8) a.reflections.splice(0, a.reflections.length - 8);
  emit(mindEvent(a));
}

// ---------------- scheduler ----------------
setInterval(() => {
  if (!paused) simMinutes += SIM_RATE;
}, 1000);
setInterval(() => { emit({ type:"hour", hour:simMinutes/60 }); emit(statusEvent()); }, 3000);

setInterval(() => {
  if (!canCall()) return;
  const idle = agents.filter(a => !a.busy);
  const next = idle.find(a => a.pending)
    || idle.filter(a => a.busyUntil <= simMinutes).sort((x, y) => x.busyUntil - y.busyUntil)[0];
  if (next){ plan(next); return; }
  const thinker = idle.find(a => a.sinceReflect >= 8);
  if (thinker) reflect(thinker);
}, 1500);

log(`<b>SYSTEM</b> DAXONET town ready &middot; ${agents.length} characters &middot; model <i>${escapeHtml(MODEL)}</i> &middot; <span class="warn">press START to begin (uses Claude API credits)</span>`);
