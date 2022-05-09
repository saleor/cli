import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import { confirmRemoval, waitForTask } from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "remove [key|environment]";
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
  const { environment } = argv;
  const proceed = await confirmRemoval(argv, `environment ${environment}`);

  if (proceed) {
    const result = await DELETE(API.Environment, argv) as any;
    await waitForTask(argv, result.task_id, `Deleting environment: ${environment}`, 'Yay! Environment deleted!')
  }
};

export const middlewares = [
  useEnvironment
]