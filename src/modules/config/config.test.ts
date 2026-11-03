import { classifyError, validate } from "@saleor/configurator";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  fromAnswers,
  KINDS,
  REGIONS,
  type KindKey,
  type RegionKey,
} from "./blocks.ts";
import { applies, fileChanges, review, sentence } from "./describe.ts";
import type { Json } from "./document.ts";
import { meaningful } from "./engine.ts";
import { mergeConfig, NEW_STORE, orderLike } from "./merge.ts";

const THREE_PRODUCTS = /^3: Everyday Tee/;

const temp = () => mkdtempSync(path.join(os.tmpdir(), "saleor-config-test-"));

describe("building blocks", () => {
  const kinds: readonly KindKey[] = [
    "apparel",
    "digital",
    "electronics",
    "food",
    "general",
  ];

  const regions: readonly RegionKey[] = [
    "europe",
    "north-america",
    "uk",
    "us",
    "worldwide",
  ];

  const combinations = kinds.flatMap((kind) =>
    regions.flatMap((region) =>
      [true, false].map((samples) => ({ kind, region, samples }))
    )
  );

  it("covers every kind and region", () => {
    expect([...kinds].sort()).toStrictEqual(Object.keys(KINDS).sort());
    expect([...regions].sort()).toStrictEqual(Object.keys(REGIONS).sort());
  });

  it.each(combinations)(
    "$kind in $region (samples: $samples) passes the engine's checks",
    async (answers) => {
      const file = path.join(temp(), "config.yml");
      writeFileSync(
        file,
        stringify(mergeConfig(NEW_STORE, fromAnswers(answers)))
      );

      const problem = await validate(file).then(
        () => {},
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection is an I/O boundary; the callback narrows the error.
        (error: unknown) => classifyError(error).message
      );

      expect(problem).toBeUndefined();
    }
  );
});

describe("merging a draft onto a store", () => {
  it("replaces entries by slug or name, adds new ones and removes nothing", () => {
    const merged = mergeConfig(
      {
        categories: [{ name: "Default Category", slug: "default-category" }],
        channels: [{ name: "Default", slug: "default-channel" }],
        shop: { headerText: "a", limitQuantityPerCheckout: 50 },
      },
      {
        categories: [{ name: "Shoes", slug: "shoes" }],
        channels: [{ name: "Renamed", slug: "default-channel" }],
        shop: { headerText: "b" },
      }
    );

    expect(merged).toStrictEqual({
      categories: [
        { name: "Default Category", slug: "default-category" },
        { name: "Shoes", slug: "shoes" },
      ],
      channels: [{ name: "Renamed", slug: "default-channel" }],
      shop: { headerText: "b", limitQuantityPerCheckout: 50 },
    });
  });

  it("keeps the file's order of keys and entries after an edit", () => {
    const before = {
      categories: [
        { name: "A", slug: "a" },
        { name: "B", slug: "b" },
      ],
      shop: { displayGrossPrices: true, headerText: "x" },
    };

    const next = {
      categories: [
        { name: "C", slug: "c" },
        { name: "B", slug: "b" },
        { name: "A", slug: "a" },
      ],
      shop: { displayGrossPrices: true, headerText: "y" },
    };

    expect(stringify(orderLike(before, next))).toBe(
      stringify({
        categories: [
          { name: "A", slug: "a" },
          { name: "B", slug: "b" },
          { name: "C", slug: "c" },
        ],
        shop: { displayGrossPrices: true, headerText: "y" },
      })
    );
  });
});

describe("differences", () => {
  const update = (
    field: string,
    currentValue: Json | undefined,
    desiredValue: Json | undefined
  ) => ({
    changes: [{ currentValue, desiredValue, field }],
    entityName: "x",
    entityType: "Products",
    operation: "UPDATE" as const,
  });

  it("drops what is not a change: omitted fields, key order, fields Saleor fills in", () => {
    const summary = meaningful({
      creates: 0,
      deletes: 0,
      results: [
        update(
          "settings.allocationStrategy",
          "PRIORITIZE_SORTING_ORDER",
          undefined
        ),
        update(
          "variants.A.attributes",
          { Color: "Black", Size: "M" },
          { Color: "Black", Size: "M" }
        ),
        update(
          "channels.us",
          {
            channel: "us",
            isPublished: true,
            publishedAt: "2026-10-29T00:00:00Z",
          },
          { channel: "us", isPublished: true }
        ),
        update("attributes.Notes", undefined, "Jasmine"),
      ],
      totalChanges: 4,
      updates: 4,
    });

    expect(
      summary.results.map((result) => result.changes?.[0]?.field)
    ).toStrictEqual(["attributes.Notes"]);
    expect(summary.totalChanges).toBe(1);
  });

  it("plans only what a deploy does", () => {
    const change = (
      operation: "create" | "update" | "delete",
      entity: string,
      fields: string[] = []
    ) => ({ entity, fields, name: "n", operation });

    expect(applies(change("create", "Categories"))).toBe(true);
    expect(applies(change("delete", "Channels"))).toBe(false);
    expect(applies(change("update", "Categories", ["name"]))).toBe(false);
    expect(applies(change("update", "Categories", ["subcategories"]))).toBe(
      true
    );
    expect(applies(change("update", "Products", ["attributes.Size"]))).toBe(
      true
    );
    expect(
      sentence(change("update", "Channels", ["settings.a", "settings.b"]))
    ).toBe('Update channel "n" (settings)');
  });

  it("describes a configuration and an edit in words", () => {
    const config = mergeConfig(
      NEW_STORE,
      fromAnswers({ kind: "apparel", region: "north-america", samples: true })
    );

    expect(Object.fromEntries(review(config))).toMatchObject({
      Channels: "Default Channel (USD), United States (USD), Canada (CAD)",
      Products: expect.stringMatching(THREE_PRODUCTS),
    });
    expect(
      fileChanges(config, {
        ...config,
        collections: [{ name: "Winter", slug: "winter" }],
      })
    ).toStrictEqual([
      'Adds collection "Winter"',
      'Removes collection "Featured Products" from the file',
    ]);
  });
});
