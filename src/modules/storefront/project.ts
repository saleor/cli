import { Option, Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { componentFolder, componentPath } from "../../core/components.ts";
import { configPath, type Project, projectAt } from "../../core/project.ts";
import { decodeYaml } from "../../core/yaml.ts";

// Where a project keeps its storefront, and which channel it shows.

export const storefrontPath = (project: Project) =>
  componentPath(project, "storefront");

// The storefront's folder: --dir, else the project's, else `standalone`.
export const storefrontFolder = (
  explicit: Option.Option<string>,
  standalone: string
) => componentFolder(explicit, "storefront", standalone);

const ChannelsSchema = Schema.Struct({
  channels: Schema.optional(
    Schema.Array(Schema.Struct({ slug: Schema.optional(Schema.String) }))
  ),
});

// The channel a storefront in this project should show: the configuration's first
// channel other than Saleor's default, when there is a configuration.
export const projectChannel = (root: string): Option.Option<string> =>
  Option.flatMap(projectAt(root), (project) => {
    const file = configPath(project);

    if (!existsSync(file)) {
      return Option.none();
    }

    return Option.flatMap(
      decodeYaml(ChannelsSchema, readFileSync(file, "utf-8")),
      (config) => {
        const slugs = (config.channels ?? []).flatMap((channel) =>
          channel.slug === undefined ? [] : [channel.slug]
        );

        return Option.fromUndefinedOr(
          slugs.find((slug) => slug !== "default-channel") ?? slugs[0]
        );
      }
    );
  });
