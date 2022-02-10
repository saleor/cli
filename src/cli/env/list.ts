import type { Arguments, CommandBuilder } from "yargs";
import { cli } from 'cli-ux';

import { API, GET } from "../../lib/index.js";
import SaleorConfig from "../../lib/config.js"

type Options = {
  name: string;
};

export const command = "list";
export const desc = "List environments";

export const builder: CommandBuilder<Options, Options> = (_) => _

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  const config = new SaleorConfig();

  if (!config.token) {
    console.error("Missing saleor token: Please create token and run `saleor configure`");
    process.exit(1);
  }

  const result = await GET(API.Environment("cli-dev"), {
    headers: {
      Authorization: `Token ${config.token}`,
    },
  }) as any[];

  cli.table(result, {
    key: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2 }
  });

  process.exit(0);
};
