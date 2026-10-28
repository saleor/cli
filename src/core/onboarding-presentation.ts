import { Effect } from "effect";
import { useColors, writeText } from "./output.ts";

const WORDMARK = [
  "███████╗ █████╗ ██╗     ███████╗ ██████╗ ██████╗ ",
  "██╔════╝██╔══██╗██║     ██╔════╝██╔═══██╗██╔══██╗",
  "███████╗███████║██║     █████╗  ██║   ██║██████╔╝",
  "╚════██║██╔══██║██║     ██╔══╝  ██║   ██║██╔══██╗",
  "███████║██║  ██║███████╗███████╗╚██████╔╝██║  ██║",
  "╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝",
];

const ink = (text: string, color: string) =>
  useColors(process.stdout) ? `\x1b[${color}m${text}\x1b[0m` : text;

// The welcome belongs to the prompt, not the progress stream. Write it in one
// pass so terminal hosts cannot display an animated stderr splash separately
// from the stdout menu. Leave room for the first question in smaller terminals.
export const welcome = Effect.suspend(() => {
  const rich =
    useColors(process.stdout) &&
    (process.stdout.columns ?? 80) >= 54 &&
    (process.stdout.rows ?? 24) >= 24;

  const wordmark = rich
    ? WORDMARK.map(
        (row, index) => `  ${ink(row, index < 3 ? "1;94" : "1;96")}`
      ).join("\n")
    : "  SALEOR";

  return writeText(
    `\n${wordmark}\n\n  ${ink("Welcome to Saleor", "1")}\n  Set up your workspace and coding agent.\n`
  );
});

export const onboardingSection = (
  number: string,
  title: string,
  text: string
) =>
  writeText(
    `\n${ink(`${number} / ${title.toUpperCase()}`, "1;36")}\n${text}\n\n`
  );

export const onboardingReady = (skipped: boolean) =>
  writeText(
    `\n${ink(skipped ? "→ Setup skipped." : "✓ Setup complete.", "1;36")}\nChoose a command below.\n${ink("You can revisit setup anytime: saleor onboard", "2")}\n\n`
  );
