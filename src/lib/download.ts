import fs from 'fs-extra';
import got from 'got';
import { simpleGit } from 'simple-git';
import stream from 'stream';
import tar from 'tar';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);
const git = simpleGit();

export const gitCopy = async (repo: string, dest: string, ref = 'main') => {
  await git.clone(`https://github.com/${repo}`, dest, {
    '--branch': ref,
    '--depth': 1,
  });
  await fs.remove(`${dest}/.git`);
};

/* eslint-disable import/prefer-default-export */
export const downloadFromGitHub = async (
  repo: string,
  dest: string,
  source = 'master'
) => {
  const url = `https://github.com/${repo}/archive/${source}.tar.gz`;
  const downloadStream = got.stream(url);
  const filePath = `./${source}.tgz`;
  const fileWriterStream = fs.createWriteStream(filePath, { mode: 0o755 });

  try {
    await pipeline(downloadStream, fileWriterStream);

    await fs.ensureDir(dest);
    await tar.x({ file: filePath, cwd: dest, strip: 1 });
    await fs.remove(filePath);
  } catch (error) {
    console.error(`Something went wrong. ${error}`);
  }

  fs.remove(filePath);
};
