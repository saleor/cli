import chalk from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import { promptOrganization } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "switch [slug]";
export const desc = "Make the provided organization the default one";

export const builder: CommandBuilder = (_) =>
  _.positional("slug", {
    type: "string",
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const organization = await getOrganization(argv);

  await Config.set("organization_slug", organization.value);
  await Config.remove("environment_id");
  console.log(chalk.green("✔"), chalk.bold("Organization ·"), chalk.cyan(organization.value));
};


const getOrganization = async (argv: Arguments<Options>) => {
  if (!argv.slug) {
    return await promptOrganization(argv);
  }

  const organizations = await GET(API.Organization, argv) as any[];
  if (organizations.map(o => o.slug).includes(argv.slug)) {
    return { name: argv.slug, value: argv.slug }
  }

  console.warn(chalk.red(`No organization with slug ${argv.slug} found`));
  process.exit(0);
}
