import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { appendAudit, appendUsageAudit } from "./audit.mjs";
import { routePrompt } from "./router.mjs";

export const TERSE_POLICY = [
  "Keep final answers concise and information-dense.",
  "Omit filler, repetition, and unnecessary restatement.",
  "Preserve technical precision, safety warnings, commands, paths, and exact error text.",
  "Use complete sentences whenever compression could create ambiguity.",
].join(" ");

function textInputs(params) {
  return (params.input ?? []).filter((item) => item?.type === "text" && typeof item.text === "string");
}

export async function transformClientMessage(raw, catalog, options = {}) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return { raw: text, decision: null };
  }

  if (message.method === "thread/start" && message.params) {
    message.params.config = {
      ...(message.params.config ?? {}),
      model_verbosity: options.verbosity ?? "low",
    };
    return { raw: JSON.stringify(message), decision: null };
  }

  if (message.method !== "turn/start" || !message.params) {
    return { raw: text, decision: null };
  }

  const inputs = textInputs(message.params);
  const prompt = inputs.map((item) => item.text).join("\n\n");
  const hasImages = (message.params.input ?? []).some((item) => item?.type === "image" || item?.type === "localImage");
  const decision = await routePrompt(prompt, catalog, {
    config: options.config,
    hasImages,
    context: options.context,
    history: options.history,
    classifier: options.classifier,
  });

  if (decision.prompt !== prompt && inputs.length > 0) {
    const removed = prompt.length - decision.prompt.length;
    inputs[0].text = inputs[0].text.slice(Math.min(removed, inputs[0].text.length));
  }

  if (decision.tier !== "off") {
    message.params.model = decision.model;
    message.params.effort = decision.effort;

    const modeSettings = message.params.collaborationMode?.settings;
    if (modeSettings) {
      modeSettings.model = decision.model;
      modeSettings.reasoning_effort = decision.effort;
    }
  }

  if (options.terse) {
    message.params.additionalContext = {
      ...(message.params.additionalContext ?? {}),
      "codex-smart-router.output-policy": {
        kind: "application",
        value: TERSE_POLICY,
      },
    };
  }

  return { raw: JSON.stringify(message), decision };
}

function splitLines(onLine) {
  let pending = "";
  return (chunk) => {
    pending += chunk.toString("utf8");
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line) onLine(line);
    }
  };
}

const EMPTY_USAGE = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

function subtractUsage(current = EMPTY_USAGE, previous = EMPTY_USAGE) {
  return Object.fromEntries(
    Object.keys(EMPTY_USAGE).map((field) => [field, Math.max(0, (current[field] ?? 0) - (previous[field] ?? 0))]),
  );
}

export async function startProxy({
  catalog,
  codexPath = "codex",
  classifier,
  config,
  verbosity = "low",
  terse = false,
  audit = true,
  auditPath,
} = {}) {
  const authToken = randomBytes(32).toString("base64url");
  const children = new Set();
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: ({ req }) => req.headers.authorization === `Bearer ${authToken}`,
  });

  await new Promise((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  wss.on("connection", (socket) => {
    const child = spawn(
      codexPath,
      ["app-server", "--stdio", "-c", `model_verbosity=\"${verbosity}\"`],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    children.add(child);

    const threadTotals = new Map();
    const activeRoutes = new Map();
    const threadContexts = new Map();
    const threadHistories = new Map();

    child.stdout.on("data", splitLines((line) => {
      try {
        const serverMessage = JSON.parse(line);
        if (serverMessage.method === "thread/tokenUsage/updated") {
          const { threadId, turnId, tokenUsage } = serverMessage.params;
          const active = activeRoutes.get(threadId);
          if (active) {
            active.turnId = turnId;
            active.usage = subtractUsage(tokenUsage.total, active.baseUsage);
          }
          threadTotals.set(threadId, tokenUsage.total);
        } else if (serverMessage.method === "turn/completed") {
          const { threadId, turn } = serverMessage.params;
          const active = activeRoutes.get(threadId);
          if (active) {
            const completedRoute = {
              ...active.decision,
              routeId: active.routeId,
              threadId,
              turnId: active.turnId ?? turn.id,
              status: turn.status,
              durationMs: turn.durationMs,
              usage: active.usage ?? EMPTY_USAGE,
            };
            threadContexts.set(threadId, {
              previousDecision: active.decision,
              previousUsage: completedRoute.usage,
              previousStatus: turn.status,
            });
            if (audit) appendUsageAudit(completedRoute, auditPath).catch(() => {});
            activeRoutes.delete(threadId);
          }
        }
      } catch {
        // Protocol messages are still forwarded unchanged if telemetry parsing fails.
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(line);
    }));

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });

    let clientQueue = Promise.resolve();
    const handleClientMessage = async (data) => {
      let request;
      try {
        request = JSON.parse(data.toString("utf8"));
      } catch {
        child.stdin.write(`${data.toString("utf8")}\n`);
        return;
      }

      let transformed;
      try {
        const threadId = request.params?.threadId;
        transformed = await transformClientMessage(data, catalog, {
          config,
          verbosity,
          terse,
          classifier,
          context: threadContexts.get(threadId),
          history: threadHistories.get(threadId) ?? [],
        });
      } catch (error) {
        const id = request.id ?? null;
        if (id !== null && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id, error: { code: -32602, message: error.message } }));
        }
        return;
      }

      if (transformed.decision) {
        const transformedRequest = JSON.parse(transformed.raw);
        const threadId = transformedRequest.params?.threadId;
        const routeId = randomUUID();
        if (audit) appendAudit({ ...transformed.decision, routeId, threadId }, auditPath).catch(() => {});
        if (threadId) {
          const history = threadHistories.get(threadId) ?? [];
          history.push(transformed.decision.prompt);
          threadHistories.set(threadId, history.slice(-6));
          activeRoutes.set(threadId, {
            routeId,
            decision: transformed.decision,
            baseUsage: threadTotals.get(threadId) ?? EMPTY_USAGE,
            usage: null,
            turnId: null,
          });
        }
      }
      child.stdin.write(`${transformed.raw}\n`);
    };

    socket.on("message", (data) => {
      clientQueue = clientQueue
        .then(() => handleClientMessage(data))
        .catch((error) => {
          if (socket.readyState === WebSocket.OPEN) socket.close(1011, error.message.slice(0, 120));
        });
    });

    socket.on("close", () => {
      child.stdin.end();
      if (!child.killed) child.kill("SIGTERM");
    });

    child.on("error", (error) => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, error.message.slice(0, 120));
    });

    child.on("exit", (code) => {
      children.delete(child);
      if (socket.readyState === WebSocket.OPEN) {
        const reason = code === 0 ? "Codex App Server exited" : (stderr.trim() || `Codex App Server exited with ${code}`);
        socket.close(code === 0 ? 1000 : 1011, reason.slice(0, 120));
      }
    });
  });

  const address = wss.address();
  const url = `ws://127.0.0.1:${address.port}`;
  return {
    url,
    authToken,
    async close() {
      for (const child of children) {
        if (!child.killed) child.kill("SIGTERM");
      }
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
