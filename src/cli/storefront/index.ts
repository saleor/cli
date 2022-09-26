import * as create from './create.js';
import * as deploy from './deploy.js';

export default function (_: any) {
  _.command([create, deploy]).demandCommand(
    1,
    'You need at least one command before moving on'
  );
}
