import path from "node:path";
import { Effect, Option } from "effect";
import { result } from "../../../core/command.ts";
import { projectSlugOf, requireEnvironment } from "../lookup.ts";
import {
  envFlag,
  linkFor,
  orgFlag,
  projectFlag,
  resolveScope,
  writeLink,
} from "../scope.ts";

export const cloudLinkFlags = {
  env: envFlag,
  org: orgFlag,
  project: projectFlag,
};

export const linkCloud = (flags: {
  org: Option.Option<string>;
  project: Option.Option<string>;
  env: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    // Only what is passed now is linked; the old link's selections are replaced.
    const { organization } = yield* resolveScope({ org: flags.org });
    const projectSlug = yield* projectSlugOf(organization, flags.project);

    const environment = Option.isSome(flags.env)
      ? yield* requireEnvironment(organization, flags.env.value, projectSlug)
      : undefined;

    const linked = linkFor(
      organization,
      projectSlug ?? environment?.project.slug,
      environment?.key
    );

    const file = yield* writeLink(linked);

    return result(
      { file, ...linked },
      `✓ This directory now uses ${[linked.organization, linked.project, environment?.name].filter(Boolean).join(" / ")}. Saved in ${path.relative(process.cwd(), file) || file}.`
    );
  });
