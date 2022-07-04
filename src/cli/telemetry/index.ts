import * as disable from './disable.js';
import * as enable from './enable.js';
import * as status from './status.js';

export default function (_: any) {
  _.command([disable, enable, status]).demandCommand(
    1,
    'You need at least one command before moving on'
  );
}
