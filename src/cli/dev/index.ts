import { useGithub } from '../../middleware/index.js';
import * as prepare from './prepare.js';

export default function (_: any) {
  _.command([prepare])
    .middleware([useGithub])
    .demandCommand(1, 'You need at least one command before moving on');
}
