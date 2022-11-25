/* eslint-disable import/prefer-default-export */
export const doWebhookCreate = /* GraphQL */ `
  mutation doWebhookCreate($input: WebhookCreateInput!) {
    webhookCreate(input: $input) {
      webhook {
        id
      }
      errors {
        field
        message
      }
    }
  }
`;
