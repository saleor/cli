import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import { waitForTask } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "remove <environment>";
export const desc = "Remove an environmet";

export const builder: CommandBuilder = (_) =>
  _.positional("key", {
    type: "string",
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  const result = await DELETE(API.Environment, argv) as any;
  await waitForTask(argv, result.task_id, `Deleting environment: ${argv.environment}`, 'Yay! Environment deleted!')
};
