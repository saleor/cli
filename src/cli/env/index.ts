import { useOrganization, useToken } from '../../middleware/index.js';
import * as auth from './auth.js';
import * as cleardb from './clear.js';
import * as cors from './cors.js';
import * as create from './create.js';
import * as list from './list.js';
import * as maintenance from './maintenance.js';
import * as origins from './origins.js';
import * as populatedb from './populate.js';
import * as promote from './promote.js';
import * as remove from './remove.js';
import * as show from './show.js';
import * as change from './switch.js'; // `switch` is a JavaScript keyword
import * as update from './update.js';
import * as upgrade from './upgrade.js';

export default function (_: any) {
  _.command([
    auth,
    cleardb,
    cors,
    create,
    list,
    maintenance,
    origins,
    populatedb,
    promote,
    remove,
    show,
    change,
    update,
    upgrade,
  ])
    .middleware([useToken, useOrganization])
    .demandCommand(1, 'You need at least one command before moving on');
}
