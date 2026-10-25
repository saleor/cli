import type { GlobalInput } from "./catalog.ts";
import { NoInputFlag } from "./interaction.ts";
import { AgentFlag, OutputFlag } from "./output.ts";

// The flags every command takes, with what the catalogue publishes about them.
export const GLOBAL_INPUTS: readonly GlobalInput[] = [
  { global: OutputFlag, info: { env: "SALEOR_OUTPUT" } },
  { global: NoInputFlag, info: { default: false, env: "SALEOR_NO_INPUT" } },
  { global: AgentFlag, info: { default: false } },
];
