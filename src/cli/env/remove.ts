import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import { confirmRemoval, promptEnvironment, waitForTask } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "remove [key]";
export const desc = "Delete an environment";

export const builder: CommandBuilder = (_) =>
  _.positional("key", {
    type: "string",
    demandOption: false,
    desc: 'key of the environment'
  })
  .option("force", {
    type: 'boolean',
    desc: 'skip confrimation prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  const environment = argv.key ? { name: argv.key, value: argv.key } :
                                    await promptEnvironment(argv);
  const proceed = await confirmRemoval(argv, `environment ${environment.name}`);

  if (proceed) {
    const result = await DELETE(API.Environment, {...argv, environment: environment.value }) as any;
    await waitForTask(argv, result.task_id, `Deleting environment: ${environment.name}`, 'Yay! Environment deleted!')
  }
};
