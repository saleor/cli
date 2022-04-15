import type { Arguments, CommandBuilder } from "yargs";

import { API, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { useOrganization } from "../../middleware/index.js";
import { showResult } from "../../lib/util.js";

export const command = "show [slug]";
export const desc = "Show a specific organization";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const result = await GET(API.Organization, argv) as any;

  showResult(result)
};


export const middlewares = [
  useOrganization
]