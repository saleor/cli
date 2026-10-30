// Derived from saleor/saleor-platform's Compose setup. Only the API, Dashboard and the
// mail inbox are published, on loopback; database/cache stay inside the instance's
// Docker network.
export const SALEOR_VERSION = "3.23.41";
export const DASHBOARD_VERSION = "3.23.0";
const MAILPIT_IMAGE = "axllent/mailpit:v1.27.8";

export interface LocalConfig {
  readonly apiPort: number;
  readonly dashboardPort: number;
  readonly initialized: boolean;
  // Absent in instances created before the mail inbox was published.
  readonly mailPort?: number | undefined;
  readonly name: string;
  readonly saleorVersion: string;
  readonly sampleData: boolean;
}

export const composeTemplate = (config: LocalConfig) => {
  const backend = {
    depends_on: {
      cache: { condition: "service_started" },
      db: { condition: "service_healthy" },
    },
    env_file: ["./backend.env"],
    image: `ghcr.io/saleor/saleor:${config.saleorVersion}`,
    volumes: ["media:/app/media"],
  };

  // The inbox is published only for instances that have a port for it.
  const mailpit =
    config.mailPort === undefined
      ? { image: MAILPIT_IMAGE }
      : {
          image: MAILPIT_IMAGE,
          ports: [`127.0.0.1:${config.mailPort}:8025`],
        };

  // JSON is a YAML subset and avoids maintaining a second serializer.
  return JSON.stringify(
    {
      services: {
        api: { ...backend, ports: [`127.0.0.1:${config.apiPort}:8000`] },
        cache: { image: "valkey/valkey:8.1.3-alpine" },
        dashboard: {
          environment: {
            API_URL: `http://localhost:${config.apiPort}/graphql/`,
          },
          image: `ghcr.io/saleor/saleor-dashboard:${DASHBOARD_VERSION}`,
          ports: [`127.0.0.1:${config.dashboardPort}:80`],
        },
        db: {
          environment: {
            POSTGRES_DB: "saleor",
            // oxlint-disable-next-line no-template-curly-in-string -- Docker Compose expands this from the private .env file.
            POSTGRES_PASSWORD: "${DATABASE_PASSWORD}",
            POSTGRES_USER: "saleor",
          },
          healthcheck: {
            interval: "2s",
            retries: 60,
            test: ["CMD-SHELL", "pg_isready -U saleor"],
            timeout: "5s",
          },
          image: "postgres:15.10-alpine",
          volumes: ["db:/var/lib/postgresql/data"],
        },
        mailpit,
        worker: {
          ...backend,
          command:
            "celery -A saleor --app=saleor.celeryconf:app worker --loglevel=info -B",
        },
      },
      volumes: { db: {}, media: {} },
    },
    null,
    2
  );
};
