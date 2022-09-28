import fs from 'fs-extra';
import got from 'got';
import stream from 'stream';
import tar from 'tar';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

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
