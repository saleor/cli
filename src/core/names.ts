// Names the CLI makes from what people typed: folder, environment, component and
// store names.

const UNSAFE = /[^a-z0-9-]+/g;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(UNSAFE, "-")
    .replaceAll(/^-+|-+$/g, "") || "saleor";

// `wanted` as a slug, with a suffix (-2, -3, …) when it is taken.
export const freeName = (taken: Iterable<string>, wanted: string) => {
  const used = new Set(taken);
  const base = slugify(wanted);
  let name = base;

  for (let n = 2; used.has(name); n += 1) {
    name = `${base}-${n}`;
  }

  return name;
};
