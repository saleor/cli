import { Option } from "effect";
import { CliOutput, type HelpDoc } from "effect/cli";

// Help is rendered here rather than by Effect's default formatter, which shows primitive
// type names ("choice", "string"), appends "(choices: …)" to descriptions and lists the
// built-in flags first. Errors are not rendered here: the runtime turns every parser
// failure into a CliFailure, so they look like every other error.

const CHOICES = /\s*\(choices: ([^)]*)\)$/;

export const BUILT_IN_DESCRIPTIONS = new Map([
  ["completions", "Print a shell completion script."],
  ["help", "Show help for a command."],
  ["version", "Print the CLI version."],
]);

const PLACEHOLDERS = new Map([["completions", "shell"]]);

const styles = (colors: boolean) => {
  const wrap = (code: string) => (text: string) =>
    colors ? `\x1b[${code}m${text}\x1b[0m` : text;

  return { bold: wrap("1"), cyan: wrap("36"), dim: wrap("2") };
};

const table = (rows: ReadonlyArray<readonly [string, string]>) => {
  const width = Math.max(...rows.map(([left]) => left.length)) + 3;

  return rows.map(([left, right]) =>
    right.length === 0 ? `  ${left}` : `  ${left.padEnd(width)}${right}`
  );
};

const flagRow = (flag: HelpDoc.FlagDoc): readonly [string, string] => {
  const raw = Option.getOrElse(flag.description, () => "");
  const choices = CHOICES.exec(raw)?.[1]?.split(", ");

  const description =
    BUILT_IN_DESCRIPTIONS.get(flag.name) ?? raw.replace(CHOICES, "");

  let value = "";

  if (choices !== undefined) {
    const joined = choices.join("|");
    value =
      joined.length <= 12
        ? `<${joined}>`
        : `<${PLACEHOLDERS.get(flag.name) ?? "value"}>`;
  } else if (flag.type !== "boolean") {
    value = flag.type.startsWith("<") ? flag.type : `<${flag.type}>`;
  }

  const names = [
    ...flag.aliases.filter((alias) => alias.length === 2),
    `--${flag.name}`,
  ].join(", ");

  const listed =
    choices !== undefined && !value.includes("|")
      ? ` One of: ${choices.join(", ")}.`
      : "";

  return [
    `${names}${value ? ` ${value}` : ""}`,
    `${description}${listed}${flag.required ? " (required)" : ""}`,
  ];
};

export const formatHelp = (doc: HelpDoc.HelpDoc, colors: boolean): string => {
  const { bold, cyan, dim } = styles(colors);
  const lines: string[] = [];

  const section = (title: string, body: readonly string[]) => {
    if (body.length > 0) {
      lines.push(bold(title), ...body, "");
    }
  };

  if (doc.description) {
    lines.push(doc.description, "");
  }

  section("USAGE", [
    `  ${cyan(doc.usage.replace("<subcommand>", "<command>"))}`,
  ]);

  section("AUTOMATION", [
    "  Agents and scripts: use --agent (shorthand for --json --no-input).",
    "  Discover commands and inputs: saleor commands --agent",
  ]);

  section(
    "ARGUMENTS",
    table(
      (doc.args ?? []).map((arg) => [
        `<${arg.name}>${arg.variadic ? "..." : ""}`,
        `${Option.getOrElse(arg.description, () => "")}${arg.required ? "" : " (optional)"}`,
      ])
    )
  );

  section("FLAGS", doc.flags.length > 0 ? table(doc.flags.map(flagRow)) : []);

  const commands = (doc.subcommands ?? []).flatMap((group) => group.commands);
  section(
    "COMMANDS",
    commands.length > 0
      ? table(
          commands.map((command) => [
            command.name,
            command.shortDescription ?? command.description,
          ])
        )
      : []
  );

  section(
    "EXAMPLES",
    (doc.examples ?? []).flatMap((example) => [
      ...(example.description ? [dim(`  # ${example.description}`)] : []),
      `  ${example.command}`,
    ])
  );

  // The global flags are the same everywhere, so they are listed once, at the root.
  const globals = doc.globalFlags ?? [];
  const isRoot = doc.usage.startsWith("saleor <");

  if (isRoot) {
    section(
      "GLOBAL FLAGS",
      globals.length > 0 ? table(globals.map(flagRow)) : []
    );
  } else if (globals.length > 0) {
    lines.push(
      dim(
        "Global flags (--agent, --output <text|json>, --json, --no-input, --help): see 'saleor --help'."
      )
    );
  }

  if (commands.length > 0) {
    const path = doc.usage.split(" <")[0] ?? "saleor";
    lines.push(dim(`Run '${path} <command> --help' for details on a command.`));
  }

  return lines.join("\n").trimEnd();
};

export const helpFormatter = (colors: boolean): CliOutput.Formatter => ({
  ...CliOutput.defaultFormatter({ colors }),
  formatHelpDoc: (doc) => formatHelp(doc, colors),
});
