export const DEFAULT_PRICING = Object.freeze({
  "gpt-5.6-sol": { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 },
  "gpt-5.6-terra": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
  "gpt-5.6-luna": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 6 },
  "gpt-5.5": { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 },
  "gpt-5.4": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
  "gpt-5.4-mini": { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 },
  "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
});

function cost(usage = {}, pricing = {}) {
  const input = Math.max(0, (usage.inputTokens ?? 0) - (usage.cachedInputTokens ?? 0));
  const cached = usage.cachedInputTokens ?? 0;
  const output = (usage.outputTokens ?? 0) + (usage.reasoningOutputTokens ?? 0);
  return (input * (pricing.inputPerMillion ?? 0)
    + cached * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion ?? 0)
    + output * (pricing.outputPerMillion ?? 0)) / 1_000_000;
}

export function parsePricing(value) {
  if (!value) return { ...DEFAULT_PRICING };
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return { ...DEFAULT_PRICING, ...parsed };
}

export function buildDashboard(stats, options = {}) {
  const pricing = parsePricing(options.pricing);
  const baselineModel = options.baselineModel ?? "gpt-5.5";
  const baselinePricing = pricing[baselineModel];
  const executionPricing = pricing;
  const modelUsage = stats.usageByModel ?? {};
  const missingExecutionPricing = Object.keys(modelUsage).some((model) => !executionPricing[model]);
  const executionCost = Object.entries(modelUsage).reduce((sum, [model, usage]) => {
    return sum + cost(usage, executionPricing[model]);
  }, 0);
  const classifierUsage = stats.classifierUsageByModel ?? Object.fromEntries(Object.keys(stats.classifiers ?? {}).map((key) => [key, stats.classifierUsage]));
  const missingClassifierPricing = Object.keys(classifierUsage).some((key) => !executionPricing[key.split(":").slice(1).join(":")]);
  const classifierCost = Object.entries(classifierUsage).reduce((sum, [key, usage]) => {
    const model = key.split(":").slice(1).join(":");
    return sum + cost(usage, executionPricing[model]);
  }, 0);
  const routedCost = missingExecutionPricing || missingClassifierPricing ? null : executionCost + classifierCost;
  const baselineCost = baselinePricing && stats.usage?.turns
    ? cost(stats.usage, baselinePricing)
    : null;
  const savings = baselineCost === null ? null : baselineCost - routedCost;

  return {
    ...stats,
    estimate: {
      baselineModel,
      baselineCost,
      routedCost,
      estimatedSavings: routedCost === null || baselineCost === null ? null : savings,
      estimatedSavingsPercent: baselineCost > 0 && routedCost !== null ? (savings / baselineCost) * 100 : null,
      pricingConfigured: Boolean(baselinePricing) && routedCost !== null,
      note: missingExecutionPricing || missingClassifierPricing
        ? "Some routed models have no price mapping. Add them with CODEX_SMART_PRICING to calculate total savings."
        : "Estimate uses standard API token prices; verify against your provider invoice.",
    },
    convenience: {
      routingCoveragePercent: stats.total ? ((stats.total - (stats.tiers?.off ?? 0)) / stats.total) * 100 : 0,
      classifierOverheadMsPerTurn: stats.classifierUsage?.calls ? stats.classifierUsage.latencyMs / stats.classifierUsage.calls : 0,
      completedTurns: stats.usage?.turns ?? 0,
    },
  };
}

export function formatDashboard(dashboard, currency = "$") {
  const e = dashboard.estimate;
  const money = (value) => `${currency}${value.toFixed(2)}`;
  const savings = e.estimatedSavings === null ? "not configured" : `${money(e.estimatedSavings)} (${e.estimatedSavingsPercent.toFixed(1)}%)`;
  return [
    "codex-smart dashboard",
    "====================",
    `Turns: ${dashboard.usage.turns} | Routes: ${dashboard.total}`,
    `Models: ${Object.entries(dashboard.models).map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
    `Routing coverage: ${dashboard.convenience.routingCoveragePercent.toFixed(1)}%`,
    `Average confidence: ${(dashboard.averageConfidence * 100).toFixed(1)}%`,
    `Classifier overhead: ${dashboard.convenience.classifierOverheadMsPerTurn.toFixed(0)} ms/turn`,
    `Estimated routed cost: ${e.routedCost === null ? "not configured" : money(e.routedCost)}`,
    `Estimated savings vs ${e.baselineModel ?? "baseline"}: ${savings}`,
    e.note,
  ].join("\n");
}
