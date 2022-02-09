import type { Arguments, CommandBuilder } from "yargs";

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = (argv: Arguments): void => {
  process.stdout.write('Loging...');
  process.exit(0);
};
