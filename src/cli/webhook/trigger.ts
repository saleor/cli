import got from "got";
import type { Arguments, CommandBuilder } from "yargs";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import { Options } from "../../types.js";

export const command = "trigger <name> [id]";
export const desc = "This triggers a Saleor event";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { type: "string", demandOption: true })
   .positional("id", { type: "string" });

export const handler = async (argv: Arguments<Options>) => {
  const { name, id } = argv;
  const greeting = `Hello, ${name} - ${id}!`;

  const { domain } = await GET(API.Environment, argv) as any;
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    headers,
    json: {
      query: '',
      variables: {
      }
    }
  }).json()

  process.stdout.write(greeting);
  process.exit(0);
};



`
mutation ProductUpdate {
  productUpdate(id: "UHJvZHVjdDo3Mg==", input: {}) {
    product {
      name
    }
    errors {
      field
      code
      message
    }
  }
}
`