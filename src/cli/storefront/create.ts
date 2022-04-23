import { Arguments, CommandBuilder } from "yargs";
import { download, extract } from "gitly";
import ora from "ora";
import { access } from 'fs/promises';
import { lookpath  } from "lookpath";
import chalk from "chalk";
import replace from "replace-in-file";
import sanitize from "sanitize-filename";
import fs from 'fs-extra';

import { API, GET } from "../../lib/index.js";
import { StoreCreate } from "../../types.js";
import { run } from "../../lib/common.js";

export const command = "create [name]";
export const desc = "Boostrap example [name]";

export const builder: CommandBuilder<Record<string, never>, StoreCreate> = (_) =>
  _.positional("name", { type: "string", demandOption: true, default: "saleor-react-storefront-app" })

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {

  const env = await GET(API.Environment, argv) as any;

  const pnpm = await lookpath('pnpm');

  if (!pnpm) {
    console.log(chalk.red(`
✘ react-storefront project uses the pnpm package manager. To install it, run:`));
    console.log(`  npm install -g pnpm`);
    process.exit(1);
  }

  const spinner = ora('Downloading...').start();
  const file = await download(`saleor/react-storefront`)

  spinner.text = 'Extracting...'
  const target = await getFolderName(sanitize(argv.name));
  await extract(file, target);

  process.chdir(target);
  spinner.text = `Creating .env...`;
  const baseURL = `https://${env.domain}/graphql/`;

  replace.sync({
    files: '.env',
    from: /NEXT_PUBLIC_API_URI=.*/g,
    to: `NEXT_PUBLIC_APP_URL=${baseURL}`});

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i', '--ignore-scripts'], { cwd: process.cwd() })
  spinner.succeed('Staring ...\`pnpm run dev\`');

  await run('pnpm', ['run', 'dev'], { stdio: 'inherit', cwd: process.cwd() }, true)
}

const getFolderName = async (name: string): Promise<string> => {
  let folderName = name;
  while (await dirExists(folderName)) {
    folderName = folderName.concat('-0');
  }
  return folderName
}

const dirExists = async (name: string): Promise<boolean> => {
  try {
    await access(name);
    return true
  } catch (error) {
    return false
  }
}