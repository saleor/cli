import boxen from "boxen";
import chalk from "chalk";
import { spawn } from "child_process";
import fs from "fs-extra";
import fetch from "node-fetch";
import ora from "ora";
import path from "path";
import replace from "replace-in-file";
import { fileURLToPath } from "url";
import { Arguments, CommandBuilder } from "yargs";

import {
  doSaleorAppDelete,
  doSaleorAppInstall,
  fetchSaleorAppList,
  verifyIfSaleorAppRunning,
  verifyIsSaleorAppDirectory,
} from "../../lib/common.js";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import {
  useEnvironment,
  useOrganization,
  useToken,
} from "../../middleware/index.js";
import { Options } from "../../types.js";

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

async function getKeypress() {
  return new Promise((resolve) => {
    const {stdin} = process;
    stdin.setRawMode(true); // so get each keypress
    stdin.resume(); // resume stdin in the parent process
    stdin.once("data", onData); // like on but removes listener also
    function onData(buffer: any) {
      stdin.setRawMode(false);
      resolve(buffer.toString());
    }
  });
}

export const command = "tunnel [port]";
export const desc = "Expose your Saleor app remotely via tunnel";

export const builder: CommandBuilder = (_) =>
  _.positional("port", { type: "number", default: 3000 }).option("name", {
    type: "string",
  });

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, "..", "..", "..", "vendor");

  let appName;
  if (argv.name) {
    appName = argv.name;
  } else {
    const content = await fs.readFile(
      path.join(process.cwd(), "package.json"),
      "utf-8"
    );
    appName = JSON.parse(content).name;
  }

  const { TunnelServerSecret } = await Config.get();

  const { organization, environment, port: localPort } = argv;

  const port = random(1025, 65535);

  const env = (await GET(API.Environment, argv)) as any;
  const baseURL = `https://${env.domain}`;

  const subdomain = `${appName}-${environment}-${organization}`.toLowerCase();
  const tunnelURL = `${subdomain}.saleor.live`;
  const winSuffix = process.platform === "win32" ? ".cmd" : "";

  try {
    await fetch(`https://id.saleor.live/add/${subdomain}/${port}`, {
      method: "POST",
    });

    const p = spawn(
      `${vendorDir}/tunnel${winSuffix}`,
      [
        "local",
        localPort || "3000",
        "--to",
        tunnelURL,
        "--port",
        port.toString(),
        "--secret",
        TunnelServerSecret,
      ],
      { cwd: process.cwd(), stdio: "ignore" }
    );

    p.on("exit", () => {
      console.log("Closing the tunnel...");
    });

    const saleorAppName = `    Saleor App Name: ${chalk.yellow(appName)}`;
    const saleorAppURLMessage = `     Saleor App URL: ${chalk.blue(
      `https://${tunnelURL}`
    )}`;
    const dashboaardMsg = `   Saleor Dashboard: ${chalk.blue(
      `${baseURL}/dashboard/`
    )}`;
    const gqlMsg = ` GraphQL Playground: ${chalk.blue(`${baseURL}/graphql/`)}`;

    console.log(
      boxen(
        `${saleorAppName}\n${saleorAppURLMessage}\n\n${dashboaardMsg}\n${gqlMsg}`,
        {
          padding: 1,
          margin: 1,
          borderColor: "yellow",
        }
      )
    );

    replace.sync({
      files: ".env",
      from: /APP_URL=.*/g,
      to: `APP_URL=https://${tunnelURL}`,
    });

    const _argv = argv;
    _argv.manifestURL = `https://${tunnelURL}/api/manifest`;
    _argv.appName = appName;

    const spinner = ora("Installing... \n").start();
    // TODO this should return App ID, now it returns an ID of a job installing the app
    await doSaleorAppInstall(_argv);
    spinner.succeed();

    // Find the App ID
    const {
      apps: { edges: apps },
    } = await fetchSaleorAppList(_argv);

    const byName =
      (name: string) =>
      ({ node }: any) =>
        name === node.name;
    const {
      node: { id: app },
    } = apps.filter(byName(appName)).shift();

    console.log(
      "Press CTRL-C to stop the tunnel and uninstall this Saleor App..."
    );
    while (1) {
      const key = await getKeypress();
      if (String(key) === "\u0003") {
        process.stdout.write(
          "Uninstalling the Saleor App from your Dashboard..."
        );
        _argv.app = app;

        await doSaleorAppDelete(_argv);
        p.kill("SIGINT");

        console.log(` ${chalk.green("success")}`);
        process.exit(0);
      }
    }
  } catch (error) {
    console.log("error");
    console.error(error);
  }
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  verifyIfSaleorAppRunning,
  useToken,
  useOrganization,
  useEnvironment,
];
