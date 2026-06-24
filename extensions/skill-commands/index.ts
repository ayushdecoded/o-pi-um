import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface SkillCommand {
  name: string;
  description: string;
  path: string;
}

export default function registerDisabledSkillCommands(pi: ExtensionAPI): void {
  const skills = discoverDisabledSkills();
  const registered = new Set<string>();

  for (const skill of skills) {
    if (registered.has(skill.name)) continue;
    registered.add(skill.name);

    pi.registerCommand(skill.name, {
      description: `Load hidden skill: ${skill.description}`,
      handler: async (args, ctx) => {
        let content: string;
        try {
          content = await readFile(skill.path, "utf8");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Could not load skill ${skill.name}: ${message}`, "error");
          return;
        }

        const userRequest = normalizeArgs(args);
        const prompt = buildSkillPrompt(skill.name, content, userRequest);
        if (!ctx.isIdle()) {
          pi.sendUserMessage(prompt, { deliverAs: "followUp" });
          ctx.ui.notify(`Queued /${skill.name} for after the current turn`, "info");
          return;
        }

        pi.sendUserMessage(prompt);
      },
    });
  }
}

function discoverDisabledSkills(): SkillCommand[] {
  const skillFiles = new Set<string>();
  const cwd = process.cwd();

  for (const root of [
    path.join(homedir(), ".pi/agent/skills"),
    path.join(homedir(), ".agents/skills"),
    ...projectSkillRoots(cwd),
    ...configuredSkillRoots(),
    ...packageSkillRoots(),
  ]) {
    discoverSkillFiles(expandHome(root), skillFiles);
  }

  return [...skillFiles]
    .map(readSkillCommand)
    .filter((skill): skill is SkillCommand => Boolean(skill))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectSkillRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    roots.push(path.join(current, ".pi/skills"));
    roots.push(path.join(current, ".agents/skills"));
    if (existsSync(path.join(current, ".git"))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function configuredSkillRoots(): string[] {
  const settings = readJson(path.join(homedir(), ".pi/agent/settings.json"));
  const skills: unknown[] = Array.isArray(settings?.skills) ? settings.skills : [];
  return skills.filter((entry): entry is string => typeof entry === "string");
}

function packageSkillRoots(): string[] {
  const settings = readJson(path.join(homedir(), ".pi/agent/settings.json"));
  const packages: unknown[] = Array.isArray(settings?.packages) ? settings.packages : [];
  const roots: string[] = [];

  for (const entry of packages) {
    if (typeof entry !== "string" || entry.startsWith("npm:") || entry.startsWith("git:")) continue;
    const packageRoot = expandHome(entry);
    const manifest = readJson(path.join(packageRoot, "package.json"));
    const declared: unknown[] = Array.isArray(manifest?.pi?.skills) ? manifest.pi.skills : [];
    for (const skillPath of declared) {
      if (typeof skillPath === "string") roots.push(path.resolve(packageRoot, skillPath));
    }
    roots.push(path.join(packageRoot, "skills"));
  }

  return roots;
}

function discoverSkillFiles(root: string, out: Set<string>): void {
  if (!existsSync(root)) return;
  const stat = safeStat(root);
  if (!stat) return;

  if (stat.isFile() && path.basename(root).toLowerCase().endsWith(".md")) {
    out.add(root);
    return;
  }

  if (!stat.isDirectory()) return;

  const directSkill = path.join(root, "SKILL.md");
  if (existsSync(directSkill)) {
    out.add(directSkill);
    return;
  }

  for (const entry of safeReadDir(root)) {
    const child = path.join(root, entry);
    const childStat = safeStat(child);
    if (!childStat?.isDirectory()) continue;
    discoverSkillFiles(child, out);
  }

  // Pi also discovers root .md files in .pi/skills-style directories.
  for (const entry of safeReadDir(root)) {
    if (entry.toLowerCase().endsWith(".md")) out.add(path.join(root, entry));
  }
}

function readSkillCommand(file: string): SkillCommand | undefined {
  const content = readText(file);
  if (!content) return undefined;
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return undefined;
  if (!isTruthy(frontmatter["disable-model-invocation"])) return undefined;

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name || !description || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name))
    return undefined;
  return { name, description, path: file };
}

function parseFrontmatter(content: string): Record<string, string> | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const block = content.slice(4, end);
  const values: Record<string, string> = {};

  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function buildSkillPrompt(name: string, skill: string, userRequest: string): string {
  return [
    "Load and follow this hidden skill for this turn. Treat it as explicit user-provided skill instructions.",
    "",
    `<skill name=\"${name}\">`,
    skill.trim(),
    "</skill>",
    "",
    userRequest
      ? `User request: ${userRequest}`
      : "User request: Use the skill. Ask for clarification if needed.",
  ].join("\n");
}

function normalizeArgs(args: string | undefined): string {
  return (args ?? "").replace(/\s+/g, " ").trim();
}

function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

function isTruthy(value: string | undefined): boolean {
  return /^(true|yes|1)$/i.test(value ?? "");
}

function readJson(file: string): any {
  const text = readText(file);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(file: string) {
  try {
    return statSync(file);
  } catch {
    return undefined;
  }
}
