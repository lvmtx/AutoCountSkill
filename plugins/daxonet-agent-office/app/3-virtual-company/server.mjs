// App 3 - Virtual company: CEO -> CTO -> developer -> reviewer -> QA build a real project from your idea.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer, escapeHtml } from "../shared/server.mjs";
import { askJSON, runTools, usage, MODEL } from "../shared/claude.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Outside the app folder so plugin updates never wipe built projects.
const WORKSPACE_ROOT = process.env.COMPANY_WORKSPACE || path.join(os.homedir(), "daxonet-studio-projects");
const PORT = Number(process.env.COMPANY_PORT || 4803);
const PRICES = { "claude-opus-5":[5, 25], "claude-sonnet-5":[2, 10], "claude-haiku-4-5":[1, 5], "claude-opus-5-5":[4, 20] };
const MAX_FILES = 40, MAX_FILE_BYTES = 200_000;
const TEST_COMMANDS = {
  "python -m unittest discover -v": ["python", ["-m", "unittest", "discover", "-v"]],
  "node --test": ["node", ["--test"]]
};
const PHASES = ["Kickoff", "Design", "Build", "Review", "Test", "Wrap-up"];

const ROLES = {
  ceo:      { id:"ceo",      name:"SOL",   role:"CEO",       home:"DESK_C", color:"#ffb000" },
  cto:      { id:"cto",      name:"IRIS",  role:"CTO",       home:"DESK_C", color:"#ffd36b" },
  dev:      { id:"dev",      name:"BYTE",  role:"Developer", home:"DESK_B", color:"#ff2ec4" },
  reviewer: { id:"reviewer", name:"HEX",   role:"Reviewer",  home:"DESK_B", color:"#c38bff" },
  qa:       { id:"qa",       name:"PROBE", role:"QA",        home:"DESK_A", color:"#00fff2" }
};

const SYSTEM = `You are one role in a tiny virtual software company that builds small, self-contained projects end to end.
Projects must use only the language's standard library (no package installs, no network access at runtime) and stay small:
a handful of files that one developer can finish in under an hour. Be concrete and concise.`;

// ---------------- state ----------------
const charState = {};
const logs = [];
const phaseState = Object.fromEntries(PHASES.map(p => [p, "pending"]));
let running = false;
let workspace = null;
let files = [];

const app = startServer({
  port:PORT, appDir:HERE, name:"virtual-company",
  snapshot: () => [
    ...Object.values(ROLES).map(r => ({ type:"upsert", agent:charState[r.id] || base(r) })),
    ...logs.slice(-60).map(html => ({ type:"log", html })),
    phasesEvent(), filesEvent(), statusEvent()
  ],
  routes: {
    "POST /start": async ({ idea, allowRun }) => {
      idea = String(idea || "").trim().slice(0, 1200);
      if (!idea) return { ok:false, error:"Describe what to build first." };
      if (running) return { ok:false, error:"A project is already in progress." };
      runProject(idea, !!allowRun);
      return { ok:true };
    }
  }
});

function emit(e){ app.broadcast(e); }
function log(html){ logs.push(html); if (logs.length > 400) logs.shift(); emit({ type:"log", html }); }
function base(r){ return { id:r.id, name:r.name, role:r.role, color:r.color, home:r.home, go:{ kind:"home" }, state:"idle", task:"waiting for a project" }; }
function act(roleId, patch, bubble){
  const r = ROLES[roleId];
  charState[roleId] = Object.assign(charState[roleId] || base(r), patch);
  emit({ type:"upsert", agent:Object.assign({ id:roleId }, patch) });
  if (bubble) emit({ type:"say", id:roleId, text:bubble, ms:3200 });
}
function everyone(patch){ Object.keys(ROLES).forEach(id => act(id, patch)); }
function phasesEvent(){ return { type:"phases", phases:PHASES.map(p => ({ name:p, state:phaseState[p] })) }; }
function filesEvent(){ return { type:"files", dir:workspace, files }; }
function statusEvent(){
  const p = PRICES[MODEL];
  return { type:"status", running, model:MODEL, calls:usage.calls, input:usage.input, output:usage.output,
           cost:p ? (usage.input*p[0] + usage.output*p[1]) / 1e6 : null };
}
function setPhase(name, state){ phaseState[name] = state; emit(phasesEvent()); emit(statusEvent()); }
function name(id){ return `<b>${ROLES[id].name}</b> <span style="color:var(--text-dim)">(${ROLES[id].role})</span>`; }
const bullet = arr => (arr || []).map(x => "- " + x).join("\n");

// ---------------- sandboxed workspace ----------------
function resolveIn(rel){
  if (typeof rel !== "string" || !rel.trim()) throw new Error("path is required");
  if (path.isAbsolute(rel)) throw new Error("use a path relative to the project root");
  const full = path.resolve(workspace, rel);
  if (!full.startsWith(workspace + path.sep)) throw new Error("path escapes the project workspace");
  return full;
}
function listFiles(){
  const out = [];
  (function walk(dir){
    for (const e of fs.readdirSync(dir, { withFileTypes:true })){
      if (e.name === "node_modules" || e.name === "__pycache__" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full); else out.push(path.relative(workspace, full).replace(/\\/g, "/"));
    }
  })(workspace);
  return out.sort();
}
function refreshFiles(){ files = listFiles(); emit(filesEvent()); }

function fileTools(roleId, { canWrite }){
  const tools = [
    { name:"list_files", description:"List every file in the project workspace (relative paths).",
      input_schema:{ type:"object", properties:{}, additionalProperties:false } },
    { name:"read_file", description:"Read a UTF-8 text file from the project workspace.",
      input_schema:{ type:"object", properties:{ path:{ type:"string", description:"relative path, e.g. src/app.py" } }, required:["path"], additionalProperties:false } }
  ];
  const handlers = {
    list_files: () => { const f = listFiles(); return f.length ? f.join("\n") : "(workspace is empty)"; },
    read_file: ({ path:p }) => {
      act(roleId, { task:"reading " + p });
      return fs.readFileSync(resolveIn(p), "utf8");
    }
  };
  if (canWrite){
    tools.push({ name:"write_file", description:"Create or overwrite a UTF-8 text file in the project workspace. Always send the complete file content.",
      input_schema:{ type:"object", properties:{ path:{ type:"string" }, content:{ type:"string" } }, required:["path", "content"], additionalProperties:false } });
    handlers.write_file = ({ path:p, content }) => {
      const full = resolveIn(p);
      if (Buffer.byteLength(content || "", "utf8") > MAX_FILE_BYTES) throw new Error("file too large (max 200 KB)");
      if (!fs.existsSync(full) && listFiles().length >= MAX_FILES) throw new Error("project already has the maximum number of files");
      fs.mkdirSync(path.dirname(full), { recursive:true });
      fs.writeFileSync(full, content || "", "utf8");
      act(roleId, { task:"writing " + p }, "writing " + p);
      log(`${name(roleId)} wrote <i>${escapeHtml(p)}</i> <span style="color:var(--text-dim)">(${(content || "").split("\n").length} lines)</span>`);
      refreshFiles();
      return `wrote ${p}`;
    };
  }
  return { tools, handlers };
}

function runTestCommand(key){
  const cmd = TEST_COMMANDS[key];
  if (!cmd) return Promise.resolve("No runnable test command was chosen for this project.");
  return new Promise(resolve => {
    let out = "";
    const child = spawn(cmd[0], cmd[1], { cwd:workspace, shell:false, env:{ ...process.env, PYTHONDONTWRITEBYTECODE:"1" } });
    const timer = setTimeout(() => { child.kill(); out += "\n[timed out after 60s]"; }, 60_000);
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    child.on("error", e => { clearTimeout(timer); resolve(`Could not start "${key}": ${e.message}`); });
    child.on("close", code => { clearTimeout(timer); resolve(`exit code ${code}\n${out.slice(-6000)}`); });
  });
}

// ---------------- pipeline ----------------
async function runProject(idea, allowRun){
  running = true;
  PHASES.forEach(p => { phaseState[p] = "pending"; });
  workspace = null; files = [];
  emit(filesEvent());
  let current = "Kickoff";
  try {
    // 1. Kickoff
    setPhase(current, "active");
    everyone({ go:{ room:"MEETING" }, state:"idle", task:"kickoff meeting" });
    act("ceo", { go:{ room:"MEETING", tag:"head" }, state:"working", task:"writing the spec" }, "let's build this!");
    log(`<b>NEW PROJECT</b> <span class="alert">${escapeHtml(idea)}</span>`);
    const spec = await askJSON({
      system:SYSTEM, effort:"medium",
      prompt:`You are the CEO. Turn this customer idea into a crisp product spec for the team.\n\nIdea: ${idea}`,
      schema:{ type:"object", additionalProperties:false,
        required:["product_name", "one_liner", "requirements", "out_of_scope", "acceptance_criteria"],
        properties:{
          product_name:{ type:"string", description:"short product name" },
          one_liner:{ type:"string" },
          requirements:{ type:"array", items:{ type:"string" }, description:"3-7 concrete functional requirements" },
          out_of_scope:{ type:"array", items:{ type:"string" } },
          acceptance_criteria:{ type:"array", items:{ type:"string" }, description:"testable checks" } } }
    });
    const slug = (spec.product_name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    workspace = path.join(WORKSPACE_ROOT, `${slug}-${stamp}`);
    fs.mkdirSync(workspace, { recursive:true });
    const specMd = `# ${spec.product_name}\n\n${spec.one_liner}\n\n## Requirements\n${bullet(spec.requirements)}\n\n## Out of scope\n${bullet(spec.out_of_scope)}\n\n## Acceptance criteria\n${bullet(spec.acceptance_criteria)}\n`;
    fs.writeFileSync(path.join(workspace, "SPEC.md"), specMd);
    refreshFiles();
    act("ceo", { state:"idle", task:"spec done" }, spec.product_name + " is a go");
    log(`${name("ceo")} wrote the spec for <b>${escapeHtml(spec.product_name)}</b>: ${escapeHtml(spec.one_liner)}`);
    setPhase(current, "done");

    // 2. Design
    current = "Design";
    setPhase(current, "active");
    act("cto", { go:{ kind:"home" }, state:"working", task:"designing the architecture" }, "on the architecture");
    ["ceo", "dev", "reviewer", "qa"].forEach(id => act(id, { go:{ room:"PANTRY" }, state:"idle", task:"coffee while the CTO designs" }));
    const plan = await askJSON({
      system:SYSTEM, effort:"medium",
      prompt:`You are the CTO. Design the implementation for this spec. Choose Python or JavaScript (Node.js), standard library only.\nPick the test command that matches your language: "python -m unittest discover -v" (tests in files named test_*.py) or "node --test" (tests in files named *.test.js or in a test/ folder).\n\n${specMd}`,
      schema:{ type:"object", additionalProperties:false,
        required:["language", "architecture", "files", "test_command", "run_instructions"],
        properties:{
          language:{ type:"string", enum:["Python", "JavaScript"] },
          architecture:{ type:"string", description:"2-4 sentences" },
          files:{ type:"array", description:"at most 8 files", items:{ type:"object", additionalProperties:false,
            required:["path", "purpose"], properties:{ path:{ type:"string" }, purpose:{ type:"string" } } } },
          test_command:{ type:"string", enum:Object.keys(TEST_COMMANDS) },
          run_instructions:{ type:"string" } } }
    });
    const planMd = `# Technical plan\n\nLanguage: ${plan.language}\n\n${plan.architecture}\n\n## Files\n${(plan.files || []).map(f => `- \`${f.path}\` - ${f.purpose}`).join("\n")}\n\n## Tests\n\`${plan.test_command}\`\n\n## Running\n${plan.run_instructions}\n`;
    fs.writeFileSync(path.join(workspace, "PLAN.md"), planMd);
    refreshFiles();
    act("cto", { state:"idle", task:"plan handed over" }, "plan's ready");
    log(`${name("cto")} chose <b>${escapeHtml(plan.language)}</b> with ${(plan.files || []).length} files`);
    setPhase(current, "done");

    // 3. Build
    current = "Build";
    setPhase(current, "active");
    act("dev", { go:{ kind:"home" }, state:"working", task:"reading the plan" }, "coding time");
    ["ceo", "cto", "reviewer", "qa"].forEach(id => act(id, { go:{ kind:"home" }, state:"idle", task:"waiting on the build" }));
    const devTools = fileTools("dev", { canWrite:true });
    const build = await runTools({
      system:SYSTEM + "\nYou are the developer. Implement the plan by writing complete files with write_file. Do not write tests; QA owns them.",
      prompt:`Implement this project. SPEC.md and PLAN.md are already in the workspace.\n\n${specMd}\n${planMd}\nWhen every planned file is written and consistent, reply with a one-paragraph summary.`,
      tools:devTools.tools, handlers:devTools.handlers, effort:"high", maxTurns:30
    });
    act("dev", { state:"idle", task:"build done" }, "first cut done");
    log(`${name("dev")} finished the build${build.text ? ": " + escapeHtml(build.text.slice(0, 240)) : ""}`);
    setPhase(current, "done");

    // 4. Review (up to 2 rounds)
    current = "Review";
    setPhase(current, "active");
    for (let round = 1; round <= 2; round++){
      act("reviewer", { go:{ kind:"visit", agentId:"dev" }, state:"working", task:`reviewing (round ${round})` }, "let me take a look");
      const rt = fileTools("reviewer", { canWrite:false });
      rt.tools.push({ name:"submit_review", description:"Submit your review. Call this exactly once, at the end.",
        input_schema:{ type:"object", additionalProperties:false, required:["approved", "summary", "issues"],
          properties:{ approved:{ type:"boolean" }, summary:{ type:"string" },
            issues:{ type:"array", items:{ type:"object", additionalProperties:false, required:["file", "problem"],
              properties:{ file:{ type:"string" }, problem:{ type:"string" } } } } } } });
      rt.handlers.submit_review = input => ({ finish:input });
      const rev = await runTools({
        system:SYSTEM + "\nYou are the code reviewer. Only flag real bugs, spec gaps or crashes - not style.",
        prompt:`Review the implementation against the spec. Read the files you need, then call submit_review.\n\n${specMd}\n${planMd}`,
        tools:rt.tools, handlers:rt.handlers, effort:"medium", maxTurns:16
      });
      const verdict = rev.result || { approved:true, summary:"Review ran out of turns; approving as-is.", issues:[] };
      if (verdict.approved || !(verdict.issues || []).length){
        act("reviewer", { go:{ kind:"home" }, state:"idle", task:"approved the code" }, "LGTM ✓");
        log(`${name("reviewer")} <span class="ok">approved</span>: ${escapeHtml(verdict.summary)}`);
        break;
      }
      const issueList = verdict.issues.map(i => `- ${i.file}: ${i.problem}`).join("\n");
      act("reviewer", { state:"idle", task:`${verdict.issues.length} issues found` }, `${verdict.issues.length} things to fix`);
      log(`${name("reviewer")} <span class="warn">requested changes</span>: ${escapeHtml(verdict.summary)}<pre>${escapeHtml(issueList)}</pre>`);
      if (round === 2){ log(`${name("reviewer")} <span class="warn">moving on after two rounds</span>`); break; }
      act("dev", { state:"working", task:"fixing review comments" }, "on it");
      await runTools({
        system:SYSTEM + "\nYou are the developer. Fix the review issues with write_file (complete files).",
        prompt:`The reviewer asked for these fixes:\n${issueList}\n\nRead what you need, fix them, then reply with a short summary.`,
        tools:devTools.tools, handlers:devTools.handlers, effort:"high", maxTurns:20
      });
      act("dev", { state:"idle", task:"fixes pushed" }, "fixed");
    }
    act("reviewer", { go:{ kind:"home" }, state:"idle" });
    setPhase(current, "done");

    // 5. Test
    current = "Test";
    setPhase(current, "active");
    let report = await qaPass(specMd, planMd, plan.test_command, allowRun, "");
    if (!report.passed && allowRun){
      log(`${name("qa")} <span class="warn">found failures</span> - sending back to the developer`);
      act("dev", { state:"working", task:"fixing failing tests" }, "fixing the failures");
      await runTools({
        system:SYSTEM + "\nYou are the developer. Make the failing tests pass by fixing the implementation (fix tests only if they are clearly wrong).",
        prompt:`QA report:\n${report.summary}\n\nLatest test output:\n${report.lastRun || "(none)"}\n\nFix the problems, then reply with a short summary.`,
        tools:devTools.tools, handlers:devTools.handlers, effort:"high", maxTurns:20
      });
      act("dev", { state:"idle", task:"fixes pushed" });
      report = await qaPass(specMd, planMd, plan.test_command, allowRun, "This is a re-test after the developer fixed the failures.");
    }
    setPhase(current, report.passed ? "done" : "failed");

    // 6. Wrap-up
    current = "Wrap-up";
    setPhase(current, "active");
    everyone({ go:{ room:"MEETING" }, state:"idle", task:"wrap-up meeting" });
    act("ceo", { go:{ room:"MEETING", tag:"head" }, state:"working", task:"writing the release notes" });
    const wrap = await askJSON({
      system:SYSTEM, effort:"low",
      prompt:`You are the CEO. Write the README summary for what the team shipped.\n\n${specMd}\n${planMd}\nFiles: ${listFiles().join(", ")}\nQA: ${report.passed ? "passed" : "not fully passing"} - ${report.summary}`,
      schema:{ type:"object", additionalProperties:false, required:["summary", "how_to_run", "next_steps"],
        properties:{ summary:{ type:"string" }, how_to_run:{ type:"string" }, next_steps:{ type:"array", items:{ type:"string" } } } }
    });
    fs.writeFileSync(path.join(workspace, "README.md"),
      `# ${spec.product_name}\n\n${wrap.summary}\n\n## How to run\n${wrap.how_to_run}\n\n## Tests\n\`${plan.test_command}\` - ${report.passed ? "passing" : "see QA notes"}\n\n${report.summary}\n\n## Next steps\n${bullet(wrap.next_steps)}\n\n---\nBuilt by the DAXONET virtual company (${MODEL}).\n`);
    refreshFiles();
    act("ceo", { state:"idle", task:"shipped!" }, "shipped! 🎉");
    log(`${name("ceo")} <span class="ok">shipped ${escapeHtml(spec.product_name)}</span> &middot; <i>${escapeHtml(workspace)}</i>`);
    setPhase(current, "done");
    setTimeout(() => everyone({ go:{ room:"PANTRY" }, state:"idle", task:"celebrating" }), 6000);
  } catch (e){
    setPhase(current, "failed");
    log(`<b>SYSTEM</b> <span class="err">${escapeHtml(current)} failed: ${escapeHtml(e && e.message || e)}</span>`);
    everyone({ go:{ kind:"home" }, state:"idle", task:"project stalled" });
  } finally {
    running = false;
    emit(statusEvent());
  }
}

async function qaPass(specMd, planMd, testCommand, allowRun, note){
  act("qa", { go:{ kind:"home" }, state:"working", task:"writing tests" }, "time to break things");
  const qt = fileTools("qa", { canWrite:true });
  let lastRun = "";
  if (allowRun){
    qt.tools.push({ name:"run_tests", description:`Run the project's test command (${testCommand}) in the workspace and return its output.`,
      input_schema:{ type:"object", properties:{}, additionalProperties:false } });
    qt.handlers.run_tests = async () => {
      act("qa", { go:{ room:"DESK_B", tag:"rack" }, task:"running the test suite" }, "running tests…");
      lastRun = await runTestCommand(testCommand);
      const ok = /^exit code 0/.test(lastRun);
      log(`${name("qa")} ran <i>${escapeHtml(testCommand)}</i> &rarr; <span class="${ok ? "ok" : "err"}">${ok ? "passed" : "failed"}</span>`);
      act("qa", { go:{ kind:"home" }, task:ok ? "tests green" : "tests red" }, ok ? "green ✓" : "red ✗");
      return lastRun;
    };
  }
  qt.tools.push({ name:"submit_test_report", description:"Submit your QA verdict. Call this exactly once, at the end.",
    input_schema:{ type:"object", additionalProperties:false, required:["passed", "summary"],
      properties:{ passed:{ type:"boolean" }, summary:{ type:"string" } } } });
  qt.handlers.submit_test_report = input => ({ finish:input });
  const res = await runTools({
    system:SYSTEM + `\nYou are QA. Write focused tests for the acceptance criteria (only create or edit test files), ` +
      (allowRun ? "run them with run_tests, and report honestly." : "then report. Tests cannot be executed on this machine, so review them carefully by reading the code instead."),
    prompt:`${note}\nTest command: ${testCommand}\n\n${specMd}\n${planMd}\nWhen done, call submit_test_report.`,
    tools:qt.tools, handlers:qt.handlers, effort:"medium", maxTurns:20
  });
  const report = res.result || { passed:false, summary:"QA ran out of turns before reporting." };
  if (!allowRun) report.summary = "(tests written but not executed) " + report.summary;
  act("qa", { go:{ kind:"home" }, state:"idle", task:report.passed ? "signed off" : "flagged problems" }, report.passed ? "QA sign-off ✓" : "not ready yet");
  log(`${name("qa")} ${report.passed ? '<span class="ok">signed off</span>' : '<span class="warn">flagged problems</span>'}: ${escapeHtml(report.summary)}`);
  return Object.assign(report, { lastRun });
}

log(`<b>SYSTEM</b> DAXONET studio ready &middot; model <i>${escapeHtml(MODEL)}</i> &middot; describe a small project and press BUILD`);
