export const doWebhookUpdate = `
mutation doWebhookUpdate($id: ID!, $input: WebhookUpdateInput!) {
  webhookUpdate(id: $id, input: $input) {
    webhook {
      id
    }
  }
}
`;

// {
//   "input": {
//     "app": "QXBwOjI=",
//     "syncEvents": [
//       "PAYMENT_CAPTURE"
//     ],
//     "asyncEvents": [
//       "COLLECTION_CREATED",
//       "CHECKOUT_CREATED"
//     ],
//     "isActive": true,
//     "name": "Biuletyn",
//     "secretKey": "",
//     "targetUrl": "https://papier.com"
//   }
// }