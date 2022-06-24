import { CliUx } from "@oclif/core";
import detectPort from "detect-port";
import EventEmitter from "events";
import got from "got";
import { nanoid } from "nanoid";
import { ServerApp } from "retes";
import { Response } from "retes/response";
import { GET } from "retes/route";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { delay } from "../../lib/util.js";
import { Options } from "../../types.js";

const { ux: cli } = CliUx;

export const command = "login";
export const desc = "Add integration for Saleor CLI";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const port = await detectPort(3000);
  const RedirectURI = `http://localhost:${port}/github/callback`;

  const generatedState = nanoid();
  const emitter = new EventEmitter();

  const { GithubClientID, GithubClientSecret } = await Config.get();

  const Params = {
    client_id: GithubClientID,
    redirect_uri: RedirectURI,
    scope: "repo",
  };

  const QueryParams = new URLSearchParams({ ...Params, state: generatedState });
  const url = `https://github.com/login/oauth/authorize?${QueryParams}`;
  cli.open(url);

  const app = new ServerApp([
    GET("/github/callback", async ({ params }) => {
      const { state, code } = params;

      if (state !== generatedState) {
        return Response.BadRequest("Wrong state");
      }

      const Params = {
        client_id: GithubClientID,
        client_secret: GithubClientSecret,
        code,
        redirect_uri: RedirectURI,
      };

      try {
        const data: any = await got
          .post("https://github.com/login/oauth/access_token", {
            form: Params,
          })
          .json();

        const { access_token } = data;

        await Config.set("github_token", `Bearer ${access_token}`);
      } catch (error: any) {
        console.log(error.message);
      }

      emitter.emit("finish");

      return Response.Redirect("https://cloud.saleor.io");
    }),
  ]);
  await app.start(port);

  emitter.on("finish", async () => {
    await delay(1000);
    await app.stop();
  });
};
