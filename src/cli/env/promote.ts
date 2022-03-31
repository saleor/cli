import type { Arguments, CommandBuilder } from "yargs";

import { API, PUT, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptCompatibleVersion, showResult } from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";

export const command = "promote [environment]";
export const desc = "Promote environment to production";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const env  = await GET(API.Environment, argv) as any;

  // TODO take from option !!! so it's CLI friendly
  const service = await promptCompatibleVersion(
    {...argv,
      region: env.service.region,
      serviceName: `?compatible_with=${env.service.version}`
    },
    "PRODUCTION");
  const result = await PUT(API.UpgradeEnvironment, argv, { json: { service: service.value }}) as any;
  showResult(result);
};

export const middlewares = [
  useEnvironment
]
