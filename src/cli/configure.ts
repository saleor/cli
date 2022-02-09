import type { Arguments, CommandBuilder } from "yargs";

type Options = {
  name: string;
};

export const command = "configure";
export const desc = "Configure";

export const handler = () => {
  const greeting = `Configure`;

  process.stdout.write(greeting);
  process.exit(0);
};

