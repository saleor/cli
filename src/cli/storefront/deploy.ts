import chalk from "chalk";
import GitUrlParse from "git-url-parse";
import path from "path";
import fs from "fs-extra";
import type { Arguments, CommandBuilder } from "yargs";
import { Options } from "../../types.js";
import {
  createProjectInVercel,
  getRepoUrl,
  triggerDeploymentInVercel,
} from "../app/deploy.js";
import { useVercel } from "../../middleware/index.js";

export const command = "deploy";
export const desc = "Deploy this `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8")
  );
  console.log(
    `\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      "package.json"
    )})`
  );

  const repoUrl = await getRepoUrl(name);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  console.log("\nDeploying to Vercel");
  // 2. Create a project in Vercel
  const projectId = await createProjectInVercel(name, owner, repoName);
  // 3. Deploy the project in Vercel
  await triggerDeploymentInVercel(name, owner, projectId);

  process.exit(0);
};

export const middlewares = [useVercel];
