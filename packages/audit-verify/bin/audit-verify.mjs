#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`fatal: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
