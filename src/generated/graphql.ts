import gql from 'graphql-tag';

export const GetWebhookEventEnum = gql`
    query GetWebhookEventEnum {
  __type(name: "WebhookEventTypeEnum") {
    enumValues {
      name
      description
    }
  }
}
    `;