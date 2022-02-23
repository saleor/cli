import chalk from 'chalk'
import type { Arguments, CommandBuilder } from "yargs";
​
const primaryColor = chalk.blue;
const secondaryColor = chalk.blue;

export const command = "info";
export const desc = "Hello from Saleor";

export const builder: CommandBuilder = (_) => _
export const handler = (argv: Arguments): void => {

console.log(`
                                               ${primaryColor(`░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░`)}
                                            ${primaryColor(`░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░`)} 
                ${secondaryColor(`▄█████████████████████████████████████████▀`)}${primaryColor(`░░░░░░░░░░░░░░░░`)}
             ${secondaryColor(`▄███▀`)}                 ${primaryColor(`░░░░░░░░░░░░░░░`)} ${secondaryColor(`▄███▀`)}${primaryColor(`░░░░░░░░░░░░░░░`)}
          ${secondaryColor(`▄███▀`)}                ${primaryColor(`░░░░░░░░░░░░░░░░░`)}${secondaryColor(`▄███▀`)}${primaryColor(`░░░░░░░░░░░░░░`)}
       ${secondaryColor(`▄███▀`)}               ${primaryColor(`░░░░░░░░░░░░░░░░░░`)}${secondaryColor(`▄███▀`)}${primaryColor(`░░░░░░░░░░░░`)}
    ${secondaryColor(`▄███▀`)}                                 ${secondaryColor(`▄███▀`)}
 ${secondaryColor(`▄█████████████████████████████████████████▀`)}         Saleor Commerce CLI v. 0.6.6 
`);
};

​