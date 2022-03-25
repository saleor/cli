import type { Arguments, CommandBuilder } from "yargs";

type Options = {
  name: string;
};

export const command = "init <name>";
export const desc = "Initialize <name>";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { type: "string", demandOption: true });

export const handler = (argv: Arguments<Options>): void => {
  const { name } = argv;
  const greeting = `Hello, ${name}!`;

  process.stdout.write(greeting);
  process.exit(0);
};
