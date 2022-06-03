import type { CommandBuilder } from "yargs";
import fs from 'fs-extra';
import path from "path";
import got from "got";

import { marketplaceAppSubmit } from "../../graphql/mutation/marketplaceAppSubmit.js";

export const command = "publish";
export const desc = "Publish a Saleor App to the Saleor Marketplace";

export const builder: CommandBuilder = (_) => _
export const handler = async (): Promise<void> => {
  const { saleorApp: input } = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8'));

  const { data, errors }: any = await got.post(`https://saleor-graph.deno.dev`, {
    json: {
      query: marketplaceAppSubmit,
      variables: {
        input
      }
    }
  }).json()

  console.log(data, errors)
};

