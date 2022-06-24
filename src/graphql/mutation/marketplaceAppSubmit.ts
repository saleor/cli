export const MarketplaceAppSubmit = `
mutation MarketplaceAppSubmit($input: MarketplaceAppInput!) {
  marketplaceAppSubmit(input: $input) {
    status
  }
}`;
