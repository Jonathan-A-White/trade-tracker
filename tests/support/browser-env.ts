// The environment Chromium is launched with: it may need libnspr4/libnss3/libasound2 from a local cache dir on a host with no sudo;
// where the dir is absent this is undefined, a no-op.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');

export const browserEnv: NodeJS.ProcessEnv | undefined = existsSync(extraLibDir)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : undefined;
