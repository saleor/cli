
import type { Arguments, CommandBuilder } from "yargs";
import { cli } from "cli-ux";
import { HTTPError } from "got";

import { API, GET } from "../lib/index.js";
import SaleorConfig from "../lib/config.js"

type Options = {
  token?: string;
};

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false});

export const handler = async (argv: Arguments<Options>) => {
  let { token } = argv;
  while (!token) token = await cli.prompt("Access Token", { type: "mask" });

  try {
    const result = await GET(API.User, {
      headers: {
        Authorization: `Token ${token}`,
      },
    }) as any;

    console.log(`Success! ${result.email}`);

    const config = new SaleorConfig();
    config.setToken(token);
  } catch (error) {
    // FIXME make it more explicit
    if (error instanceof HTTPError) {
      console.log(error.message)
    } else {
      console.log(error)
    }
  }
};
