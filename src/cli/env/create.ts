import type { Arguments, CommandBuilder } from "yargs";
import { API, GET, POST } from "../../lib/index.js";
import SaleorConfig from "../../lib/config.js";


export const command = "create <name>";
export const desc = "Create a new environmet";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new environment'
  });

export const handler = async (argv: Arguments) => {
  const config = new SaleorConfig();
  if (!config.token) {
    console.error("Missing saleor token: Please create token and run `saleor configure`");
    process.exit(1);
  }

  const { name } = argv;
  const r = (Math.random() + 1).toString(36).substring(7);
  const suffixed = `${name}-${r}`
  const message = `Creating: ${suffixed}!`;
  console.log(message);

  const result = await POST(API.Environment("cli-dev"), {
    headers: {
      Authorization: `Token ${config.token}`,
    },
    json: {
      "name": suffixed,
      "domain_label": suffixed,
      "admin_email": `${suffixed}@gmail.com`,
      "login": "",
      "password": "",
      "project": "cli-test",
      "database_population": "sample",
      "service": "saleor-latest-staging"
    }
  }) as any;

  console.log(result)

  process.exit(0);
};
