import fs from "fs-extra";
import got from "got";
import path from "path";
import type { CommandBuilder } from "yargs";

import { MarketplaceAppSubmit } from "../../graphql/mutation/marketplaceAppSubmit.js";
import { Config } from "../../lib/config.js";

export const command = "publish";
export const desc = "Publish a Saleor App to the Saleor Marketplace";

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  const { github_token } = await Config.get();
  const { saleorApp: input } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
  );

  const { data, errors } = await got
    .post("https://saleor-graph.deno.dev", {
      headers: {
        Authorization: github_token,
      },
      json: {
        query: MarketplaceAppSubmit,
        variables: {
          input,
        },
      },
    })
    .json();

  console.log(data);
};
