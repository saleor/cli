import Enquirer from "enquirer";
import type { Arguments, CommandBuilder } from "yargs";

import { API, GET, PUT } from "../../lib/index.js";
import { promptOrganizationBackup, waitForTask } from "../../lib/util.js";
import { Options } from "../../types.js";
import { updateWebhook } from "../webhook/update.js";

export const command = "restore [from]";
export const desc = "Restore a specific backup";

export const builder: CommandBuilder = (_) =>
  _.option("from", {
    type: "string",
    demandOption: false,
    desc: "key of the snapshot",
  }).option("skip-webhooks-update", {
    type: "boolean",
    demandOption: false,
    desc: "skip webhooks update prompt",
  });

export const handler = async (argv: Arguments<Options>) => {
  const from = await getBackup(argv);

  const result = (await PUT(API.Restore, argv, {
    json: {
      restore_from: from.value,
    },
  })) as any;

  await waitForTask(
    argv,
    result.task_id,
    "Restoring",
    "Yay! Restore finished!"
  );

  const { update } = await Enquirer.prompt<{ update: string }>({
    type: "confirm",
    name: "update",
    skip: !!argv.skipWebhooksUpdate,
    message: "Would you like to update webhooks targetUrl",
  });

  if (update) {
    const { domain } = (await GET(API.Environment, argv)) as any;
    await updateWebhook(domain);
  }
};

const getBackup = async (argv: Arguments<Options>) => {
  if (argv.from) {
    return { key: argv.from, value: argv.from };
  }

  return await promptOrganizationBackup(argv);
};
