#!/usr/bin/env node
import { entry } from '../src/cli.js';
await entry(['create', ...process.argv.slice(2)]);
