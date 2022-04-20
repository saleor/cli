#!/usr/bin/env node

import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { exec as execRegular } from 'child_process';
import stream from "stream";
import got from "got";

import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const exec = promisify(execRegular);
const pipeline = promisify(stream.pipeline);

const SupportedArch = ['darwin-arm64', 'linux-x86']

async function install() {
  const target = `${process.platform}-${process.arch}`;

  if (! SupportedArch.includes(target)) {
    console.error(`${target} - this architecture is not supported`);
    return;
  }

  const binaryDir = path.join(__dirname, '..', '..', 'vendor');
  await fs.ensureDir(binaryDir);

  const url = `https://binary.saleor.live/tunnel-${process.platform}-${process.arch}`;

  const downloadStream = got.stream(url);
  const fileWriterStream = fs.createWriteStream(path.join(binaryDir, "tunnel"), { mode: 0o755 });

  // FIXME progress bar not working
  // const bar = new progress.SingleBar({}, progress.Presets.shades_classic);
  // bar.start(100, 0);
  // downloadStream.on("downloadProgress", ({ percent }) => {
  //   const percentage = Math.round(percent * 100);
  //   bar.update(percentage, { filename: 'asdf.js'})
  // });
  // bar.stop();

  try {
    await pipeline(downloadStream, fileWriterStream);
  } catch (error) {
    console.error(`Something went wrong. ${error}`);
  }

  const { stdout } = await exec('./vendor/tunnel --version')
  if (stdout.length > 0) {
    console.log('OK');
  }
}

async function uninstall() {
  //
}

const actions: Record<string, () => Promise<void>> = { install, uninstall };

const main = async () => {
  const argv = process.argv;
  if (argv.length > 2) {
    const cmd = process.argv[2];

    await actions[cmd]();
  }
}

main()