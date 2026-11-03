import {
  marketFragment,
  MARKETS,
  REGIONS,
  type Market,
  type RegionKey,
} from "./regions.ts";

// Building blocks for a first configuration, for people without a coding agent:
// a few questions pick a region and what the store sells (its catalog), and the blocks add up to a
// configuration the engine accepts (a test deploys every combination's checks). They
// replace Configurator's recipes, which no longer pass its own checks.

import type { Document } from "./document.ts";

type Entry = Document;

export interface Fragment {
  readonly categories?: readonly Entry[];
  readonly channels?: readonly Entry[];
  readonly collections?: readonly Entry[];
  readonly menus?: readonly Entry[];
  readonly productAttributes?: readonly Entry[];
  readonly products?: readonly Entry[];
  readonly productTypes?: readonly Entry[];
  readonly shippingZones?: readonly Entry[];
  readonly warehouses?: readonly Entry[];
}

// ── Regions: a channel, a warehouse and a shipping zone each ─────────────

interface Sample {
  readonly attributes: Readonly<Record<string, string>>;
  readonly category: string;
  readonly description: string;
  readonly name: string;
  readonly price: number;
  readonly productType: string;
  readonly variants: readonly {
    readonly attributes: Readonly<Record<string, string>>;
    readonly name: string;
  }[];
}

interface Catalog {
  readonly attributes: readonly {
    readonly name: string;
    readonly values: readonly string[];
  }[];
  readonly categories: readonly {
    readonly children?: readonly string[];
    readonly name: string;
  }[];
  readonly label: string;
  readonly samples: readonly Sample[];
  readonly shipping: boolean;
  readonly types: readonly {
    readonly name: string;
    readonly product: readonly string[];
    readonly variant: readonly string[];
  }[];
}

export const CATALOGS = {
  apparel: {
    attributes: [
      { name: "Brand", values: ["Northwind", "Summit"] },
      { name: "Material", values: ["Cotton", "Wool", "Recycled polyester"] },
      { name: "Size", values: ["XS", "S", "M", "L", "XL"] },
      { name: "Color", values: ["Black", "Navy", "Olive"] },
      { name: "Shoe size", values: ["38", "39", "40", "41", "42", "43", "44"] },
    ],
    categories: [
      { children: ["Tops", "Bottoms", "Outerwear"], name: "Clothing" },
      { name: "Footwear" },
      { name: "Accessories" },
    ],
    label: "Clothing and shoes",
    samples: [
      {
        attributes: { Brand: "Northwind", Material: "Cotton" },
        category: "Tops",
        description: "A heavyweight cotton tee that keeps its shape.",
        name: "Everyday Tee",
        price: 29,
        productType: "Apparel",
        variants: [
          { attributes: { Color: "Black", Size: "M" }, name: "Black / M" },
          { attributes: { Color: "Navy", Size: "L" }, name: "Navy / L" },
        ],
      },
      {
        attributes: { Brand: "Summit", Material: "Recycled polyester" },
        category: "Outerwear",
        description: "A packable shell for wind and rain.",
        name: "Trail Shell Jacket",
        price: 149,
        productType: "Apparel",
        variants: [
          { attributes: { Color: "Olive", Size: "M" }, name: "Olive / M" },
        ],
      },
      {
        attributes: { Brand: "Summit" },
        category: "Footwear",
        description: "Light hiking shoes with a grippy sole.",
        name: "Ridge Runner",
        price: 119,
        productType: "Footwear",
        variants: [
          { attributes: { "Shoe size": "42" }, name: "42" },
          { attributes: { "Shoe size": "43" }, name: "43" },
        ],
      },
    ],
    shipping: true,
    types: [
      {
        name: "Apparel",
        product: ["Brand", "Material"],
        variant: ["Size", "Color"],
      },
      { name: "Footwear", product: ["Brand"], variant: ["Shoe size"] },
    ],
  },
  digital: {
    attributes: [
      { name: "Format", values: ["PDF", "EPUB", "MP3"] },
      { name: "License", values: ["Personal", "Team"] },
    ],
    categories: [{ name: "Ebooks" }, { name: "Courses" }, { name: "Audio" }],
    label: "Digital products",
    samples: [
      {
        attributes: { Format: "PDF" },
        category: "Ebooks",
        description: "A practical guide, delivered as a download.",
        name: "Field Guide",
        price: 19,
        productType: "Digital product",
        variants: [
          { attributes: { License: "Personal" }, name: "Personal" },
          { attributes: { License: "Team" }, name: "Team" },
        ],
      },
    ],
    shipping: false,
    types: [
      { name: "Digital product", product: ["Format"], variant: ["License"] },
    ],
  },
  electronics: {
    attributes: [
      { name: "Brand", values: ["Voltline", "Arc"] },
      { name: "Warranty", values: ["1 year", "2 years"] },
      { name: "Color", values: ["Black", "Silver"] },
      { name: "Storage", values: ["128 GB", "256 GB", "512 GB"] },
    ],
    categories: [
      { children: ["Phones", "Laptops"], name: "Devices" },
      { name: "Audio" },
      { name: "Accessories" },
    ],
    label: "Electronics",
    samples: [
      {
        attributes: { Brand: "Voltline", Warranty: "2 years" },
        category: "Phones",
        description: "A compact phone with a long-lasting battery.",
        name: "Volt Mini",
        price: 499,
        productType: "Device",
        variants: [
          {
            attributes: { Color: "Black", Storage: "128 GB" },
            name: "Black / 128 GB",
          },
          {
            attributes: { Color: "Silver", Storage: "256 GB" },
            name: "Silver / 256 GB",
          },
        ],
      },
      {
        attributes: { Brand: "Arc" },
        category: "Audio",
        description: "Wireless earbuds with noise cancelling.",
        name: "Arc Buds",
        price: 129,
        productType: "Accessory",
        variants: [{ attributes: { Color: "Black" }, name: "Black" }],
      },
    ],
    shipping: true,
    types: [
      {
        name: "Device",
        product: ["Brand", "Warranty"],
        variant: ["Color", "Storage"],
      },
      { name: "Accessory", product: ["Brand"], variant: ["Color"] },
    ],
  },
  food: {
    attributes: [
      { name: "Diet", values: ["Vegan", "Gluten-free", "Organic"] },
      { name: "Origin", values: ["Colombia", "Ethiopia", "Italy"] },
      { name: "Pack size", values: ["250 g", "500 g", "1 kg"] },
    ],
    categories: [
      { children: ["Coffee", "Tea"], name: "Drinks" },
      { name: "Pantry" },
      { name: "Snacks" },
    ],
    label: "Food and drink",
    samples: [
      {
        attributes: { Diet: "Organic", Origin: "Ethiopia" },
        category: "Coffee",
        description: "Single-origin beans with notes of berries.",
        name: "Yirgacheffe Beans",
        price: 16,
        productType: "Grocery",
        variants: [
          { attributes: { "Pack size": "250 g" }, name: "250 g" },
          { attributes: { "Pack size": "1 kg" }, name: "1 kg" },
        ],
      },
      {
        attributes: { Diet: "Vegan", Origin: "Italy" },
        category: "Pantry",
        description: "Bronze-cut pasta from durum wheat.",
        name: "Rigatoni",
        price: 5,
        productType: "Grocery",
        variants: [{ attributes: { "Pack size": "500 g" }, name: "500 g" }],
      },
    ],
    shipping: true,
    types: [
      { name: "Grocery", product: ["Diet", "Origin"], variant: ["Pack size"] },
    ],
  },
  general: {
    attributes: [
      { name: "Brand", values: ["House brand"] },
      { name: "Option", values: ["Standard", "Large"] },
    ],
    categories: [{ name: "Featured" }, { name: "Everything else" }],
    label: "Something else",
    samples: [
      {
        attributes: { Brand: "House brand" },
        category: "Featured",
        description: "Our first product.",
        name: "Starter Product",
        price: 25,
        productType: "Product",
        variants: [
          { attributes: { Option: "Standard" }, name: "Standard" },
          { attributes: { Option: "Large" }, name: "Large" },
        ],
      },
    ],
    shipping: true,
    types: [{ name: "Product", product: ["Brand"], variant: ["Option"] }],
  },
} as const satisfies Record<string, Catalog>;

export type CatalogKey = keyof typeof CATALOGS;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

const catalogFragment = (
  catalog: Catalog,
  channels: readonly string[],
  samples: boolean
): Fragment => {
  const products = samples
    ? catalog.samples.map((sample) => ({
        attributes: { ...sample.attributes },
        category: slug(sample.category),
        channelListings: channels.map((channel) => ({
          channel,
          isAvailableForPurchase: true,
          isPublished: true,
          visibleInListings: true,
        })),
        description: sample.description,
        name: sample.name,
        productType: sample.productType,
        slug: slug(sample.name),
        variants: sample.variants.map((variant) => ({
          attributes: { ...variant.attributes },
          channelListings: channels.map((channel) => ({
            channel,
            price: sample.price,
          })),
          name: variant.name,
          sku: `${slug(sample.name)}-${slug(variant.name)}`.toUpperCase(),
        })),
      }))
    : [];

  return {
    categories: catalog.categories.map((category) => {
      const entry = { name: category.name, slug: slug(category.name) };

      return category.children === undefined
        ? entry
        : {
            ...entry,
            subcategories: category.children.map((child) => ({
              name: child,
              slug: slug(child),
            })),
          };
    }),
    collections: samples
      ? [
          {
            // The storefront template's home page shows this collection.
            channelListings: channels.map((channel) => ({
              channelSlug: channel,
              isPublished: true,
            })),
            name: "Featured Products",
            products: products.map((product) => product.slug),
            slug: "featured-products",
          },
        ]
      : [],
    menus: [
      {
        // The storefront template's navigation reads the "navbar" menu.
        items: catalog.categories.map((category) => ({
          category: slug(category.name),
          name: category.name,
        })),
        name: "navbar",
        slug: "navbar",
      },
    ],
    productAttributes: catalog.attributes.map((attribute) => ({
      inputType: "DROPDOWN",
      name: attribute.name,
      values: attribute.values.map((value) => ({ name: value })),
    })),
    products,
    productTypes: catalog.types.map((type) => ({
      isShippingRequired: catalog.shipping,
      name: type.name,
      productAttributes: type.product.map((attribute) => ({ attribute })),
      variantAttributes: type.variant.map((attribute) => ({ attribute })),
    })),
  };
};

export interface Answers {
  readonly catalog: CatalogKey;
  readonly region: RegionKey;
  readonly samples: boolean;
  readonly shopName?: string | undefined;
}

// The configuration the answers describe: only what they add, to be merged onto
// the store's own (see merge.ts).
export const fromAnswers = (answers: Answers): Document => {
  const catalog = CATALOGS[answers.catalog];

  const markets: readonly Market[] = REGIONS[answers.region].markets.map(
    (key) => MARKETS[key]
  );

  const parts = [
    ...markets.map((market) => marketFragment(market, catalog.shipping)),
    catalogFragment(
      catalog,
      markets.map((market) => market.slug),
      answers.samples
    ),
  ];

  const sections = [
    "channels",
    "warehouses",
    "shippingZones",
    "productAttributes",
    "productTypes",
    "categories",
    "collections",
    "products",
    "menus",
  ] as const;

  const config: Document = Object.fromEntries(
    sections.map((section) => [
      section,
      parts.flatMap((part) => part[section] ?? []),
    ])
  );

  return answers.shopName === undefined
    ? config
    : { ...config, shop: { headerText: answers.shopName } };
};

export { REGIONS, type RegionKey } from "./regions.ts";
