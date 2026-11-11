#!/usr/bin/env node
import { entry } from '../src/cli.js';
await entry(process.argv.slice(2));
