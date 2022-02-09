import type { Arguments, CommandBuilder } from "yargs";

type Options = {
  name: string;
};

export const command = "show <id>";
export const desc = "Show a specific environmet";

export const builder: CommandBuilder<Options, Options> = (_) => _

export const handler = (argv: Arguments<Options>): void => {
  const { slug } = argv;
  const greeting = `Hello, ${slug}!`;

  process.stdout.write(greeting);
  process.exit(0);
};
