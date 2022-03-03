
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
}

export interface CreatePromptResult {
  name: string
  value: string | number
}