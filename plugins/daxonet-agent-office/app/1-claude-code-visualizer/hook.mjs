// Claude Code hook: forwards a trimmed copy of the hook payload to the visualizer.
// Always exits 0 with no output, so it can never block or alter Claude Code.
import http from "node:http";

const PORT = Number(process.env.AGENT_OFFICE_PORT || 4801);
const KEEP_INPUT = ["file_path", "notebook_path", "path", "pattern", "command", "query", "url",
                    "description", "subagent_type", "skill", "prompt"];

setTimeout(() => process.exit(0), 1500);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", c => { raw += c; });
process.stdin.on("end", () => {
  let j;
  try { j = JSON.parse(raw); } catch { process.exit(0); }
  const cut = (s, n) => typeof s === "string" ? s.slice(0, n) : undefined;
  const input = {};
  if (j.tool_input && typeof j.tool_input === "object"){
    for (const k of KEEP_INPUT) if (typeof j.tool_input[k] === "string") input[k] = cut(j.tool_input[k], 200);
  }
  const body = JSON.stringify({
    session_id: j.session_id, hook_event_name: j.hook_event_name, cwd: j.cwd,
    agent_id: j.agent_id, agent_type: j.agent_type,
    tool_name: j.tool_name, tool_use_id: j.tool_use_id, tool_input: input,
    prompt: cut(j.prompt, 200), message: cut(j.message, 200), notification_type: j.notification_type,
    source: j.source, reason: j.reason, error: cut(typeof j.error === "string" ? j.error : "", 200)
  });
  const req = http.request({ host:"127.0.0.1", port:PORT, path:"/hook", method:"POST", timeout:800,
    headers:{ "Content-Type":"application/json", "Content-Length":Buffer.byteLength(body) } },
    res => { res.resume(); res.on("end", () => process.exit(0)); });
  req.on("error", () => process.exit(0));
  req.on("timeout", () => { req.destroy(); process.exit(0); });
  req.end(body);
});
