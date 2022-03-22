import type { Arguments, CommandBuilder } from "yargs";

import { API, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { useEnvironment } from "../../middleware/index.js";
import { showResult } from "../../lib/util.js";

export const command = "show [environment]";
export const desc = "Show a specific environmet";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const result = await GET(API.Environment, argv) as any;
  showResult(result);
};

export const middlewares = [
  useEnvironment
]
