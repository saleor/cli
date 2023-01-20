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
  name?: string;
  saleorApiUrl?: string;
  appId?: string;
  permissions?: string[];
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
  template: string;
  branch?: string;
  example?: string;
}

export interface Deploy extends BaseOptions {
  dispatch: boolean;
  githubPrompt: boolean;
}

export interface StoreDeploy extends Deploy {
  withCheckout: boolean;
}

export interface AppTunnel extends BaseOptions {
  name: string;
  port: number;
  forceInstall: boolean;
  useNgrok: boolean;
  manifestPath: string;
}

export interface AppDeploy extends Deploy {
  registerUrl: string;
  encryptUrl: string;
  manifestPath: string;
}

export interface Open extends BaseOptions {
  resource?: string;
}

export interface WebhookDryRun extends BaseOptions {
  objectId?: string;
  query?: string;
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
  maintenance_mode: boolean;
  blocking_tasks_in_progress: boolean;
  disabled: boolean;
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

export type Job = {
  job_name: string;
  created_at: string;
  status: string;
  status_message: string | null;
  last_status_change: string;
  is_blocking: boolean;
};

export type WebhookError = {
  field: string;
  message: string;
};

export interface Organization {
  slug: string;
  name: string;
}

export interface User {
  email: string;
  first_name: string;
  last_name: string;
}
