import { Command } from "effect/cli";

// Command groups: a word with actions under it and no behavior of its own.
export const defineGroup = <
  const Children extends readonly Command.Command.Any[],
>(spec: {
  readonly description: string;
  readonly name: string;
  readonly summary: string;
  readonly actions: Children;
}) =>
  Command.make(spec.name).pipe(
    Command.withDescription(spec.description),
    Command.withShortDescription(spec.summary),
    Command.withSubcommands(spec.actions)
  );
