import assert from 'node:assert/strict';
import test from 'node:test';
import { stdin, stdout } from 'node:process';
import { stripVTControlCharacters } from 'node:util';
import { banner, choose, cleanText, color, interactive, PromptCancelled, terminalOutput } from '../dist/terminal.js';

function property(t, object, name, value) {
  const original = Object.getOwnPropertyDescriptor(object, name);
  Object.defineProperty(object, name, { configurable: true, writable: true, value });
  t.after(() => original ? Object.defineProperty(object, name, original) : delete object[name]);
}

function environment(t) {
  for (const key of ['CI', 'TERM', 'NO_COLOR', 'COLORTERM']) {
    const original = process.env[key];
    t.after(() => original === undefined ? delete process.env[key] : process.env[key] = original);
    delete process.env[key];
  }
  process.env.TERM = 'xterm-256color';
}

test('interactive UI requires both terminals and disables decoration in CI, dumb terminals, and pipes', t => {
  environment(t);
  property(t, stdout, 'isTTY', true);
  property(t, stdin, 'isTTY', true);
  assert.equal(interactive(), true);
  stdin.isTTY = false;
  assert.equal(interactive(), false);
  assert.equal(terminalOutput(), true);
  stdout.isTTY = false;
  assert.equal(terminalOutput(), false);
  assert.equal(color('hello', 'blue'), 'hello');
  stdout.isTTY = true;
  process.env.CI = 'true';
  assert.equal(terminalOutput(), false);
  delete process.env.CI;
  process.env.TERM = 'dumb';
  assert.equal(terminalOutput(), false);
  process.env.TERM = 'xterm-256color';
  process.env.COLORTERM = 'truecolor';
  assert.match(color('hello', 'blue'), /\x1b\[22;38;2;59;158;255mhello\x1b\[0m/);
  process.env.NO_COLOR = '';
  assert.equal(color('hello', 'blue'), 'hello');
});

test('text uses the normal theme foreground and accents support truecolor, 256 colors, and 16 colors', t => {
  environment(t);
  property(t, stdout, 'isTTY', true);
  let depth = 24;
  property(t, stdout, 'getColorDepth', () => depth);
  for (const value of [24, 8, 4]) {
    depth = value;
    assert.equal(color('Title and instructions', 'text'), '\x1b[22;39mTitle and instructions\x1b[0m');
  }
  depth = 24;
  assert.match(color('steam', 'red'), /22;38;2;255;107;69m/);
  depth = 8;
  assert.match(color('cup', 'blue'), /22;38;5;33m/);
  assert.match(color('steam', 'red'), /22;38;5;203m/);
  depth = 4;
  assert.match(color('cup', 'blue'), /22;94m/);
  assert.match(color('steam', 'red'), /22;91m/);
  process.env.NO_COLOR = '1';
  assert.equal(color('Title', 'text'), 'Title');
});

test('display metadata cannot inject terminal controls or extra rows', () => {
  const input = 'name\x1b[2J\x1b]0;changed title\x07\nline\r\t\x00\x85\u202etext';
  const result = cleanText(input);
  assert.equal(result, 'name line    text');
  assert.doesNotMatch(result, /[\x00-\x1f\x7f-\x9f\u202e]/);
});

test('a narrow banner stays within terminal columns and never displays control characters from metadata', t => {
  environment(t);
  property(t, stdout, 'isTTY', true);
  property(t, stdout, 'columns', 28);
  property(t, stdout, 'rows', 12);
  process.env.NO_COLOR = '1';
  const output = [];
  t.mock.method(stdout, 'write', value => { output.push(String(value)); return true; });
  banner('0.1.0-alpha.0', 'A familiar workflow for Java.', ['Project  ' + 'a'.repeat(100) + '\x1b[2J']);
  const result = output.join('');
  assert.ok(result.split('\n').every(line => line.length <= 27));
  assert.match(result, /…/);
  assert.doesNotMatch(result, /\x1b|[\u2800-\u28ff]/);
});

test('menu cancellation restores raw mode, cursor, and listeners', async t => {
  environment(t);
  property(t, stdout, 'isTTY', true);
  property(t, stdout, 'columns', 80);
  property(t, stdout, 'rows', 8);
  property(t, stdin, 'isTTY', true);
  property(t, stdin, 'isRaw', false);
  const raw = [], output = [];
  property(t, stdin, 'setRawMode', value => { raw.push(value); stdin.isRaw = value; return stdin; });
  t.mock.method(stdin, 'resume', () => stdin);
  t.mock.method(stdin, 'pause', () => stdin);
  t.mock.method(stdout, 'write', value => { output.push(String(value)); return true; });
  const keypress = stdin.listenerCount('keypress'), resize = stdout.listenerCount('resize'), interrupt = process.listenerCount('SIGINT');
  const pending = choose('Choose', [{ label: 'Create a project', value: 'create' }], {
    header: { version: '0.1.0-alpha.0', subtitle: 'A familiar workflow for Java.', details: ['Node 26', 'Project demo'] },
  });
  assert.ok(stripVTControlCharacters(output.join('')).trimEnd().split('\n').length <= 6);
  stdin.emit('keypress', '\x03', { name: 'c', ctrl: true });
  await assert.rejects(pending, PromptCancelled);
  assert.deepEqual(raw, [true, false]);
  assert.equal(stdin.listenerCount('keypress'), keypress);
  assert.equal(stdout.listenerCount('resize'), resize);
  assert.equal(process.listenerCount('SIGINT'), interrupt);
  assert.match(output.join(''), /\x1b\[\?25h/);
});
