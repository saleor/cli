import Enquirer from 'enquirer';
import got from 'got';
import { simpleGit } from 'simple-git';

import { Config } from './config.js';

interface RepositoryContent {
  name: string;
  sha: string;
  path: string;
  git_url: string;
  url: string;
  html_url: string;
}

export const getRepositoryContent = async (repoPath: string) => {
  const { github_token: GitHubToken } = await Config.get();

  const data: RepositoryContent[] = await got
    .get(repoPath, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: GitHubToken,
      },
    })
    .json();

  return data;
};

export const getExampleSHA = async (example: string) => {
  const examples = await getRepositoryContent(
    'https://api.github.com/repos/saleor/app-examples/contents/examples',
  );
  const filtered = examples.filter((e) => e.name === example);

  if (filtered.length === 0) {
    const choices = examples.map((e) => ({
      name: e.sha,
      message: e.name.split('-').join(' '),
    }));

    const { sha } = await Enquirer.prompt<{ sha: string }>({
      type: 'select',
      name: 'sha',
      required: true,
      choices,
      message: 'Choose the app example',
    });

    return sha;
  }

  const { sha } = filtered[0];

  return sha;
};

export const setupGitRepository = async (): Promise<void> => {
  const git = simpleGit();
  await git.init(['--initial-branch', 'main']);
  await git.add('.');
  await git.commit('Initial commit from Saleor CLI');
};
