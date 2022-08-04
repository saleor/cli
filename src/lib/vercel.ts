import chalk from 'chalk';
import ora from 'ora';

import { delay } from './util.js';

interface Env {
  key: string;
  value: string;
  target?: string[];
  type?: string;
}

export interface Deployment {
  id: string;
  url: string;
  readyState: string;
  alias: string;
}

// eslint-disable-next-line import/prefer-default-export
export class Vercel {
  _client: any;

  constructor(accessToken: string, teamId: string | null | undefined = null) {
    this._client = async (
      method = 'GET',
      path = '',
      body: unknown = undefined
    ) => {
      const dest = `https://api.vercel.com${path}${
        teamId ? `?teamId=${teamId}` : ''
      }`;

      const r = await fetch(dest, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken,
        },
        body: JSON.stringify(body),
      });

      const result = await r.json();

      if (!r.status.toString().startsWith('2')) {
        const { error } = result;
        if (error) {
          throw new Error(error.message);
        }
      }

      return result;
    };
  }

  async addEnvironmentVariables(projectId: string, envs: Env[]) {
    return this._client(
      'POST',
      `/v8/projects/${projectId}/env`,
      envs.map((env) => ({ type: 'plain', target: ['production'], ...env }))
    );
  }

  async removeEnvironmentVariables(projectId: string, envs: Env[]) {
    const { envs: existingEnvs = [] }: any = await this._client(
      'GET',
      `/v9/projects/${projectId}/env`
    );

    for (const env of envs) {
      const byName = (key: string) => (el: any) => el.key === key;
      const envToRemove = existingEnvs.filter(byName(env.key)).shift();

      if (envToRemove) {
        await this._client(
          'DELETE',
          `/v9/projects/${projectId}/env/${envToRemove.id}`
        );
      }
    }
  }

  async setEnvironmentVariables(projectId: string, envs: Env[]) {
    await this.removeEnvironmentVariables(projectId, envs);
    await this.addEnvironmentVariables(projectId, envs);
  }

  async getProject(name: string) {
    return this._client('GET', `/v9/projects/${name}`);
  }

  async createProject(
    name: string,
    envs: Env[],
    owner: string,
    repoName: string,
    provider = 'github'
  ) {
    const {
      framework: { slug },
    } = await this.detectFramework(owner, repoName, provider);

    return this._client('POST', '/v9/projects', {
      name,
      environmentVariables: envs,
      gitRepository: {
        type: provider,
        repo: `${owner}/${repoName}`,
      },
      framework: slug || 'nextjs',
    });
  }

  async deploy(name: string, provider: string, repoId: string) {
    const response = await this._client('POST', '/v13/deployments', {
      gitSource: {
        type: provider,
        ref: 'main',
        repoId,
      },
      name,
      target: 'production',
      source: 'import',
    });

    return response;
  }

  async getDeployments(projectId: string) {
    return this._client('GET', `/v6/deployments?projectId=${projectId}`) as {
      deployments: Deployment[];
    };
  }

  async getDeployment(deploymentId: string) {
    return this._client(
      'GET',
      `/v13/deployments/${deploymentId}`
    ) as Deployment;
  }

  async verifyDeployment(
    name: string,
    deploymentId: string,
    msg = 'Deployment of'
  ) {
    const spinner = ora(`${msg} ${chalk.cyan(name)} in progress...`).start();

    let readyState;
    do {
      const deployment = await this.getDeployment(deploymentId);
      readyState = deployment.readyState;

      if (hasDeploymentFailed(readyState)) {
        console.log(`\nDeployment status: ${readyState}`);
        process.exit(1);
      }

      await delay(5000);
    } while (hasDeploymentSucceeded(readyState));

    spinner.succeed(`Deployed ${chalk.cyan(name)}\n`);
  }

  async detectFramework(owner: string, repoName: string, provider: string) {
    const URL = `https://${provider}.com/${owner}/${repoName}`;

    return this._client('GET', `/v1/integrations/detect-framework?url=${URL}`);
  }
}

const hasDeploymentSucceeded = (readyState: string) => readyState !== 'READY';
const hasDeploymentFailed = (readyState: string) =>
  ['ERROR', 'CANCELED'].includes(readyState);
