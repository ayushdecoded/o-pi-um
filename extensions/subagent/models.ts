import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelRoute, ThinkingLevelType } from "./types.ts";

export const REQUIRED_MODEL_SECTIONS = [
  "Planning",
  "Complex coding",
  "Medium coding",
  "Exploration",
  "Quick edits",
  "Design",
  "Compaction",
] as const;

const THINKING_VALUES = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

export function modelsPath(cwd: string): string {
  return path.join(cwd, ".pi", "MODELS.md");
}

export function readModelsMarkdown(cwd: string): string | null {
  const file = modelsPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function parseModelsMd(cwd: string): Array<ModelRoute & { name: string; body?: string }> {
  // Subagents accept friendly route names from the project-local model routing file.
  const raw = readModelsMarkdown(cwd);
  if (!raw) return [];
  return raw
    .split(/^##\s+/m)
    .slice(1)
    .flatMap((section): Array<ModelRoute & { name: string; body?: string }> => {
      const [titleLine = "", ...rest] = section.split("\n");
      const body = rest.join("\n");
      const model = body.match(/^model:\s*(\S+)\s*$/m)?.[1];
      const reasoning = body.match(
        /^(?:thinking|reasoning):\s*(off|minimal|low|medium|high|xhigh)\s*$/m,
      )?.[1] as ThinkingLevelType | undefined;
      const secondaryModel = body.match(/^(?:secondary_model|secondary):\s*(\S+)\s*$/m)?.[1];
      const secondaryReasoning = body.match(
        /^(?:secondary_thinking|secondary_reasoning):\s*(off|minimal|low|medium|high|xhigh)\s*$/m,
      )?.[1] as ThinkingLevelType | undefined;
      return model
        ? [
            {
              name: titleLine.trim(),
              model,
              ...(reasoning ? { reasoning } : {}),
              ...(secondaryModel ? { secondaryModel } : {}),
              ...(secondaryReasoning ? { secondaryReasoning } : {}),
              body,
            },
          ]
        : [];
    });
}

export function validateModelsMd(cwd: string): { exists: boolean; ok: boolean; errors: string[] } {
  // Missing is allowed; malformed existing files are reported by the system-owned models command.
  const raw = readModelsMarkdown(cwd);
  if (!raw) return { exists: false, ok: true, errors: [] };
  const rules = parseModelsMd(cwd);
  const errors: string[] = [];
  const names = new Set(rules.map((rule) => rule.name));
  for (const section of REQUIRED_MODEL_SECTIONS) {
    if (!names.has(section)) errors.push(`Missing section: ${section}`);
  }
  for (const rule of rules) {
    if (!(REQUIRED_MODEL_SECTIONS as readonly string[]).includes(rule.name))
      errors.push(`Unknown section: ${rule.name}`);
    if (!rule.model) errors.push(`Missing model: ${rule.name}`);
    if (!rule.reasoning) errors.push(`Missing thinking: ${rule.name}`);
    else if (!THINKING_VALUES.has(rule.reasoning))
      errors.push(`Invalid thinking for ${rule.name}: ${rule.reasoning}`);
  }
  return { exists: true, ok: errors.length === 0, errors };
}

export function currentModelName(ctx: ExtensionContext): string | undefined {
  const model = (ctx as { model?: { provider?: string; id?: string } }).model;
  return model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
}

export function resolveModelRoute(
  ctx: ExtensionContext,
  model?: string,
  reasoning?: ThinkingLevelType,
): { model?: string; reasoning?: ThinkingLevelType } {
  // Resolution order: exact provider/id -> .pi/MODELS.md section -> fuzzy available model -> parent default.
  if (!model) return { reasoning };
  const exact = resolveExactAvailableModel(ctx, model);
  if (exact) return { model: exact, reasoning };
  const route = parseModelsMd(ctx.cwd).find(
    (item) => item.name.toLowerCase() === model.toLowerCase(),
  );
  if (route) {
    const primary = resolveExactAvailableModel(ctx, route.model);
    if (primary) return { model: primary, reasoning: reasoning ?? route.reasoning };
    // Secondary is only a fallback if the configured primary is not available/authenticated.
    const secondary = route.secondaryModel
      ? resolveExactAvailableModel(ctx, route.secondaryModel)
      : undefined;
    if (secondary)
      return {
        model: secondary,
        reasoning: reasoning ?? route.secondaryReasoning ?? route.reasoning,
      };
    return { model: route.model, reasoning: reasoning ?? route.reasoning };
  }
  const fuzzy = resolveAvailableModel(ctx, model);
  return fuzzy ? { model: fuzzy, reasoning } : { reasoning };
}

function resolveExactAvailableModel(ctx: ExtensionContext, query: string): string | undefined {
  const key = query.toLowerCase();
  return ctx.modelRegistry
    .getAvailable()
    .map((m) => `${m.provider}/${m.id}`)
    .find((full) => full.toLowerCase() === key);
}

function resolveAvailableModel(ctx: ExtensionContext, query: string): string | undefined {
  // Fuzzy names are convenience only. Unknown names intentionally fall back to parent default.
  const tokens = query
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !["latest", "newest", "model", "use", "the"].includes(token));
  if (tokens.length === 0) return undefined;
  const candidates = ctx.modelRegistry
    .getAvailable()
    .map((m) => ({
      full: `${m.provider}/${m.id}`,
      haystack: `${m.provider} ${m.id}`.toLowerCase(),
      id: m.id,
    }))
    .filter((m) => tokens.every((token) => m.haystack.includes(token)));
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => compareModelFreshness(b.id, a.id) || a.full.localeCompare(b.full));
  return candidates[0]?.full;
}

// Tie-break fuzzy matches toward newer/pro-like ids without requiring provider-specific code.
function compareModelFreshness(a: string, b: string): number {
  const av = modelVersionParts(a);
  const bv = modelVersionParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const rank = (id: string) =>
    id.includes("precision") ? 3 : id.includes("pro") ? 2 : id.includes("flash") ? 0 : 1;
  return rank(a) - rank(b);
}

function modelVersionParts(id: string): number[] {
  const match = id.match(/(?:v|gpt-|glm-|k2\.|qwen3\.)?(\d+(?:[.-]\d+)*)/i);
  return match
    ? match[1]!
        .split(/[.-]/)
        .map((n) => Number.parseInt(n, 10))
        .filter(Number.isFinite)
    : [];
}
