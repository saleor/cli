import type { CommandBuilder } from "yargs";
import { Config } from "../lib/config.js";

export const command = "logout";
export const desc = "Log out from the Saleor Cloud";

export const builder: CommandBuilder = (_) => _;

export const handler = (): void => {
  Config.reset();
};
