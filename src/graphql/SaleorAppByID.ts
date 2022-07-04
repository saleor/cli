/* eslint-disable import/prefer-default-export */
export const SaleorAppByID = /* GraphQL */ `
  query AppSingle($appID: ID!) {
    app(id: $appID) {
      id
      name
      isActive
      type
      webhooks {
        id
        name
        isActive
        targetUrl
        syncEvents {
          eventType
        }
        asyncEvents {
          eventType
        }
      }
    }
  }
`;
