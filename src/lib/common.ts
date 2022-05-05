import { spawn } from "child_process";
import Enquirer from "enquirer";
import got from "got";
import { AppInstall } from "../graphql/AppInstall.js";
import { Config } from "./config.js";
import { API, GET } from "./index.js";

export const doSaleorAppInstall = async (argv: any) => {
  const { domain } = await GET(API.Environment, argv) as any;
  const { token } = await Config.get();

  let form = {}
  if (!argv.manifestURL && !argv.appName) {
    const prompt = new (Enquirer as any).Form({
      name: 'saleorapp',
      message: 'Configure your Saleor App',
      choices: [
        { name: 'name', message: 'Name' },
        { name: 'manifestURL', message: 'Manifest URL' },
      ]
    });

    form = await prompt.run();
  } else {
    form = {
      manifestURL: argv.manifestURL,
      name: argv.appName
    }
  }

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    headers: {
      'Authorization-Bearer': token.split(' ').slice(-1),
    },
    json: {
      query: AppInstall,
      variables: form
    }
  }).json()

  if (errors || data.appInstall.errors.length > 0) {
    console.log(errors)
    console.log(data.errors)
    console.log(data.appInstall.errors)
    throw Error("cannot auth")
  }
}

export const run = async (cmd: string, params: string[], options: Record<string, unknown>, log = false) => {
  const winSuffix = process.platform === 'win32' ? '.cmd' : '';
  const child = spawn(`${cmd}${winSuffix}`, params, options)
  for await (const data of child.stdout || []) {
    if (log) {console.log(data)}
  }
  for await (const data of child.stderr || []) {
    console.error(data)
  }
}