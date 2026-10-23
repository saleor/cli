import { Schema } from "effect";

// The CLI's wire contract, maintained from the requests it sends and responses it
// consumes. This is not a model of the server. Ignore unrelated response fields;
// validate outgoing requests strictly. Add fields only when a command needs them.
const OrganizationResponse = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
});

const UserWithOnboardingInfoResponse = Schema.Struct({
  email: Schema.String,
  first_name: Schema.NullOr(Schema.String),
  last_name: Schema.NullOr(Schema.String),
});

const PlanResponse = Schema.Struct({
  allowance: Schema.optionalKey(
    Schema.Struct({
      period: Schema.optionalKey(Schema.String),
      sandboxes: Schema.optionalKey(
        Schema.Struct({
          cap: Schema.optionalKey(Schema.NullOr(Schema.Int)),
          included: Schema.optionalKey(Schema.NullOr(Schema.Int)),
        })
      ),
    })
  ),
  name: Schema.String,
  pricing: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  slug: Schema.String,
  type: Schema.String,
});

export const ListProjectResponse = Schema.Struct({
  name: Schema.String,
  plan: PlanResponse,
  region: Schema.String,
  sandboxes: Schema.Struct({ count: Schema.optionalKey(Schema.Int) }),
  slug: Schema.String,
});

export type ListProjectResponse = typeof ListProjectResponse.Type;

const ProjectResponse = Schema.Struct({ slug: Schema.String });

const CreateProjectInput = Schema.Struct({
  name: Schema.String,
  plan: Schema.String,
  region: Schema.String,
});

const ServiceResponse = Schema.Struct({
  maintenance_mode: Schema.Boolean,
  name: Schema.String,
  region: Schema.String,
  service_type: Schema.String,
  version: Schema.String,
});

export const EnvironmentResponse = Schema.Struct({
  blocking_tasks_in_progress: Schema.Boolean,
  domain: Schema.String,
  domain_label: Schema.String,
  key: Schema.String,
  maintenance_mode: Schema.Boolean,
  name: Schema.String,
  project: Schema.Struct({ slug: Schema.String }),
  service: ServiceResponse,
});

export type EnvironmentResponse = typeof EnvironmentResponse.Type;

const ObtainEnvironmentInput = Schema.Struct({
  name: Schema.String,
  project: Schema.String,
  service: Schema.String,
});

const CreateEnvironmentInput = Schema.Struct({
  ...ObtainEnvironmentInput.fields,
  database_population: Schema.Null,
  domain_label: Schema.String,
});

const CreateEnvironmentResponse = Schema.Struct({
  key: Schema.String,
  task_id: Schema.NullOr(Schema.String),
});

const ObtainEnvironmentResponse = CreateEnvironmentResponse;

const TaskStatusResponse = Schema.Struct({
  status: Schema.String,
  status_message: Schema.NullOr(Schema.String),
});

const EnvironmentTaskListResponse = Schema.Struct({
  ...TaskStatusResponse.fields,
  job_name: Schema.String,
});

const RegionResponse = Schema.Struct({
  name: Schema.String,
  root_domain: Schema.String,
});

export const listOrganizations = {
  method: "GET",
  path: "/api/organizations/",
  pathParams: [],
  queryParams: [],
  request: undefined,
  response: Schema.Array(OrganizationResponse),
  successStatus: 200,
} as const;

export const retrieveOrganization = {
  method: "GET",
  path: "/api/organizations/{slug}/",
  pathParams: ["slug"],
  queryParams: [],
  request: undefined,
  response: OrganizationResponse,
  successStatus: 200,
} as const;

export const retrieveUserWithOnboardingInfo = {
  method: "GET",
  path: "/api/user/",
  pathParams: [],
  queryParams: [],
  request: undefined,
  response: UserWithOnboardingInfoResponse,
  successStatus: 200,
} as const;

export const listPlans = {
  method: "GET",
  path: "/api/plans/",
  pathParams: [],
  queryParams: [],
  request: undefined,
  response: Schema.Array(PlanResponse),
  successStatus: 200,
} as const;

export const listListProjects = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/projects/",
  pathParams: ["organization_slug"],
  queryParams: [],
  request: undefined,
  response: Schema.Array(ListProjectResponse),
  successStatus: 200,
} as const;

export const createCreateProject = {
  method: "POST",
  path: "/api/organizations/{organization_slug}/projects/",
  pathParams: ["organization_slug"],
  queryParams: [],
  request: CreateProjectInput,
  response: ProjectResponse,
  successStatus: 201,
} as const;

export const retrieveProject = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/projects/{slug}/",
  pathParams: ["organization_slug", "slug"],
  queryParams: [],
  request: undefined,
  response: ProjectResponse,
  successStatus: 200,
} as const;

export const destroyProject = {
  method: "DELETE",
  path: "/api/organizations/{organization_slug}/projects/{slug}/",
  pathParams: ["organization_slug", "slug"],
  queryParams: [],
  request: undefined,
  response: undefined,
  successStatus: 204,
} as const;

export const listEnvironments = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/environments/",
  pathParams: ["organization_slug"],
  queryParams: [],
  request: undefined,
  response: Schema.Array(EnvironmentResponse),
  successStatus: 200,
} as const;

export const createCreateEnvironment = {
  method: "POST",
  path: "/api/organizations/{organization_slug}/environments/",
  pathParams: ["organization_slug"],
  queryParams: [],
  request: CreateEnvironmentInput,
  response: CreateEnvironmentResponse,
  successStatus: 201,
} as const;

export const retrieveEnvironment = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/environments/{id}/",
  pathParams: ["organization_slug", "id"],
  queryParams: [],
  request: undefined,
  response: EnvironmentResponse,
  successStatus: 200,
} as const;

export const destroyEnvironmentTask = {
  method: "DELETE",
  path: "/api/organizations/{organization_slug}/environments/{id}/",
  pathParams: ["organization_slug", "id"],
  queryParams: [],
  request: undefined,
  response: undefined,
  successStatus: 202,
} as const;

export const listEnvironmentTaskLists = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/environments/{environment_pk}/tasks/",
  pathParams: ["organization_slug", "environment_pk"],
  queryParams: ["page", "page_size", "is_blocking", "status"],
  request: undefined,
  response: Schema.Struct({
    count: Schema.Int,
    next: Schema.optionalKey(Schema.NullOr(Schema.String)),
    previous: Schema.optionalKey(Schema.NullOr(Schema.String)),
    results: Schema.Array(EnvironmentTaskListResponse),
  }),
  successStatus: 200,
} as const;

export const listProjectServices = {
  method: "GET",
  path: "/api/organizations/{organization_slug}/projects/{project_slug}/services/",
  pathParams: ["organization_slug", "project_slug"],
  queryParams: ["compatible_with"],
  request: undefined,
  response: Schema.Array(ServiceResponse),
  successStatus: 200,
} as const;

export const listRegions = {
  method: "GET",
  path: "/api/regions/",
  pathParams: [],
  queryParams: [],
  request: undefined,
  response: Schema.Array(RegionResponse),
  successStatus: 200,
} as const;

export const retrieveTaskStatus = {
  method: "GET",
  path: "/api/service/task-status/{job_name}/",
  pathParams: ["job_name"],
  queryParams: [],
  request: undefined,
  response: TaskStatusResponse,
  successStatus: 200,
} as const;

export const obtainPreheatedEnvironmentObtainEnvironment = {
  method: "POST",
  path: "/api/organizations/{organization_slug}/environments/obtain/",
  pathParams: ["organization_slug"],
  queryParams: [],
  request: ObtainEnvironmentInput,
  response: ObtainEnvironmentResponse,
  successStatus: 201,
} as const;
