import type { Arguments, CommandBuilder } from "yargs";
import { CliUx } from "@oclif/core";
import { HTTPError } from "got";

import { API, GET } from "../lib/index.js";
import { Config } from "../lib/config.js";
import { Options } from "../types.js";
import Enquirer from "enquirer";
import _ from "chalk";
import { promptEnvironment, promptOrganization } from "../lib/util.js";

const { ux: cli } = CliUx;

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false });

export const handler = async (argv: Arguments<Options>) => {
  let { token } = argv;
  const legitToken = await configure(token)

  console.log(`
Saleor Telemetry is ${_.underline('completely anonymous and optional')} information about general usage. 
You may opt-out at any time (check 'saleor telemetry').
Learn more: ${_.gray('https://saleor.io/')}${_.blueBright('telemetry')}
  `)

  const { telemetry } = await Enquirer.prompt({
    type: 'confirm',
    name: 'telemetry',
    initial: 'yes',
    message: 'Are you OK with leaving telemetry enabled?'
  }) as { telemetry: boolean }

  if (!telemetry) {
    await Config.set('telemetry', 'false')
  }

  await chooseOrganization(legitToken)
};

const validateToken = async (token: string) => {
  const user = (await GET(API.User, { token })) as any;
  console.log(`${_.green('Success')}. Logged as ${user.email}\n`);
};

const chooseOrganization = async (token: string | undefined) => {
  const organizations = await GET(API.Organization, {token}) as any[]

  if (!!organizations.length) {
    const { orgSetup } = await Enquirer.prompt({
      type: 'confirm',
      name: 'orgSetup',
      initial: 'yes',
      message: 'Would you like to choose default Organization'
    }) as { orgSetup: boolean }

    if (orgSetup) {
      const organization = await promptOrganization({token});
      await Config.set("organization_slug", organization.value);

      await chooseEnv(token, organization.value)
    }
  }
}

const chooseEnv = async (token: string | undefined, organization_slug: string) => {
  const envs = await GET(API.Environment, {token, organization: organization_slug }) as any[]

  if (!!envs.length) {
    const { envSetup } = await Enquirer.prompt({
      type: 'confirm',
      name: 'envSetup',
      initial: 'yes',
      message: 'Would you like to choose default Environment'
    }) as { envSetup: boolean }

    if (envSetup) {
      const env = await promptEnvironment({token, organization: organization_slug});
      await Config.set("environment_id", env.value);
    }
  }
}

export const configure = async (token: string | undefined) => {
  while (!token) token = await cli.prompt("Access Token", { type: "mask" });

  try {
    await validateToken(token);
    Config.reset();
    await Config.set("token", token);
    return token
  } catch (error) {
    // FIXME make it more explicit
    if (error instanceof HTTPError) {
      console.log(error.message);
    } else {
      console.log(error);
    }
  }
}