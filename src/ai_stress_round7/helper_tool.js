// helper_tool.js

/**
 * @module Jarvis.AiStressRound7.HelperTool
 */

import { console } from 'console';

const log = (message) => {
  console.log(message);
};

export const getNow = () => new Date().toISOString();

export const getDuration = (start, end) => {
  return (end - start) / 1000;
};
