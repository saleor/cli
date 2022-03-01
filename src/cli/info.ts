import type { Arguments, CommandBuilder } from "yargs";
import { createRequire } from "module";

import { header } from '../lib/images.js';

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
​
export const command = "info";
export const desc = "Hello from Saleor";

export const builder: CommandBuilder = (_) => _
export const handler = (argv: Arguments): void => {
   header(pkg.version)
};