import { stringify } from "yaml";
import { fromAnswers } from "./blocks.ts";

const EXAMPLE = stringify(
  fromAnswers({ kind: "apparel", region: "us", samples: true })
);

export const GUIDE = `# Writing a Saleor configuration (config.yml)

A config.yml describes a Saleor store's structure for Saleor Configurator: channels,
warehouses, shipping, attributes, product types, categories, collections, products
and menus. The CLI checks it with \`saleor config validate\` and applies it with
\`saleor config deploy\`. Deploys create and update; they never delete.

## Rules the checks enforce

- Attributes are defined once, in \`productAttributes\`, and referenced from product
  types as \`- attribute: <Name>\` under \`productAttributes\` or \`variantAttributes\`.
  Never define attributes inline inside a product type.
- Attribute \`inputType\` is one of DROPDOWN, MULTISELECT, PLAIN_TEXT, RICH_TEXT,
  NUMERIC, BOOLEAN, DATE, SWATCH. DROPDOWN, MULTISELECT and SWATCH list \`values\`.
- An attribute is either a product attribute or a variant attribute of a type, not
  both. Variant attributes are what customers choose between (size, color).
- Channels: \`name\`, \`slug\`, \`currencyCode\` (ISO 4217), \`defaultCountry\`
  (ISO 3166 alpha-2), \`isActive\`.
- Warehouses: \`name\`, \`slug\`, \`address\` with \`streetAddress1\`, \`city\`,
  \`postalCode\`, \`country\`, and \`countryArea\` (state or province code) for
  countries that need one, such as US (e.g. CO) and CA (e.g. ON); \`shippingZones\`
  lists zone names.
- Shipping zones: \`name\`, \`countries\`, \`warehouses\` (slugs), \`channels\`
  (slugs), \`shippingMethods\` with \`name\`, \`type: PRICE\` and \`channelListings\`
  of \`{ channel, price }\`.
- Categories: \`name\`, \`slug\`, optional \`subcategories\` of the same shape.
- Products: \`name\`, \`slug\`, \`productType\` (a type's name), \`category\` (a
  category slug), \`attributes\` (attribute name → one of its values),
  \`channelListings\`, and \`variants\` with a unique \`sku\`, variant
  \`attributes\` and \`channelListings\` of \`{ channel, price }\`.
- Collections: \`name\`, \`slug\`, \`products\` (slugs), \`channelListings\` of
  \`{ channelSlug, isPublished }\`.
- Menus: items are \`{ name, category: <slug> }\` or \`{ name, collection: <slug> }\`.
- Everything referenced (slugs, names) must be defined in the file, or be a default
  every new store has: channel \`default-channel\`, category \`default-category\`.
- The Saleor storefront template shows the \`featured-products\` collection on its
  home page and the \`navbar\` menu as its navigation.

## Example

\`\`\`yaml
${EXAMPLE}\`\`\`
`;
