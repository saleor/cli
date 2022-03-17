export const doWebhookCreate = `
mutation doWebhookCreate($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
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