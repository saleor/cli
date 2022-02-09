import type { Arguments, CommandBuilder } from "yargs";
import { getCurrentToken, API, GET } from "../../lib/index.js";

type Options = {
  name: string;
};

export const command = "list";
export const desc = "List environments";

export const builder: CommandBuilder<Options, Options> = (_) => _

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  const token = await getCurrentToken();

  const result = await GET(API.Environment("cli-dev"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }) as any[];

  for (let elem of result) {
    console.log(elem.key, '\t', elem.name, '\t', elem.created)
  }

  process.exit(0);
};
