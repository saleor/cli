import type { Arguments, CommandBuilder } from "yargs";

import { API, GET, PUT } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptOrganizationBackup, waitForTask } from "../../lib/util.js";
import { updateWebhook } from "../webhook/update.js";
import Enquirer from "enquirer";

export const command = "restore [from]";
export const desc = "Restore a specific backup";

export const builder: CommandBuilder = (_) =>
    _.option("from", {
      type: 'string',
      demandOption: false,
      desc: 'id of the snapshot',
    })

export const handler = async (argv: Arguments<Options>) => {
  let { from } = argv;

  if (!from) {
    const { value } = await promptOrganizationBackup(argv)
    from = value;
  }

  const result = await PUT(API.Restore, argv, {
    json: {
      restore_from: from
    }
  }) as any;

  await waitForTask(argv, result.task_id, 'Restoring', 'Yay! Restore finished!')

  const { update } = await Enquirer.prompt<{ update: string }>({
    type: "confirm",
    name: 'update',
    message: 'Would you like to update webhooks targetUrl',
  });

  if (update) {
    const { domain } = await GET(API.Environment, argv) as any;
    await updateWebhook(domain);
  }
};
