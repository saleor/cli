import type { Arguments, CommandBuilder } from "yargs";
import { API, POST } from "../../lib/index.js";
import { showResult, waitForTask } from "../../lib/util.js";

export const command = "create <name>";
export const desc = "Create a new backup";

export const builder: CommandBuilder = (_) =>
  _.positional("name", {
    type: "string",
    demandOption: false,
    desc: "name for the new backup",
  });

export const handler = async (argv: Arguments<any>) => {
  const { name, env } = argv;

  const result = (await POST(API.Backup, argv, {
    json: {
      name: name,
    },
  })) as any;

  await waitForTask(
    argv,
    result.task_id,
    `Creating backup ${name}`,
    "Yay! Backup created!"
  );
  showResult(result);
};
