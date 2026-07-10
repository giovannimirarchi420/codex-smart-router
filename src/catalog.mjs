import { execFileSync } from "node:child_process";

export function loadCodexCatalog(codexPath = "codex") {
  let output;
  try {
    output = execFileSync(codexPath, ["debug", "models"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(`Could not read the Codex model catalog using ${codexPath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`Codex returned an invalid model catalog: ${error.message}`);
  }

  const models = parsed.models?.filter((model) => model.visibility !== "hide") ?? [];
  if (models.length === 0) throw new Error("Codex returned no selectable models");
  return { ...parsed, models };
}

export function summarizeCatalog(catalog) {
  return catalog.models.map((model) => ({
    model: model.slug,
    description: model.description,
    defaultEffort: model.default_reasoning_level,
    efforts: (model.supported_reasoning_levels ?? []).map((level) => level.effort),
  }));
}
