
export interface BaseOptions {
  token?: string
  organization?: string;
  environment?: string
}

export interface Options extends BaseOptions {
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
  task?: string
}

export interface CreatePromptResult {
  name: string
  value: string | number
}

export interface OrganizationCreate extends BaseOptions {
  name?: string
  company_name?: string
  email?: string
  phone?: string
  address_1?: string
  address_2?: string
  city?: string
  postal_code?: string
  country?: string
  region?: string

}