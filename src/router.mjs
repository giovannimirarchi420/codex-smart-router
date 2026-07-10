const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export const DEFAULT_CONFIG = Object.freeze({
  tiers: {
    economy: {
      candidates: ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4", "gpt-5.6-terra", "gpt-5.5", "gpt-5.6-sol"],
      effort: "low",
    },
    balanced: {
      candidates: ["gpt-5.6-luna", "gpt-5.4", "gpt-5.4-mini", "gpt-5.6-terra", "gpt-5.5", "gpt-5.6-sol"],
      effort: "low",
    },
    complex: {
      candidates: ["gpt-5.6-terra", "gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.4-mini"],
      effort: "medium",
    },
    frontier: {
      candidates: ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra", "gpt-5.4"],
      effort: "high",
    },
    max: {
      candidates: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4"],
      effort: "max",
    },
  },
});

export function extractRouteDirective(prompt) {
  const source = String(prompt ?? "");
  const match = source.match(/^\s*::route\s+([^\r\n]+)(?:\r?\n|$)/i);
  if (!match) return { prompt: source, directive: null };

  const value = match[1].trim();
  const normalized = value.toLowerCase();
  const tierAliases = {
    auto: "auto",
    cheap: "economy",
    economy: "economy",
    balanced: "balanced",
    normal: "balanced",
    complex: "complex",
    deep: "frontier",
    frontier: "frontier",
    max: "max",
    off: "off",
  };

  let directive;
  if (tierAliases[normalized]) {
    directive = { type: "tier", tier: tierAliases[normalized] };
  } else {
    const custom = value.match(/^model=([A-Za-z0-9._:/-]+)\s+effort=([A-Za-z]+)$/i);
    if (!custom || !EFFORTS.includes(custom[2].toLowerCase())) {
      throw new Error(`Invalid route directive: ${value}`);
    }
    directive = { type: "custom", model: custom[1], effort: custom[2].toLowerCase() };
  }

  return { prompt: source.slice(match[0].length), directive };
}

function normalizeCatalog(catalog) {
  const models = Array.isArray(catalog) ? catalog : catalog?.models;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Codex model catalog is empty");
  }
  return models;
}

function effortList(model) {
  const levels = model.supported_reasoning_levels ?? model.supportedReasoningLevels ?? [];
  return levels.map((level) => (typeof level === "string" ? level : level.effort)).filter(Boolean);
}

export function resolveEffort(model, desired) {
  const supported = effortList(model);
  if (supported.length === 0 || supported.includes(desired)) return desired;

  const desiredIndex = EFFORTS.indexOf(desired);
  return supported
    .map((effort) => ({ effort, distance: Math.abs(EFFORTS.indexOf(effort) - desiredIndex) }))
    .sort((a, b) => a.distance - b.distance)[0].effort;
}

export function resolveTier(tier, catalog, config = DEFAULT_CONFIG) {
  const models = normalizeCatalog(catalog);
  const tierConfig = config.tiers[tier];
  if (!tierConfig) throw new Error(`Unknown route tier: ${tier}`);

  const model = tierConfig.candidates
    .map((slug) => models.find((entry) => entry.slug === slug))
    .find(Boolean) ?? models.find((entry) => entry.visibility !== "hide") ?? models[0];

  return {
    tier,
    model: model.slug,
    effort: resolveEffort(model, tierConfig.effort),
  };
}

function explicitDecision(extracted, catalog, config) {
  if (extracted.directive?.type === "tier" && extracted.directive.tier === "off") {
    return {
      tier: "off",
      model: null,
      effort: null,
      prompt: extracted.prompt,
      overridden: true,
      confidence: 1,
      taskType: "explicit_override",
      rationale: "Routing disabled for this turn.",
      classifier: null,
    };
  }

  if (extracted.directive?.type === "custom") {
    const models = normalizeCatalog(catalog);
    const model = models.find((entry) => entry.slug === extracted.directive.model);
    if (!model) throw new Error(`Model is not in the active Codex catalog: ${extracted.directive.model}`);
    const supported = effortList(model);
    if (supported.length > 0 && !supported.includes(extracted.directive.effort)) {
      throw new Error(`${model.slug} does not support reasoning effort ${extracted.directive.effort}`);
    }
    return {
      tier: "custom",
      model: model.slug,
      effort: extracted.directive.effort,
      prompt: extracted.prompt,
      overridden: true,
      confidence: 1,
      taskType: "explicit_override",
      rationale: "Explicit model and effort override.",
      classifier: null,
    };
  }

  const forcedTier = extracted.directive?.tier;
  if (forcedTier && forcedTier !== "auto") {
    return {
      ...resolveTier(forcedTier, catalog, config),
      prompt: extracted.prompt,
      overridden: true,
      confidence: 1,
      taskType: "explicit_override",
      rationale: `Explicit ${forcedTier} tier override.`,
      classifier: null,
    };
  }

  return null;
}

export async function routePrompt(prompt, catalog, options = {}) {
  const config = options.config ?? DEFAULT_CONFIG;
  const extracted = extractRouteDirective(prompt);
  const explicit = explicitDecision(extracted, catalog, config);
  if (explicit) return explicit;
  if (!options.classifier) throw new Error("No semantic classifier is configured");

  const classification = await options.classifier.classify({
    prompt: extracted.prompt,
    history: options.history ?? [],
    hasImages: options.hasImages ?? false,
    previousRoute: options.context?.previousDecision
      ? {
          tier: options.context.previousDecision.tier,
          model: options.context.previousDecision.model,
          effort: options.context.previousDecision.effort,
        }
      : null,
    previousUsage: options.context?.previousUsage ?? null,
    previousStatus: options.context?.previousStatus ?? null,
  });

  if (!["economy", "balanced", "complex", "frontier"].includes(classification.tier)) {
    throw new Error(`Classifier returned an invalid tier: ${classification.tier}`);
  }

  return {
    ...resolveTier(classification.tier, catalog, config),
    prompt: extracted.prompt,
    overridden: Boolean(extracted.directive),
    confidence: classification.confidence,
    taskType: classification.taskType,
    rationale: classification.rationale,
    classifier: classification.classifier,
  };
}

export function mergeConfig(overrides = {}) {
  return {
    tiers: Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.tiers).map(([name, value]) => [
        name,
        { ...value, ...(overrides.tiers?.[name] ?? {}) },
      ]),
    ),
  };
}
