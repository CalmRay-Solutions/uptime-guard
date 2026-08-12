/**
 * Custom script monitors.
 *
 * Workers forbid `eval` / `new Function`, so a "script" here is not JavaScript -
 * it is a small line-based format the Worker parses into steps and executes. One
 * step is one HTTP request plus its assertions; values captured from a response
 * can be interpolated into later steps as {{name}}, which is what makes a login
 * -> authenticated-call flow expressible.
 *
 * Grammar (one directive per line, blank lines and # comments ignored):
 *
 *   GET https://api.example.com/auth        <- starts a step
 *   header content-type: application/json
 *   body {"user":"probe"}                   <- repeat to add lines
 *   expect status 200                       <- or "200-299"
 *   expect time < 800ms
 *   expect body contains ok                 <- also "not contains", "matches <re>"
 *   expect json data.count > 0              <- = != > < >= <= contains exists
 *   capture token = json data.token         <- also header <name> / status / body
 *
 * A step with no `expect status` defaults to requiring 2xx. The first failing
 * assertion stops the run and becomes the monitor's error message.
 */

export const MAX_STEPS = 10;
export const MAX_SCRIPT_CHARS = 8000;
const MAX_BUDGET_MS = 60_000;
const MAX_ERROR_CHARS = 220;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export class ScriptError extends Error {}

type JsonOp = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "exists";

type Assert =
  | { kind: "status"; min: number; max: number }
  | { kind: "time"; op: "<" | "<="; ms: number }
  | { kind: "body"; want: boolean; text: string }
  | { kind: "match"; pattern: string }
  | { kind: "json"; path: string; op: JsonOp; value: string };

type Capture =
  | { name: string; from: "json"; path: string }
  | { name: string; from: "header"; header: string }
  | { name: string; from: "status" }
  | { name: string; from: "body" };

export interface ScriptStep {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  asserts: Assert[];
  captures: Capture[];
}

function at(lineNo: number, msg: string): ScriptError {
  return new ScriptError(`line ${lineNo}: ${msg}`);
}

/** Strip one layer of matching quotes so `= "ok"` and `= ok` behave the same. */
function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseExpect(step: ScriptStep, rest: string, lineNo: number): void {
  const head = /^(\w+)\s*(.*)$/.exec(rest);
  if (!head) throw at(lineNo, "expect what? (status | time | body | json)");
  const what = head[1].toLowerCase();
  const arg = head[2].trim();

  if (what === "status") {
    const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(arg);
    if (!m) throw at(lineNo, `bad status "${arg}" (use "200" or "200-299")`);
    step.asserts.push({ kind: "status", min: +m[1], max: m[2] ? +m[2] : +m[1] });
    return;
  }

  if (what === "time") {
    const m = /^(<=|<)\s*(\d+)\s*(ms|s)?$/i.exec(arg);
    if (!m) throw at(lineNo, `bad time "${arg}" (use "< 800ms")`);
    const ms = +m[2] * (m[3]?.toLowerCase() === "s" ? 1000 : 1);
    step.asserts.push({ kind: "time", op: m[1] as "<" | "<=", ms });
    return;
  }

  if (what === "body") {
    let m = /^not\s+contains\s+(.+)$/i.exec(arg);
    if (m) return void step.asserts.push({ kind: "body", want: false, text: unquote(m[1]) });
    m = /^contains\s+(.+)$/i.exec(arg);
    if (m) return void step.asserts.push({ kind: "body", want: true, text: unquote(m[1]) });
    m = /^matches\s+(.+)$/i.exec(arg);
    if (m) {
      const pattern = unquote(m[1]);
      try {
        new RegExp(pattern);
      } catch {
        throw at(lineNo, `invalid regex "${pattern}"`);
      }
      return void step.asserts.push({ kind: "match", pattern });
    }
    throw at(lineNo, `bad body check "${arg}" (use contains | not contains | matches)`);
  }

  if (what === "json") {
    const m = /^(\S+)\s*(>=|<=|!=|=|>|<|contains|exists)\s*(.*)$/i.exec(arg);
    if (!m) throw at(lineNo, `bad json check "${arg}" (use "json data.count > 0")`);
    const op = m[2].toLowerCase() as JsonOp;
    const value = unquote(m[3]);
    if (op !== "exists" && value === "") throw at(lineNo, `json ${op} needs a value`);
    step.asserts.push({ kind: "json", path: m[1], op, value });
    return;
  }

  throw at(lineNo, `unknown expect "${what}" (status | time | body | json)`);
}

function parseCapture(step: ScriptStep, rest: string, lineNo: number): void {
  const m = /^([A-Za-z_]\w*)\s*=\s*(json|header|status|body)\s*(.*)$/i.exec(rest);
  if (!m) throw at(lineNo, `bad capture "${rest}" (use "capture token = json data.token")`);
  const name = m[1];
  const from = m[2].toLowerCase();
  const arg = m[3].trim();
  if (from === "json") {
    if (!arg) throw at(lineNo, "capture from json needs a path");
    step.captures.push({ name, from: "json", path: arg });
  } else if (from === "header") {
    if (!arg) throw at(lineNo, "capture from header needs a header name");
    step.captures.push({ name, from: "header", header: arg });
  } else {
    step.captures.push({ name, from: from as "status" | "body" });
  }
}

/** Parse the script source into steps. Throws ScriptError with a line number on bad input. */
export function parseScript(src: string): ScriptStep[] {
  if (src.length > MAX_SCRIPT_CHARS) {
    throw new ScriptError(`script is too long (${src.length} chars, max ${MAX_SCRIPT_CHARS})`);
  }
  const steps: ScriptStep[] = [];
  const lines = src.split(/\r?\n/);
  let cur: ScriptStep | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const word = /^\S+/.exec(line)![0];
    const rest = line.slice(word.length).trim();

    if (METHODS.has(word.toUpperCase())) {
      if (!rest) throw at(lineNo, `${word.toUpperCase()} needs a URL`);
      if (steps.length >= MAX_STEPS) throw new ScriptError(`too many steps (max ${MAX_STEPS})`);
      cur = { method: word.toUpperCase(), url: rest, headers: [], body: null, asserts: [], captures: [] };
      steps.push(cur);
      continue;
    }

    if (!cur) throw at(lineNo, `"${word}" before any request line (start with GET/POST/... and a URL)`);

    switch (word.toLowerCase()) {
      case "header": {
        const m = /^([^:\s]+)\s*:\s*(.*)$/.exec(rest);
        if (!m) throw at(lineNo, `bad header "${rest}" (use "header name: value")`);
        cur.headers.push([m[1], m[2].trim()]);
        break;
      }
      case "body":
        if (!rest) throw at(lineNo, "body needs content");
        cur.body = cur.body == null ? rest : `${cur.body}\n${rest}`;
        break;
      case "expect":
        parseExpect(cur, rest, lineNo);
        break;
      case "capture":
        parseCapture(cur, rest, lineNo);
        break;
      default:
        throw at(lineNo, `unknown directive "${word}" (header | body | expect | capture)`);
    }
  }

  if (steps.length === 0) throw new ScriptError("script has no requests (start a line with GET/POST/... and a URL)");
  return steps;
}

/** Reads a dotted path out of a parsed JSON value. Supports [n] array indexes. */
function readPath(obj: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, key) => (acc != null && typeof acc === "object" ? (acc as any)[key] : undefined), obj);
}

/** Substitute {{name}} from captured variables. Throws if a name was never captured. */
function interpolate(text: string, vars: Map<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const v = vars.get(name);
    if (v === undefined) throw new ScriptError(`{{${name}}} was never captured`);
    return v;
  });
}

function describe(v: unknown): string {
  if (v === undefined) return "missing";
  if (v === null) return "null";
  return typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v);
}

/** Evaluate one assertion. Returns null when it passes, else the failure text. */
function checkAssert(a: Assert, res: { status: number; headers: Headers }, body: string, elapsed: number, json: () => unknown): string | null {
  switch (a.kind) {
    case "status":
      if (res.status < a.min || res.status > a.max) {
        const want = a.min === a.max ? String(a.min) : `${a.min}-${a.max}`;
        return `expected status ${want}, got ${res.status}`;
      }
      return null;
    case "time": {
      const ok = a.op === "<" ? elapsed < a.ms : elapsed <= a.ms;
      return ok ? null : `took ${elapsed}ms, expected ${a.op} ${a.ms}ms`;
    }
    case "body": {
      const present = body.includes(a.text);
      if (present === a.want) return null;
      return a.want ? `body is missing "${a.text}"` : `body contains "${a.text}"`;
    }
    case "match":
      return new RegExp(a.pattern).test(body) ? null : `body does not match /${a.pattern}/`;
    case "json": {
      let root: unknown;
      try {
        root = json();
      } catch {
        return "response is not valid JSON";
      }
      const value = readPath(root, a.path);
      if (a.op === "exists") return value === undefined ? `${a.path} is missing` : null;
      if (value === undefined) return `${a.path} is missing`;
      if (a.op === "contains") {
        const hay = Array.isArray(value) ? value.map(String) : [String(value)];
        return hay.some((h) => h.includes(a.value)) ? null : `${a.path} = ${describe(value)}, expected to contain "${a.value}"`;
      }
      if (a.op === "=" || a.op === "!=") {
        const equal = String(value) === a.value;
        if (equal === (a.op === "=")) return null;
        return `${a.path} = ${describe(value)}, expected ${a.op} ${a.value}`;
      }
      const left = Number(value);
      const right = Number(a.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return `${a.path} = ${describe(value)}, cannot compare ${a.op} ${a.value} numerically`;
      }
      const ok = a.op === ">" ? left > right : a.op === "<" ? left < right : a.op === ">=" ? left >= right : left <= right;
      return ok ? null : `${a.path} = ${describe(value)}, expected ${a.op} ${a.value}`;
    }
  }
}

export interface ScriptRun {
  ok: boolean;
  statusCode: number | null;
  responseTime: number;
  error: string | null;
}

/** Short "METHOD host/path" for error messages, so the failing step is identifiable. */
function stepLabel(index: number, method: string, url: string): string {
  let target = url;
  // Only shorten a real URL. An un-interpolated one still has {{name}} in it, which
  // URL would percent-encode into noise, so it is shown verbatim instead.
  if (!url.includes("{{")) {
    try {
      const u = new URL(url);
      target = u.host + (u.pathname === "/" ? "" : u.pathname);
    } catch {
      /* not a URL we can shorten - keep it as written */
    }
  }
  return `step ${index + 1} (${method} ${target})`;
}

/**
 * Run a parsed-on-the-fly script. `budgetMs` caps the whole run, not each step,
 * so a script can never outlive its monitor's timeout.
 */
export async function runScript(src: string, budgetMs: number): Promise<ScriptRun> {
  const startedAll = Date.now();
  let steps: ScriptStep[];
  try {
    steps = parseScript(src);
  } catch (e) {
    return { ok: false, statusCode: null, responseTime: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const budget = Math.min(Math.max(budgetMs, 1000), MAX_BUDGET_MS);
  const vars = new Map<string, string>();
  let lastStatus: number | null = null;

  const fail = (label: string, msg: string): ScriptRun => ({
    ok: false,
    statusCode: lastStatus,
    responseTime: Date.now() - startedAll,
    error: `${label}: ${msg}`.slice(0, MAX_ERROR_CHARS),
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let label = stepLabel(i, step.method, step.url);

    let url: string;
    let headers: Record<string, string>;
    let body: string | null;
    try {
      url = interpolate(step.url, vars);
      label = stepLabel(i, step.method, url);
      headers = { "User-Agent": "uptime-guard/1.0" };
      for (const [k, v] of step.headers) headers[k] = interpolate(v, vars);
      body = step.body == null ? null : interpolate(step.body, vars);
    } catch (e) {
      return fail(label, e instanceof Error ? e.message : String(e));
    }

    const remaining = budget - (Date.now() - startedAll);
    if (remaining <= 0) return fail(label, `script exceeded its ${budget}ms budget`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const startedStep = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: step.method,
        headers,
        body: step.method === "GET" || step.method === "HEAD" ? undefined : body ?? undefined,
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (e) {
      clearTimeout(timer);
      return fail(label, e instanceof Error ? e.message : String(e));
    }
    clearTimeout(timer);

    const elapsed = Date.now() - startedStep;
    lastStatus = res.status;

    const needsBody =
      step.asserts.some((a) => a.kind !== "status" && a.kind !== "time") ||
      step.captures.some((c) => c.from === "json" || c.from === "body");
    let text = "";
    if (needsBody) {
      try {
        text = await res.text();
      } catch (e) {
        return fail(label, `could not read response body: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Parsed lazily and only once, so several json assertions share the work.
    let parsed: unknown;
    let didParse = false;
    const json = () => {
      if (!didParse) {
        parsed = JSON.parse(text);
        didParse = true;
      }
      return parsed;
    };

    // A step that never mentions status still has to be a success by default.
    const asserts = step.asserts.some((a) => a.kind === "status")
      ? step.asserts
      : [{ kind: "status", min: 200, max: 299 } as Assert, ...step.asserts];

    for (const a of asserts) {
      const failure = checkAssert(a, res, text, elapsed, json);
      if (failure) return fail(label, failure);
    }

    for (const c of step.captures) {
      let value: string | undefined;
      if (c.from === "status") value = String(res.status);
      else if (c.from === "body") value = text.trim();
      else if (c.from === "header") value = res.headers.get(c.header) ?? undefined;
      else {
        try {
          const v = readPath(json(), c.path);
          value = v == null ? undefined : typeof v === "object" ? JSON.stringify(v) : String(v);
        } catch {
          return fail(label, `capture ${c.name}: response is not valid JSON`);
        }
      }
      if (value === undefined) return fail(label, `capture ${c.name}: nothing to capture`);
      vars.set(c.name, value);
    }
  }

  return { ok: true, statusCode: lastStatus, responseTime: Date.now() - startedAll, error: null };
}
