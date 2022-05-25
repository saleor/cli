import stream from "stream";
import { promisify } from 'util';
import fs from 'fs-extra'
import got from 'got';
import tar from 'tar'

const pipeline = promisify(stream.pipeline);

export const downloadFromGitHub = async (repo: string, dest: string) => {
  const url = `https://github.com/${repo}/archive/master.tar.gz`
  const downloadStream = got.stream(url);
  const filePath = './master.tgz'
  const fileWriterStream = fs.createWriteStream(filePath, { mode: 0o755 });

  try {
    await pipeline(downloadStream, fileWriterStream);

    await fs.ensureDir(dest)
    await tar.x({ file: './master.tgz', cwd: dest, strip: 1 })
    await fs.remove(filePath)

  } catch (error) {
    console.error(`Something went wrong. ${error}`);
  }

  fs.remove('./master.tgz')
};