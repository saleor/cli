import * as login from './login.js';

export default function (_: any) {
  _.command([login]).demandCommand(
    1,
    'You need at least one command before moving on'
  );
}
