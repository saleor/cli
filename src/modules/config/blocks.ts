// Building blocks for a first configuration, for people without a coding agent:
// a few questions pick a region and a kind of store, and the blocks add up to a
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

interface Market {
  // Saleor requires a state or province for some countries (US, CA).
  readonly area?: string;
  readonly city: string;
  readonly countries: readonly string[];
  readonly country: string;
  readonly currency: string;
  readonly express: number;
  readonly name: string;
  readonly postalCode: string;
  readonly slug: string;
  readonly standard: number;
  readonly street: string;
}

const MARKETS = {
  ca: {
    area: "ON",
    city: "Toronto",
    countries: ["CA"],
    country: "CA",
    currency: "CAD",
    express: 24.99,
    name: "Canada",
    postalCode: "M5V 2T6",
    slug: "ca",
    standard: 9.99,
    street: "200 Front Street West",
  },
  eu: {
    city: "Berlin",
    countries: ["DE", "AT", "FR", "NL", "BE", "IT", "ES", "PL"],
    country: "DE",
    currency: "EUR",
    express: 19.99,
    name: "Europe",
    postalCode: "10115",
    slug: "eu",
    standard: 7.99,
    street: "Invalidenstrasse 1",
  },
  uk: {
    city: "London",
    countries: ["GB"],
    country: "GB",
    currency: "GBP",
    express: 14.99,
    name: "United Kingdom",
    postalCode: "EC1A 1BB",
    slug: "uk",
    standard: 4.99,
    street: "1 St Martin's Le Grand",
  },
  us: {
    area: "CO",
    city: "Denver",
    countries: ["US"],
    country: "US",
    currency: "USD",
    express: 19.99,
    name: "United States",
    postalCode: "80202",
    slug: "us",
    standard: 6.99,
    street: "1600 Champa Street",
  },
} as const satisfies Record<string, Market>;

export type MarketKey = keyof typeof MARKETS;

export const REGIONS = {
  europe: { label: "Europe (EUR)", markets: ["eu"] },
  "north-america": {
    label: "United States and Canada",
    markets: ["us", "ca"],
  },
  uk: { label: "United Kingdom", markets: ["uk"] },
  us: { label: "United States", markets: ["us"] },
  worldwide: {
    label: "United States, Europe and the United Kingdom",
    markets: ["us", "eu", "uk"],
  },
} as const satisfies Record<
  string,
  { label: string; markets: readonly MarketKey[] }
>;

export type RegionKey = keyof typeof REGIONS;

const addressOf = (market: Market): Document => {
  const address = {
    city: market.city,
    country: market.country,
    postalCode: market.postalCode,
    streetAddress1: market.street,
  };

  return market.area === undefined
    ? address
    : { ...address, countryArea: market.area };
};

const marketFragment = (market: Market, shipping: boolean): Fragment => {
  const warehouse = `${market.slug}-warehouse`;
  const zone = `${market.name} shipping`;

  return {
    channels: [
      {
        currencyCode: market.currency,
        defaultCountry: market.country,
        isActive: true,
        name: market.name,
        slug: market.slug,
      },
    ],
    shippingZones: [
      {
        channels: [market.slug],
        countries: [...market.countries],
        name: zone,
        shippingMethods: shipping
          ? [
              {
                channelListings: [
                  { channel: market.slug, price: market.standard },
                ],
                maximumDeliveryDays: 5,
                minimumDeliveryDays: 2,
                name: "Standard",
                type: "PRICE",
              },
              {
                channelListings: [
                  { channel: market.slug, price: market.express },
                ],
                maximumDeliveryDays: 2,
                minimumDeliveryDays: 1,
                name: "Express",
                type: "PRICE",
              },
            ]
          : [
              {
                channelListings: [{ channel: market.slug, price: 0 }],
                name: "Instant delivery",
                type: "PRICE",
              },
            ],
        warehouses: [warehouse],
      },
    ],
    warehouses: [
      {
        address: addressOf(market),
        clickAndCollectOption: "DISABLED",
        isPrivate: false,
        name: `${market.name} warehouse`,
        shippingZones: [zone],
        slug: warehouse,
      },
    ],
  };
};

// ── Kinds of store: attributes, product types, categories, samples ───────

interface Sample {
  readonly attributes: Readonly<Record<string, string>>;
  readonly category: string;
  readonly description: string;
  readonly name: string;
  readonly price: number;
  readonly productType: string;
  readonly variants: ReadonlyArray<{
    readonly attributes: Readonly<Record<string, string>>;
    readonly name: string;
  }>;
}

interface Kind {
  readonly attributes: ReadonlyArray<{
    readonly name: string;
    readonly values: readonly string[];
  }>;
  readonly categories: ReadonlyArray<{
    readonly children?: readonly string[];
    readonly name: string;
  }>;
  readonly label: string;
  readonly samples: readonly Sample[];
  readonly shipping: boolean;
  readonly types: ReadonlyArray<{
    readonly name: string;
    readonly product: readonly string[];
    readonly variant: readonly string[];
  }>;
}

export const KINDS = {
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
} as const satisfies Record<string, Kind>;

export type KindKey = keyof typeof KINDS;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const kindFragment = (
  kind: Kind,
  channels: readonly string[],
  samples: boolean
): Fragment => {
  const products = samples
    ? kind.samples.map((sample) => ({
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
    categories: kind.categories.map((category) => {
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
        items: kind.categories.map((category) => ({
          category: slug(category.name),
          name: category.name,
        })),
        name: "navbar",
        slug: "navbar",
      },
    ],
    productAttributes: kind.attributes.map((attribute) => ({
      inputType: "DROPDOWN",
      name: attribute.name,
      values: attribute.values.map((value) => ({ name: value })),
    })),
    products,
    productTypes: kind.types.map((type) => ({
      isShippingRequired: kind.shipping,
      name: type.name,
      productAttributes: type.product.map((attribute) => ({ attribute })),
      variantAttributes: type.variant.map((attribute) => ({ attribute })),
    })),
  };
};

export interface Answers {
  readonly kind: KindKey;
  readonly region: RegionKey;
  readonly samples: boolean;
  readonly shopName?: string | undefined;
}

// The configuration the answers describe: only what they add, to be merged onto
// the store's own (see merge.ts).
export const fromAnswers = (answers: Answers): Document => {
  const kind = KINDS[answers.kind];

  const markets: readonly Market[] = REGIONS[answers.region].markets.map(
    (key) => MARKETS[key]
  );

  const parts = [
    ...markets.map((market) => marketFragment(market, kind.shipping)),
    kindFragment(
      kind,
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
