export const AppInstall = /* GraphQL */`
mutation AppInstall($name: String!, $manifestURL: String!) {
  appInstall(
    input: {
      appName: $name 
      manifestUrl: $manifestURL 
      permissions: [MANAGE_PRODUCTS]
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
`