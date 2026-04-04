// ai_stress/helper_tool.js

import { console } from 'console';

const log = (message, level = 'info') => {
  const levels = {
    info: '\x1b[32m%s\x1b[0m',
    warn: '\x1b[33m%s\x1b[0m',
    error: '\x1b[31m%s\x1b[0m'
  };
  console[level].log(message, levels[level]);
};

const logError = (error) => {
  console.error(error);
};

export { log, logError };
