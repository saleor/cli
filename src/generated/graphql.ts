import { gql } from 'graphql-tag';

export const AppCreate = gql`
  mutation AppCreate($name: String, $permissions: [PermissionEnum!]) {
    appCreate(input: { name: $name, permissions: $permissions }) {
      app {
        id
        name
      }
      errors {
        field
        message
      }
    }
  }
`;
export const AppDelete = gql`
  mutation AppDelete($app: ID!) {
    appDelete(id: $app) {
      app {
        id
        name
      }
      errors {
        field
        message
      }
    }
  }
`;
export const AppInstall = gql`
  mutation AppInstall(
    $name: String!
    $manifestURL: String!
    $permissions: [PermissionEnum!]
  ) {
    appInstall(
      input: {
        appName: $name
        manifestUrl: $manifestURL
        permissions: $permissions
      }
    ) {
      appInstallation {
        id
        status
        appName
        manifestUrl
      }
      errors {
        field
        message
        code
        permissions
      }
    }
  }
`;
export const AppTokenCreate = gql`
  mutation AppTokenCreate($app: ID!) {
    appTokenCreate(input: { app: $app }) {
      authToken
      errors {
        field
        code
        message
      }
    }
  }
`;
export const AppUpdate = gql`
  mutation AppUpdate($app: ID!, $permissions: [PermissionEnum!]) {
    appUpdate(id: $app, input: { permissions: $permissions }) {
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
export const WebhookCreate = gql`
  mutation WebhookCreate($input: WebhookCreateInput!) {
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
export const WebhookDryRun = gql`
  mutation WebhookDryRun($objectId: ID!, $query: String!) {
    webhookDryRun(objectId: $objectId, query: $query) {
      payload
      errors {
        field
        message
      }
    }
  }
`;
export const WebhookUpdate = gql`
  mutation WebhookUpdate($id: ID!, $input: WebhookUpdateInput!) {
    webhookUpdate(id: $id, input: $input) {
      webhook {
        id
      }
      errors {
        field
        code
        message
      }
    }
  }
`;
export const GetAppById = gql`
  query GetAppByID($appID: ID!) {
    app(id: $appID) {
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
`;
export const GetApps = gql`
  query GetApps {
    apps(first: 100, sortBy: { field: CREATION_DATE, direction: DESC }) {
      totalCount
      edges {
        node {
          id
          name
          isActive
          type
          created
          webhooks {
            id
          }
          permissions {
            code
            name
          }
        }
      }
    }
  }
`;
export const AppsInstallations = gql`
  query AppsInstallations {
    appsInstallations {
      id
      manifestUrl
      appName
      message
      status
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
export const WebhookList = gql`
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
export const Introspection = gql`
  query Introspection {
    __schema {
      __typename
    }
  }
`;
