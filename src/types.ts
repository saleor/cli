export interface BaseOptions {
  token?: string;
  organization?: string;
  environment?: string;
  instance?: string;
}

export interface Options extends BaseOptions {
  project?: string;
  backup?: string;
  region?: string;
  database?: string;
  saleor?: string;
  plan?: string;
  paymentMethod?: string;
  serviceName?: string;
  app?: string;
  email?: string;
  password?: string;
  csrfToken?: string;
  refreshToken?: string;
  webhookID?: string;
  task?: string;
  slug?: string;
  force?: boolean;
  key?: string;
  json?: boolean;
  event?: string;
  port?: string;
  name?: string;
  encryptUrl?: string;
  registerUrl?: string;
  saleorApiUrl?: string;
  githubPrompt?: boolean;
}

export interface CreatePromptResult {
  name: string;
  value: string | number;
}

export interface OrganizationCreate extends BaseOptions {
  name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  region?: string;
}
export interface ProjectCreate extends BaseOptions {
  name?: string;
  plan?: string;
  region?: string;
}

export interface StoreCreate extends BaseOptions {
  name: string;
  auto?: boolean;
  environment?: string;
  repository: string;
  branch?: string;
}

export interface StoreDeploy extends BaseOptions {
  withCheckout: boolean;
  githubPrompt?: boolean;
}

export interface Environment {
  name: string;
  key: string;
  domain: string;
  service: {
    region: string;
    url: string;
    name: string;
    display: string;
    version: string;
    service_type: string;
  };
}

export interface Task {
  task_id: string;
}

export type Config = {
  cloudApiUrl: string;
  amplifyConfig: any;
  captchaKey?: string | null;
};

export type ConfigMap = {
  [key: string]: Config;
};
