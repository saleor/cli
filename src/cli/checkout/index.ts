import {
  useAppConfig,
  useGithub,
  useInstanceConnector,
  useVercel,
} from '../../middleware/index.js';
import * as deploy from './deploy.js';

export default function (_: any) {
  _.command([deploy])
    .middleware([useAppConfig, useVercel, useGithub, useInstanceConnector])
    .demandCommand(1, 'You need at least one command before moving on');
}
