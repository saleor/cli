import { Arguments, CommandBuilder, demandCommand, demandOption } from "yargs";
import { API, POST } from "../../lib/index.js";
import slugify from 'slugify';

interface Options {
  name: string
  project: string
  saleor: string
  database: string
}

export const command = "create <name>";
export const desc = "Create a new environmet";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new environment'
  })
  .option("project", { 
    type: 'string',
    demandOption: true,
    desc: 'create this environment in this project',
  })
  .option("database", { 
    type: 'string',
    desc: 'specify how to populate the database',
    default: 'sample'
  })
  .option("saleor", { 
    type: 'string',
    desc: 'specify the Saleor version',
    default: '3.0.0'
  })

const hash = (name: string) => `${name}-${(Math.random() + 1).toString(36).substring(7)}`;

const SaleorVersionMapper: Record<string, string> = {
  '3.0.0': 'saleor-stable-staging',
  '3.1.0': 'saleor-latest-staging'
}

export const handler = async (argv: Arguments<Options>) => {
  const { name: base, project, saleor, database } = argv;

  const name = hash(base);
  const message = `Creating: ${name} in the '${project} project`;
  console.log(message);

  const result = await POST(API.Environment, {
    environment_id: '',
    json: {
      name,
      domain_label: slugify(name),
      admin_email: `${name}@gmail.com`,
      login: "",
      password: "",
      project,
      database_population: database,
      service: SaleorVersionMapper[saleor] 
    }
  }) as any;

  console.log(result)

  process.exit(0);
};
