import { resolve } from 'node:path';
import { initDeployEnv } from './scripts/deploy/env';
import type { Config } from '@ton/blueprint';

initDeployEnv(resolve(__dirname));

export const config: Config = {};
