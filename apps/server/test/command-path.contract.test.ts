import { handle } from '../src/modules/command-path/index';
import { describeCommandPathContract } from './contracts/commandPath.contract';

/**
 * The laws any command path obeys, run against the one the server uses. The
 * cases that belong to this block alone (safe retries by name, the input log
 * played again, the reply's secrecy) are in `command-path.test.ts`.
 */
describeCommandPathContract('the command path block', handle);
