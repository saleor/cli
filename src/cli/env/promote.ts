import type { Arguments, CommandBuilder } from "yargs";

import { API, PUT, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptCompatibleVersion, showResult } from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";

export const command = "promote [key|environment]";
export const desc = "Promote environment to production";

export const builder: CommandBuilder = (_) =>
  _.positional("key", {
    type: "string",
    demandOption: false,
    desc: 'key of the environment'
  })
  .option("saleor", {
    type: 'string',
    desc: 'specify the Saleor version',
  });

export const handler = async (argv: Arguments<Options>) => {
  const service = await getService(argv)
  const result = await PUT(API.UpgradeEnvironment, argv, { json: { service: service.value }}) as any;
  showResult(result);
};

const getService = async (argv: Arguments<Options>) => {
  if (argv.saleor) {
    return {key: argv.saleor, value: argv.saleor}
  }

  const env  = await GET(API.Environment, argv) as any;
  return await promptCompatibleVersion(
    {...argv,
      region: env.service.region,
      serviceName: `?compatible_with=${env.service.version}`
    },
    "PRODUCTION");
}

export const middlewares = [
  useEnvironment
]
