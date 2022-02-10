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
  const { name } = argv;
  const message = `Creating: ${name}!`;
  console.log(message);

  const config = new SaleorConfig();

  const result = await POST(API.Environment("cli-dev"), {
    prefixUrl: `https://staging-cloud.saleor.io/api`,
    headers: {
      Authorization: `Token ${config.token}`,
    },
    json: {
      "name": "From CLI 1",
      "domain_label": "from-ui",
      "admin_email": "jakub.neander@saleor.io",
      "login": "",
      "password": "",
      "project": "cli-test",
      "database_population": null,
      "service": "saleor-latest-staging"
    }
  }) as any;

  console.log(result)

  process.exit(0);
};
