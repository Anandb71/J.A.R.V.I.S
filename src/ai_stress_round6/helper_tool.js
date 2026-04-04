// helper_tool.js

import { console } from 'console';

const log = (...args) => {
  console.log(...args);
};

const error = (...args) => {
  console.error(...args);
};

export { log, error };
