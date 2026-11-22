#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('jpm: Node.js 22 or newer is required.');
  process.exit(1);
}
const { entry } = await import('../dist/cli.js');
await entry(['create', ...process.argv.slice(2)]);
