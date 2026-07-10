import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultAuditPath(env = process.env) {
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "smart-router", "routes.jsonl");
}

export async function appendAudit(entry, path = defaultAuditPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const record = {
    event: "route",
    timestamp: new Date().toISOString(),
    routeId: entry.routeId,
    threadId: entry.threadId,
    tier: entry.tier,
    score: entry.score,
    model: entry.model,
    effort: entry.effort,
    overridden: entry.overridden,
    confidence: entry.confidence,
    taskType: entry.taskType,
    classifier: entry.classifier
      ? {
          provider: entry.classifier.provider,
          model: entry.classifier.model,
          latencyMs: entry.classifier.latencyMs,
          usage: entry.classifier.usage,
        }
      : null,
  };
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function appendUsageAudit(entry, path = defaultAuditPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const record = {
    event: "usage",
    timestamp: new Date().toISOString(),
    routeId: entry.routeId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    tier: entry.tier,
    model: entry.model,
    effort: entry.effort,
    status: entry.status,
    durationMs: entry.durationMs,
    usage: entry.usage,
  };
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readAuditStats(path = defaultAuditPath()) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        path,
        total: 0,
        tiers: {},
        models: {},
        efforts: {},
        averageScore: 0,
        averageConfidence: 0,
        classifiers: {},
        classifierUsage: {
          calls: 0,
          latencyMs: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
        classifierUsageByModel: {},
        usage: {
          turns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
        usageByModel: {},
        daily: {},
      };
    }
    throw error;
  }

  const rows = content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const routes = rows.filter((row) => !row.event || row.event === "route");
  const usages = rows.filter((row) => row.event === "usage" && row.usage);
  const classifiedRoutes = routes.filter((row) => row.classifier);
  const count = (field) => routes.reduce((result, row) => {
    const value = row[field] ?? "unknown";
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});

  const usage = usages.reduce((total, row) => {
    for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
      total[field] += row.usage[field] ?? 0;
    }
    return total;
  }, {
    turns: usages.length,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  });
  const usageByModel = usages.reduce((result, row) => {
    const model = row.model ?? "unknown";
    result[model] ??= {
      turns: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    result[model].turns += 1;
    for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
      result[model][field] += row.usage[field] ?? 0;
    }
    return result;
  }, {});
  const daily = usages.reduce((result, row) => {
    const date = row.timestamp?.slice(0, 10) ?? "unknown";
    result[date] ??= { turns: 0, totalTokens: 0, durationMs: 0 };
    result[date].turns += 1;
    result[date].totalTokens += row.usage.totalTokens ?? 0;
    result[date].durationMs += row.durationMs ?? 0;
    return result;
  }, {});
  const hourly = usages.reduce((result, row) => {
    const timestamp = row.timestamp ? new Date(row.timestamp) : null;
    const bucket = timestamp && !Number.isNaN(timestamp.getTime())
      ? new Date(Math.floor(timestamp.getTime() / 3_600_000) * 3_600_000).toISOString()
      : "unknown";
    result[bucket] ??= { turns: 0, totalTokens: 0, durationMs: 0 };
    result[bucket].turns += 1;
    result[bucket].totalTokens += row.usage.totalTokens ?? 0;
    result[bucket].durationMs += row.durationMs ?? 0;
    return result;
  }, {});
  const classifierUsage = classifiedRoutes.reduce((total, row) => {
    const rowUsage = row.classifier?.usage;
    if (rowUsage) {
      total.calls += 1;
      for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
        total[field] += rowUsage[field] ?? 0;
      }
    }
    total.latencyMs += row.classifier?.latencyMs ?? 0;
    return total;
  }, {
    calls: 0,
    latencyMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  });
  const classifierUsageByModel = classifiedRoutes.reduce((result, row) => {
    const model = row.classifier ? `${row.classifier.provider}:${row.classifier.model}` : "unknown";
    result[model] ??= {
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    const target = result[model];
    target.calls += 1;
    for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
      target[field] += row.classifier?.usage?.[field] ?? 0;
    }
    return result;
  }, {});

  return {
    path,
    total: routes.length,
    tiers: count("tier"),
    models: count("model"),
    efforts: count("effort"),
    averageScore: routes.length ? routes.reduce((sum, row) => sum + (row.score ?? 0), 0) / routes.length : 0,
    averageConfidence: classifiedRoutes.length
      ? classifiedRoutes.reduce((sum, row) => sum + (row.confidence ?? 0), 0) / classifiedRoutes.length
      : 0,
    classifiers: classifiedRoutes.reduce((result, row) => {
      const key = `${row.classifier.provider}:${row.classifier.model}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {}),
    classifierUsage,
    classifierUsageByModel,
    usage,
    usageByModel,
    daily,
    hourly,
  };
}
