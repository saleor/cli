interface Env {
  key: string;
  value: string;
  target?: string[];
  type?: string;
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

      try {
        const r = await fetch(dest, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: accessToken,
          },
          body: JSON.stringify(body),
        });

        const result = await r.json();
        return result;
      } catch (error) {
        console.error(error);
        return null;
      }
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
    return this._client('POST', '/v9/projects', {
      name,
      environmentVariables: envs,
      gitRepository: {
        type: provider,
        repo: `${owner}/${repoName}`,
      },
      framework: 'nextjs',
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
    return this._client('GET', `/v6/deployments?projectId=${projectId}`);
  }
}
