export const AppInstall = /* GraphQL */ `
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
