export const WebhookList = /* GraphQL */ `
  query WebhookList {
    apps(first: 100) {
      totalCount
      edges {
        node {
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
    }
  }
`;
