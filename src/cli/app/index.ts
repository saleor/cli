import * as create from './create.js';
import * as generate from './generate.js';
import * as install from './install.js';
import * as list from './list.js';
import * as permission from './permission.js';
import * as remove from './remove.js';
import * as template from './template.js';
import * as token from './token.js';
import * as tunnel from './tunnel.js';
import * as uninstall from './uninstall.js';

export default function (_: any) {
  _.command([
    list,
    install,
    uninstall,
    create,
    tunnel,
    token,
    permission,
    template,
    remove,

    // no auth needed
    generate,
  ])
    // .middleware([useToken, useOrganization, useEnvironment])
    .demandCommand(1, 'You need at least one command before moving on');
}
