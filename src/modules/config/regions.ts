import type { Fragment } from "./blocks.ts";
import type { Document } from "./document.ts";

export interface Market {
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

export const MARKETS = {
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

export const marketFragment = (market: Market, shipping: boolean): Fragment => {
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

// ── Catalogs: attributes, product types, categories, samples ─────────────
