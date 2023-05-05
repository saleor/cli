import Debug from 'debug';
import fs from 'fs-extra';
import GitURLParse from 'git-url-parse';
import { join } from 'path';
import { simpleGit } from 'simple-git';

import { WrongGitURLError } from './util.js';

const debug = Debug('saleor-cli:lib:download');

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

export const gitCopySHA = async (
  repo: string,
  dest: string,
  sha: string,
  ref = 'main'
) => {
  try {
    const { href: repoURL } = GitURLParse(repo);
    await git.clone(repoURL, dest, { '--branch': ref }).cwd({ path: dest });
    const target = join(process.cwd(), dest);
    await git.cwd({ path: target, root: true });
    await git.reset(['--hard', sha]);
    await fs.remove(`${dest}/.git`);
  } catch (error) {
    debug(`gitCopySHA err: ${error}`);
    throw new WrongGitURLError(`Provided Git URL is invalid: ${repo}`);
  }
};
