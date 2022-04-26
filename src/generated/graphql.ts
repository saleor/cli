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
export const GetWebhookAsyncEventEnum = gql`
    query GetWebhookAsyncEventEnum {
  __type(name: "WebhookEventTypeAsyncEnum") {
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
export const GetWebhookSyncEventEnum = gql`
    query GetWebhookSyncEventEnum {
  __type(name: "WebhookEventTypeSyncEnum") {
    enumValues {
      name
      description
    }
  }
}
    `;
export const ProductUpdate = gql`
    mutation ProductUpdate($id: ID!, $input: ProductInput!) {
  productUpdate(id: $id, input: $input) {
    product {
      name
    }
    errors {
      field
      code
      message
    }
  }
}
    `;