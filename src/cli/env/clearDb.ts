import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";
import SaleorConfig from "../../lib/config.js";


export const command = "clear <key>";
export const desc = "Clear database for environment";

export const builder: CommandBuilder = (_) =>
  _.positional("key", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments) => {
  const config = new SaleorConfig();
  if (!config.token) {
    console.error("Missing saleor token: Please create token and run `saleor configure`");
    process.exit(1);
  }

  const { key } = argv;
  const message = `Clearing database: ${key}!`;
  console.log(message);

  const path = `${API.Environment("cli-dev", key as string)}/clear-database/`

  const result = await GET(path, {
    headers: {
      Authorization: `Token ${config.token}`,
    }
  }) as any;

  console.log(result)

  process.exit(0);
};
