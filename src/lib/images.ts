import chalk from "chalk";

const primaryColor = chalk.blue;
const secondaryColor = chalk.blue;

export const header = (version: string) => {
  console.log(`
                                               ${primaryColor(
                                                 "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
                                               )}
                                            ${primaryColor(
                                              "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░"
                                            )} 
                ${secondaryColor(
                  "▄█████████████████████████████████████████▀"
                )}${primaryColor("░░░░░░░░░░░░░░░░")}
             ${secondaryColor("▄███▀")}                 ${primaryColor(
    "░░░░░░░░░░░░░░░"
  )} ${secondaryColor("▄███▀")}${primaryColor("░░░░░░░░░░░░░░░")}
          ${secondaryColor("▄███▀")}                ${primaryColor(
    "░░░░░░░░░░░░░░░░░"
  )}${secondaryColor("▄███▀")}${primaryColor("░░░░░░░░░░░░░░")}
       ${secondaryColor("▄███▀")}               ${primaryColor(
    "░░░░░░░░░░░░░░░░░░"
  )}${secondaryColor("▄███▀")}${primaryColor("░░░░░░░░░░░░")}
    ${secondaryColor("▄███▀")}                                 ${secondaryColor(
    "▄███▀"
  )}
 ${secondaryColor(
   "▄█████████████████████████████████████████▀"
 )}         Saleor Commerce CLI v${version} 
`);
};
