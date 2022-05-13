import gql from 'graphql-tag';

export const AppTokenCreate = gql`
    mutation AppTokenCreate($app: ID!) {
  appTokenCreate(input: {app: $app}) {
    authToken
  }
}
    `;
export const AppUpdate = gql`
    mutation appUpdate($app: ID!, $permissions: [PermissionEnum!]) {
  appUpdate(id: $app, input: {permissions: $permissions}) {
    app {
      id
    }
    errors {
      field
      message
    }
  }
}
    `;
export const GetPermissionEnum = gql`
    query GetPermissionEnum {
  __type(name: "PermissionEnum") {
    enumValues {
      name
      description
    }
  }
}
    `;
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