import type { Arguments, CommandBuilder } from "yargs";
import { download, extract } from "gitly";
import ora from "ora";
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { lookpath  } from "lookpath";
import chalk from "chalk";
import replace from "replace-in-file";
import sanitize from "sanitize-filename";

import { API, GET } from "../../lib/index.js";
import { StoreCreate } from "../../types.js";


export const command = "create [name]";
export const desc = "Boostrap example [name]";

export const builder: CommandBuilder<Record<string, never>, StoreCreate> = (_) =>
  _.positional("name", { type: "string", demandOption: true, default: "saleor-react-storefront-app" })

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  const env = await GET(API.Environment, argv) as any;

  const pnpm = await lookpath('pnpm');

  if (!pnpm) {
    console.log(chalk.red(`✘ react-storefront project uses the pnpm package manager. To install it, run:`));
    console.log(`
  npm install -g pnpm
`);
    process.exit(1);
  }

  const spinner = ora('Downloading...').start();
  const file = await download(`saleor/react-storefront`)

  spinner.text = 'Extracting...'
  const target = getFolderName(sanitize(argv.name));
  await extract(file, target);

  process.chdir(target);
  spinner.text = `Creating .env...`;
  const baseUrl = `https://${env.domain}/graphql/`;
  replace.sync({
    files: '.env',
    from: /NEXT_PUBLIC_API_URI=.*/g,
    to: `NEXT_PUBLIC_API_URI=${baseUrl}`});

  spinner.text = 'Installing dependencies...';
  await runExec(`pnpm i`, false);
  spinner.succeed('Staring ...\`pnpm run dev\`');

  await runExec(`pnpm run dev`, true);
};

const runExec = async (cmd: string, log: boolean, result = false): Promise<string | void> => {
  const child = await exec(cmd);
  for await (const data of child.stdout || []) {
    if (log) console.log(data);
  }
}

const getFolderName = (name: string): string => {
  let folderName = name;
  while (existsSync(folderName)) {
    folderName = folderName.concat('-0');
  }

  return folderName
}