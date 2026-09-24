// Thin wrapper around the Anthropic SDK used by the AI Town and Virtual Company apps.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
// Server-side refusal fallbacks are only offered on these models.
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

let client = null;
function getClient(){
  if (!client) client = new Anthropic();
  return client;
}

export const usage = { calls:0, input:0, output:0, errors:0 };

function baseParams({ system, messages, maxTokens, effort, tools, schema }){
  const p = { model:MODEL, max_tokens:maxTokens, system, messages };
  const output_config = {};
  if (effort) output_config.effort = effort;
  if (schema) output_config.format = { type:"json_schema", schema };
  if (Object.keys(output_config).length) p.output_config = output_config;
  if (tools) p.tools = tools;
  if (FALLBACK_MODELS.has(MODEL)){
    p.betas = ["server-side-fallback-2026-07-01"];
    p.fallbacks = "default";
  }
  return p;
}

async function create(params){
  usage.calls++;
  try {
    const res = await getClient().beta.messages.create(params);
    usage.input += res.usage?.input_tokens || 0;
    usage.output += res.usage?.output_tokens || 0;
    return res;
  } catch (e){
    usage.errors++;
    throw describeError(e);
  }
}

export function describeError(e){
  if (e instanceof Anthropic.AuthenticationError) return new Error("Claude API authentication failed - set ANTHROPIC_API_KEY before starting the server.");
  if (e instanceof Anthropic.RateLimitError) return Object.assign(new Error("Claude API rate limit hit - backing off."), { rateLimited:true });
  if (e instanceof Anthropic.BadRequestError) return new Error("Claude API rejected the request: " + e.message);
  if (e instanceof Anthropic.APIError) return new Error(`Claude API error ${e.status}: ${e.message}`);
  if (e && /apiKey|authToken|credentials/i.test(e.message || "")) return new Error("No Claude credentials found - set ANTHROPIC_API_KEY before starting the server.");
  return e;
}

function textOf(res){
  return res.content.filter(b => b.type === "text").map(b => b.text).join("");
}

/** One call that must return JSON matching `schema`. */
export async function askJSON({ system, prompt, messages, schema, effort = "low", maxTokens = 8000 }){
  const res = await create(baseParams({ system, messages: messages || [{ role:"user", content:prompt }], maxTokens, effort, schema }));
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Response hit max_tokens before finishing.");
  return JSON.parse(textOf(res));
}

/**
 * Manual tool loop. `tools` are Anthropic tool definitions; `handlers[name](input)` returns a string
 * (or throws). Returns { text, stoppedBy } where stoppedBy is "end_turn", "finish_tool", or "max_turns".
 * If a handler returns { finish: value }, the loop ends immediately and that value is returned as `result`.
 */
export async function runTools({ system, prompt, tools, handlers, effort = "medium", maxTurns = 20, maxTokens = 16000, onToolCall }){
  const messages = [{ role:"user", content:prompt }];
  for (let turn = 0; turn < maxTurns; turn++){
    const res = await create(baseParams({ system, messages, maxTokens, effort, tools }));
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
    messages.push({ role:"assistant", content:res.content });
    if (res.stop_reason === "pause_turn") continue;
    const calls = res.content.filter(b => b.type === "tool_use");
    if (!calls.length) return { text:textOf(res), stoppedBy:"end_turn" };

    const results = [];
    let finish;
    for (const call of calls){
      let content, is_error = false;
      try {
        if (onToolCall) onToolCall(call.name, call.input);
        const handler = handlers[call.name];
        if (!handler) throw new Error("unknown tool " + call.name);
        const out = await handler(call.input || {});
        if (out && typeof out === "object" && "finish" in out){ finish = out.finish; content = "Recorded."; }
        else content = String(out);
      } catch (e){
        content = "Error: " + (e && e.message || e);
        is_error = true;
      }
      results.push({ type:"tool_result", tool_use_id:call.id, content, is_error });
    }
    messages.push({ role:"user", content:results });
    if (finish !== undefined) return { result:finish, stoppedBy:"finish_tool" };
    if (res.stop_reason === "max_tokens") throw new Error("Response hit max_tokens mid tool call.");
  }
  return { text:"", stoppedBy:"max_turns" };
}
