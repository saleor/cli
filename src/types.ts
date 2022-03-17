
export interface Options {
  token?: string
  organization?: string;
  environment?: string
  project?: string
  backup?: string
  region?: string
  database?: string
  saleor?: string
  plan?: string
  paymentMethod?: string
  serviceName?: string
  app?: string
  email?: string
  password?: string
  csrfToken?: string
  refreshToken?: string
  webhookID?: string
}

export interface CreatePromptResult {
  name: string
  value: string | number
}