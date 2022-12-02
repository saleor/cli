import * as docs from './docs.js';
import * as info from './info.js';
import * as prepare from './prepare.js';

export default function (_: any) {
  _.command([prepare, info, docs]).demandCommand(
    1,
    'You need at least one command before moving on'
  );
}
