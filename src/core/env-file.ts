// Editing a project's dotenv file without taking it over: the CLI sets the keys it
// owns where they already are (or where the template has them commented out), leaves
// every other line as the person wrote it, and records which store the file points at
// in one header line, `# saleor: store=<ref>`. Files written before it was called a
// store say `instance=`, which is still read.

const HEADER = /^# saleor: (?:store|instance)=(\S+)/;
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const UNSAFE = /[\s#"'`$\\]/;
const TRAILING_COMMENT = /\s+#.*$/;
const TRAILING_NEWLINES = /\n*$/;

const keyLine = (key: string, commented: boolean) =>
  new RegExp(`^\\s*${commented ? "#\\s*" : ""}(?:export\\s+)?${key}\\s*=`);

const quote = (value: string) =>
  UNSAFE.test(value) ? JSON.stringify(value) : value;

const unquote = (raw: string) => {
  const value = raw.trim();
  const first = value.charAt(0);

  // A quoted value ends at its closing quote; a comment may follow.
  const closing = value.indexOf(first, 1);

  if ((first === '"' || first === "'") && closing > 0) {
    return value.slice(1, closing);
  }

  // An unquoted value ends where a comment starts.
  return value.replace(TRAILING_COMMENT, "");
};

// The values the file assigns; comments are not values.
export const parseEnv = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text.split("\n").flatMap((line) => {
      const match = ASSIGNMENT.exec(line);

      return match?.[1] === undefined
        ? []
        : [[match[1], unquote(match[2] ?? "")]];
    })
  );

// Whether the file mentions a key at all, assigned or commented out.
export const declares = (text: string, key: string) =>
  text
    .split("\n")
    .some(
      (line) => keyLine(key, false).test(line) || keyLine(key, true).test(line)
    );

// The store the file was connected to by the CLI, if any.
export const connectedRef = (text: string) =>
  text
    .split("\n")
    .map((line) => HEADER.exec(line)?.[1])
    .find((ref) => ref !== undefined);

export const setEnv = ({
  text,
  values,
  ref,
  note,
}: {
  readonly text: string;
  readonly values: Readonly<Record<string, string>>;
  readonly ref: string;
  readonly note: string;
}) => {
  const lines = text.split("\n").filter((line) => !HEADER.test(line));
  const appended: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${quote(value)}`;

    const active = lines.findIndex((candidate) =>
      keyLine(key, false).test(candidate)
    );

    const at =
      active === -1
        ? lines.findIndex((candidate) => keyLine(key, true).test(candidate))
        : active;

    if (at >= 0) {
      lines[at] = line;
    } else {
      appended.push(line);
    }
  }

  const body = lines.join("\n").replace(TRAILING_NEWLINES, "\n");

  return [
    `# saleor: store=${ref} (${note})`,
    `${body}${appended.join("\n")}${appended.length > 0 ? "\n" : ""}`,
  ].join("\n");
};
