export const marketplaceAppSubmit = /* GraphQL */`
mutation marketplaceAppSubmit($input: MarketplaceAppInput!) {
  marketplaceAppSubmit(input: $input) {
    status
    reviewURL
  }
}
`;