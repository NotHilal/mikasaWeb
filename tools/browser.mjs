// Finds a Chromium-based browser for the puppeteer scripts. Set CHROME to override.
import { existsSync } from 'node:fs';

const candidates = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
export const CHROME = candidates.find((p) => p && existsSync(p));
if (!CHROME) throw new Error('No Chrome/Edge found; set the CHROME env var to its path.');
