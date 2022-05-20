import type { Arguments, CommandBuilder } from "yargs";

import { API, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { showResult } from "../../lib/util.js";

export const command = "show [backup]";
export const desc = "Show a specific backup";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const result = (await GET(API.Backup, argv)) as any;
  showResult(result, argv)
};
