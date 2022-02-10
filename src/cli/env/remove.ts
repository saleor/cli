import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import SaleorConfig from "../../lib/config.js";


export const command = "delete <key>";
export const desc = "Delete environmet";

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
  const message = `Deleting environment: ${key}!`;
  console.log(message);

  const result = await DELETE(API.Environment("cli-dev", key as string), {
    headers: {
      Authorization: `Token ${config.token}`,
    }
  }) as any;

  console.log(result)

  process.exit(0);
};
