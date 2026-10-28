import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";
import { SelectPrompt } from "@clack/core";
import {
  formatInstructionFooter,
  limitOptions,
  S_BAR,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from "@clack/prompts";
import type { Choice } from "./interaction.ts";
import { BACK } from "./navigation.ts";

interface MenuPromptOptions {
  readonly back: boolean;
  readonly choices: readonly Choice<string>[];
  readonly initialValue?: string | undefined;
  readonly input?: Readable;
  readonly message: string;
  readonly output?: Writable;
}

// Clack's high-level select cannot distinguish Escape from Ctrl+C or customize its footer.
export const menuPrompt = async (options: MenuPromptOptions) => {
  let escaped = false;

  const prompt = new SelectPrompt<Choice<string>>({
    ...(options.initialValue === undefined
      ? undefined
      : { initialValue: options.initialValue }),
    input: options.input ?? process.stdin,
    options: [...options.choices],
    output: options.output ?? process.stdout,
    render() {
      const back = escaped && options.back;
      const state = this.state === "cancel" && back ? "submit" : this.state;
      const header = `${styleText("gray", S_BAR)}\n${symbol(state)}  ${options.message}\n`;

      if (this.state === "submit" || this.state === "cancel") {
        const label = back ? "Back" : (this.options[this.cursor]?.label ?? "");

        return `${header}${styleText("gray", S_BAR)}  ${styleText("dim", label)}`;
      }

      const instructions = [
        "↑/↓ to navigate",
        "Enter: confirm",
        ...(options.back ? ["Esc: back"] : []),
        "Ctrl+C: exit",
      ];

      const footer = formatInstructionFooter(instructions, true).join("\n");
      const prefix = `${styleText("cyan", S_BAR)}  `;

      const rows = limitOptions({
        columnPadding: 3,
        cursor: this.cursor,
        options: this.options,
        output: options.output ?? process.stdout,
        rowPadding: header.split("\n").length + footer.split("\n").length + 1,
        style: (choice, active) =>
          active
            ? `${styleText("green", S_RADIO_ACTIVE)} ${choice.label}${choice.hint ? ` ${styleText("dim", `(${choice.hint})`)}` : ""}`
            : styleText("dim", `${S_RADIO_INACTIVE} ${choice.label}`),
      });

      return `${header}${prefix}${rows.join(`\n${prefix}`)}\n${footer}\n`;
    },
  });

  prompt.on("key", (_value, key) => {
    escaped = key.name === "escape";
  });
  prompt.on("finalize", () => {
    // With no way back, Escape is not an answer, so keep the picker open.
    if (escaped && !options.back) {
      prompt.state = "active";
    }
  });

  const answer = await prompt.prompt();

  return escaped && options.back ? BACK : answer;
};
