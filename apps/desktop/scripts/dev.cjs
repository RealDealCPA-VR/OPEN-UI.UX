#!/usr/bin/env node
// Launches `electron-vite dev` with a scrubbed ELECTRON_RUN_AS_NODE.
//
// Why: parent processes (e.g. Claude Code's terminal) sometimes inherit
// ELECTRON_RUN_AS_NODE=1. Electron treats the variable as "set" whenever it is
// present and non-empty, so the child Electron process runs as plain Node —
// require('electron') returns a path string instead of the API, and modules
// like electron-store crash at startup. cross-env can't unset variables, so we
// do it here.

const { spawn } = require('node:child_process');
const path = require('node:path');

delete process.env.ELECTRON_RUN_AS_NODE;

const isWindows = process.platform === 'win32';
const bin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  isWindows ? 'electron-vite.cmd' : 'electron-vite',
);

// On Windows, .cmd files need a shell. `cmd /s /c "<full command line>"` needs
// outer quotes wrapping the entire payload when the inner command itself
// contains quoted args — otherwise cmd's quote-stripping eats the inner quotes
// and splits the path on whitespace. windowsVerbatimArguments avoids Node's
// own re-escaping.
const child = isWindows
  ? spawn('cmd.exe', ['/d', '/s', '/c', `""${bin}" dev"`], {
      stdio: 'inherit',
      env: process.env,
      windowsVerbatimArguments: true,
    })
  : spawn(bin, ['dev'], { stdio: 'inherit', env: process.env });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
