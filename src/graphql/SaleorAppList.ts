export const SaleorAppList = /* GraphQL */ `
  query SaleorAppList {
    apps(first: 100, sortBy: { field: CREATION_DATE, direction: ASC }) {
      totalCount
      edges {
        node {
          id
          name
          isActive
          type
          created
          webhooks {
            id
          }
        }
        permissions {
          code
          name
        }
      }
    }
  }
`;
