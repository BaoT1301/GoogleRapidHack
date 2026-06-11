import type { SupportedCli } from "../types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { fakeAdapter } from "./fake";
import { geminiAdapter } from "./gemini";
import { kiroAdapter } from "./kiro";
import type { CliAdapter } from "./types";

export { claudeAdapter } from "./claude";
export { codexAdapter } from "./codex";
export { fakeAdapter } from "./fake";
export { geminiAdapter } from "./gemini";
export { kiroAdapter } from "./kiro";
export type { CliAdapter, CliAdapterInput, CliCommand } from "./types";

export const cliAdapters: Record<SupportedCli, CliAdapter> = {
  fake: fakeAdapter,
  codex: codexAdapter,
  kiro: kiroAdapter,
  gemini: geminiAdapter,
  claude: claudeAdapter
};

export function getCliAdapter(cli: SupportedCli): CliAdapter {
  return cliAdapters[cli];
}
