/* eslint-disable import/prefer-default-export */
export const doWebhookDryRun = /* GraphQL */ `
  mutation doWebhookDryRun($objectId: ID!, $query: String!) {
    webhookDryRun(objectId: $objectId, query: $query) {
      payload
      errors {
        field
        message
      }
    }
  }
`;
