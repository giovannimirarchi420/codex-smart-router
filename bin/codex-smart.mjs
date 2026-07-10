#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { readAuditStats } from "../src/audit.mjs";
import { startDashboardServer } from "../src/dashboard-server.mjs";
import { loadCodexCatalog, summarizeCatalog } from "../src/catalog.mjs";
import { createClassifier } from "../src/classifier.mjs";
import { startProxy } from "../src/proxy.mjs";
import { mergeConfig, routePrompt } from "../src/router.mjs";

const HELP = `codex-smart - per-turn model and reasoning router for Codex CLI

Usage:
  codex-smart [smart options] [--] [codex arguments]
  codex-smart route [--json] <prompt>
  codex-smart models
  codex-smart stats
  codex-smart dashboard [--port <port>] [--no-open]

Smart options:
  --config <file>       JSON routing configuration
  --codex <path>        Codex executable (default: codex)
  --classifier <mode>   auto, openai, or codex (default: auto)
  --classifier-model    Override classifier model
  --classifier-timeout  Classifier timeout in milliseconds
  --verbosity <level>   low, medium, or high (default: low)
  --terse               Add a precision-preserving concise response policy
  --no-audit            Disable privacy-safe routing metadata logs
  -h, --help            Show this help

Per-prompt overrides (first line, removed before inference):
  ::route economy|balanced|complex|frontier|max|auto|off
  ::route model=<slug> effort=<level>
`;

function parseArgs(argv) {
  const result = {
    command: "launch",
    codexPath: process.env.CODEX_SMART_CODEX || "codex",
    configPath: process.env.CODEX_SMART_CONFIG,
    classifierMode: process.env.CODEX_SMART_CLASSIFIER || "auto",
    classifierModel: process.env.CODEX_SMART_CLASSIFIER_MODEL,
    classifierTimeoutMs: process.env.CODEX_SMART_CLASSIFIER_TIMEOUT
      ? Number(process.env.CODEX_SMART_CLASSIFIER_TIMEOUT)
      : undefined,
    verbosity: "low",
    terse: false,
    audit: true,
    json: false,
    dashboardPort: undefined,
    openDashboard: true,
    rest: [],
  };

  let index = 0;
  if (["route", "models", "stats", "dashboard", "help"].includes(argv[0])) {
    result.command = argv[0];
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      result.rest.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--config") result.configPath = argv[++index];
    else if (arg === "--codex") result.codexPath = argv[++index];
    else if (arg === "--classifier") result.classifierMode = argv[++index];
    else if (arg === "--classifier-model") result.classifierModel = argv[++index];
    else if (arg === "--classifier-timeout") result.classifierTimeoutMs = Number(argv[++index]);
    else if (arg === "--verbosity") result.verbosity = argv[++index];
    else if (arg === "--terse") result.terse = true;
    else if (arg === "--no-audit") result.audit = false;
    else if (arg === "--json") result.json = true;
    else if (arg === "--port") result.dashboardPort = Number(argv[++index]);
    else if (arg === "--no-open") result.openDashboard = false;
    else if (arg === "-h" || arg === "--help") result.command = "help";
    else result.rest.push(arg);
  }

  if (!["low", "medium", "high"].includes(result.verbosity)) {
    throw new Error(`Invalid verbosity: ${result.verbosity}`);
  }
  if (!["auto", "openai", "codex"].includes(result.classifierMode)) {
    throw new Error(`Invalid classifier mode: ${result.classifierMode}`);
  }
  if (result.classifierTimeoutMs !== undefined && (!Number.isFinite(result.classifierTimeoutMs) || result.classifierTimeoutMs <= 0)) {
    throw new Error(`Invalid classifier timeout: ${result.classifierTimeoutMs}`);
  }
  if (result.dashboardPort !== undefined && (!Number.isInteger(result.dashboardPort) || result.dashboardPort < 0 || result.dashboardPort > 65535)) {
    throw new Error(`Invalid dashboard port: ${result.dashboardPort}`);
  }
  return result;
}

async function loadConfig(path) {
  if (!path) return mergeConfig();
  const content = await readFile(resolve(path), "utf8");
  return mergeConfig(JSON.parse(content));
}

function formatRoute(decision) {
  return [
    `tier:   ${decision.tier}`,
    `model:  ${decision.model ?? "unchanged"}`,
    `effort: ${decision.effort ?? "unchanged"}`,
    `type:   ${decision.taskType}`,
    `confidence: ${decision.confidence}`,
    `reason: ${decision.rationale}`,
    decision.classifier
      ? `classifier: ${decision.classifier.model} (${decision.classifier.provider}, ${decision.classifier.latencyMs}ms)`
      : "classifier: bypassed by explicit override",
  ].join("\n");
}

async function launchCodex(options, catalog, config, classifier) {
  const proxy = await startProxy({
    catalog,
    codexPath: options.codexPath,
    classifier,
    config,
    verbosity: options.verbosity,
    terse: options.terse,
    audit: options.audit,
  });

  process.stderr.write(
    `codex-smart: semantic routing enabled; classifier=${classifier.describe()} (${options.verbosity} verbosity)\n`,
  );
  const tokenEnvironmentVariable = "CODEX_SMART_REMOTE_TOKEN";
  const child = spawn(options.codexPath, [
    "--remote",
    proxy.url,
    "--remote-auth-token-env",
    tokenEnvironmentVariable,
    ...options.rest,
  ], {
    stdio: "inherit",
    env: {
      ...process.env,
      [tokenEnvironmentVariable]: proxy.authToken,
    },
  });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);

  const code = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolveCode(signal ? 1 : (exitCode ?? 1)));
  });
  await proxy.close();
  return code;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (options.command === "stats") {
    const stats = await readAuditStats();
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return 0;
  }

  if (options.command === "dashboard") {
    const dashboard = await startDashboardServer({
      port: options.dashboardPort,
      baselineModel: process.env.CODEX_SMART_BASELINE_MODEL,
      pricing: process.env.CODEX_SMART_PRICING,
    });
    process.stdout.write(`codex-smart dashboard: ${dashboard.url}\nPress Ctrl+C to stop.\n`);
    if (options.openDashboard) spawn("open", [dashboard.url], { detached: true, stdio: "ignore" }).unref();
    return 0;
  }

  const catalog = loadCodexCatalog(options.codexPath);
  if (options.command === "models") {
    process.stdout.write(`${JSON.stringify(summarizeCatalog(catalog), null, 2)}\n`);
    return 0;
  }

  const config = await loadConfig(options.configPath);
  const classifier = createClassifier({
    mode: options.classifierMode,
    model: options.classifierModel,
    codexPath: options.codexPath,
    timeoutMs: options.classifierTimeoutMs,
  });
  if (options.command === "route") {
    const prompt = options.rest.join(" ");
    if (!prompt) throw new Error("route requires a prompt");
    const decision = await routePrompt(prompt, catalog, { config, classifier });
    process.stdout.write(options.json ? `${JSON.stringify(decision, null, 2)}\n` : `${formatRoute(decision)}\n`);
    return 0;
  }

  return launchCodex(options, catalog, config, classifier);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`codex-smart: ${error.message}\n`);
    process.exitCode = 1;
  });
