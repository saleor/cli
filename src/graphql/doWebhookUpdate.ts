/* eslint-disable import/prefer-default-export */
export const doWebhookUpdate = /* GraphQL */ `
  mutation doWebhookUpdate($id: ID!, $input: WebhookUpdateInput!) {
    webhookUpdate(id: $id, input: $input) {
      webhook {
        id
      }
    }
  }
`;
