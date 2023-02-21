import fs from 'fs-extra';
import GitURLParse from 'git-url-parse';
import { join } from 'path';
import { simpleGit } from 'simple-git';

import { WrongGitURLError } from './util.js';

const git = simpleGit();

/* eslint-disable import/prefer-default-export */
export const gitCopy = async (repo: string, dest: string, ref = 'main') => {
  try {
    const { href: repoURL } = GitURLParse(repo);
    await git.clone(repoURL, dest, { '--branch': ref, '--depth': 1 });
    await fs.remove(`${dest}/.git`);
  } catch (error) {
    throw new WrongGitURLError(`Provided Git URL is invalid: ${repo}`);
  }
};

export const gitCopySHA = async (repo: string, dest: string, sha: string) => {
  try {
    const { href: repoURL } = GitURLParse(repo);
    await git.clone(repoURL, dest).cwd({ path: dest });
    const target = join(process.cwd(), dest);
    await git.cwd({ path: target, root: true });
    await git.reset(['--hard', sha]);
    await fs.remove(`${dest}/.git`);
  } catch (error) {
    throw new WrongGitURLError(`Provided Git URL is invalid: ${repo}`);
  }
};
