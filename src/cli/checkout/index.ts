import {
  useEnvironment,
  useGithub,
  useOrganization,
  useToken,
  useVercel,
} from '../../middleware/index.js';
import * as deploy from './deploy.js';

export default function (_: any) {
  _.command([deploy])
    .middleware([
      useVercel,
      useGithub,
      useToken,
      useOrganization,
      useEnvironment,
    ])
    .demandCommand(1, 'You need at least one command before moving on');
}
