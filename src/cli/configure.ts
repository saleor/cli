
import type { Arguments, CommandBuilder } from "yargs";
import { prompt } from "cli-ux/lib/prompt.js";

import { API, GET } from "../lib/index.js";
import SaleorConfig from "../lib/config.js"

type Options = {
  token?: string;
};

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false});

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  let { token } = argv;
  while (!token) token = await prompt("Access Token", { type: "mask" });

  const result = await GET(API.User, {
    headers: {
      Authorization: `Token ${token}`,
    },
  }) as any;

  console.log(`Hello, ${result.email}`);

  const config = new SaleorConfig();
  config.setToken(token);

};
