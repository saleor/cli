export const doWebhookCreate = /* GraphQL */`
mutation doWebhookCreate($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
    webhook {
      id
    }
  }
}
`;