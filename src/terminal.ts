import { createInterface, emitKeypressEvents, type Key } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { stripVTControlCharacters } from 'node:util';

type Tone = 'blue' | 'red' | 'text';
interface Header { version: string; subtitle: string; details?: string[] }

// Solid half blocks avoid the thin, separated dots of font-dependent Braille glyphs.
const coffee = [
  '             ▄▄█            ',
  '           ▄▀▀              ',
  '           █      ▄▄        ',
  '           ▀█▄   █          ',
  '             █▄ ▀█          ',
  '             █   █          ',
  '          ▄█▀   ▄▀          ',
  '         █                  ',
  '         ▀▀████             ',
  '   ▄█▀▀▀▀         ▀▀█▄      ',
  '   ▀▀██▄▄▄▄▄▄▄▄▄▄▄▄█▀▀▄▄▄▄▄ ',
  '     ██            ▄█     ██',
  '     ▀█            █▀    ▄▀ ',
  '      ▀█▄▄▄▄▄▄▄▄▄▄█▀ ▄█▀▀   ',
  '    ▄▄▄  ▀▀▀▀▀▀▀▀           ',
  ' ▄▀▀▀▀▀                 ▀█▄ ',
  ' ▀▀██▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄██▀▀▀  ',
  '       ▄▄▄▄▄▄▄▄▄▄▄▄▄▄█▀▀    ',
];

export function terminalOutput() {
  return Boolean(stdout.isTTY && process.env.TERM !== 'dumb' && !process.env.CI);
}

export function interactive() { return terminalOutput() && Boolean(stdin.isTTY); }

export function color(text: string, tone: Tone) {
  if (!terminalOutput() || 'NO_COLOR' in process.env) return text;
  const depth = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ? 24 : stdout.getColorDepth?.() ?? 4;
  const codes = {
    blue: depth >= 24 ? '38;2;59;158;255' : depth >= 8 ? '38;5;33' : '94',
    red: depth >= 24 ? '38;2;255;107;69' : depth >= 8 ? '38;5;203' : '91',
    text: '39',
  };
  // Normal intensity avoids profiles with a separate, unreadable bold foreground.
  return `\x1b[22;${codes[tone]}m${text}\x1b[0m`;
}

export function cleanText(text: string) {
  return stripVTControlCharacters(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
}

function cellWidth(character: string) {
  if (/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(character)) return 0;
  const point = character.codePointAt(0)!;
  // Count wide scripts/emoji conservatively; Block elements and the menu's symbols are single cells.
  return point >= 0x1100 && !(point >= 0x2000 && point < 0x3000) ? 2 : 1;
}

function clipped(text: string, width: number) {
  let result = '', used = 0;
  const cleaned = cleanText(text);
  for (const character of cleaned) {
    const size = cellWidth(character);
    if (used + size > width) {
      while (used >= width && result) {
        const last = [...result].at(-1)!;
        result = result.slice(0, -last.length);
        used -= cellWidth(last);
      }
      return result + '…';
    }
    result += character;
    used += size;
  }
  return result;
}

function lines(header: Header | undefined, body: { text: string; tone?: Tone }[] = [], compact = false) {
  const columns = Math.max(4, stdout.columns || 80);
  const heading = header ? [
    { text: `jpm  ${header.version}`, tone: 'text' as const },
    { text: header.subtitle, tone: 'text' as const },
    { text: '' },
    ...(header.details ?? []).map(text => ({ text })),
  ] : [];
  const content = [...heading, ...(heading.length && body.length ? [{ text: '' }] : []), ...body];
  const gap = body.length ? Math.max(1, coffee.length - heading.length - 4 - body.length) : 0;
  const framedHeight = heading.length + 4 + gap + body.length;
  const wide = header && !compact && columns >= 80 && (stdout.rows || 24) >= Math.max(coffee.length, framedHeight) + 2;
  if (!wide) return content.map(line => {
    const text = clipped(line.text, columns - 3);
    return '  ' + (line.tone ? color(text, line.tone) : text);
  });
  const width = (text: string) => [...cleanText(text)].reduce((total, character) => total + cellWidth(character), 0);
  const frameWidth = Math.min(columns - 36, 56, Math.max(38, ...heading.map(line => width(line.text) + 4)));
  const framed = (text: string) => {
    const inside = clipped(text, frameWidth - 4);
    return { text: `│ ${inside}${' '.repeat(frameWidth - 4 - width(inside))} │`, tone: 'text' as const };
  };
  const right: { text: string; tone?: Tone }[] = [
    { text: `╭${'─'.repeat(frameWidth - 2)}╮`, tone: 'text' as const },
    framed(''), ...heading.map(line => framed(line.text)), framed(''),
    { text: `╰${'─'.repeat(frameWidth - 2)}╯`, tone: 'text' as const },
    ...Array.from({ length: gap }, () => ({ text: '' })),
    ...body.map(line => ({ ...line, text: '  ' + clipped(line.text, columns - 38) })),
  ];
  return Array.from({ length: Math.max(coffee.length, right.length) }, (_, index) => {
    const art = coffee[index] ?? ' '.repeat(28);
    const painted = color(art, index < 9 ? 'red' : 'blue');
    const line = right[index];
    const text = line?.text ?? '';
    return `  ${painted}     ${line?.tone ? color(text, line.tone) : text}`;
  });
}

export function banner(version: string, subtitle: string, details: string[] = []) {
  if (terminalOutput()) stdout.write('\n' + lines({ version, subtitle, details }).join('\n') + '\n\n');
}

export class PromptCancelled extends Error {
  readonly exitCode: number;
  constructor(exitCode = 130) { super('Cancelled.'); this.name = 'PromptCancelled'; this.exitCode = exitCode; }
}

export async function choose(message: string, choices: { label: string; value: string }[], options: { initial?: number; header?: Header } = {}) {
  if (!interactive()) throw new Error('An interactive terminal is required. Use an explicit jpm command.');
  if (!choices.length) throw new Error('No choices are available.');
  let selected = Math.max(0, Math.min(choices.length - 1, options.initial ?? 0));
  let printed = 0, compact = false, settled = false;
  const wasRaw = Boolean(stdin.isRaw), wasFlowing = stdin.readableFlowing === true;
  let keypress: (text: string, key: Key) => void = () => {};
  let cancel = (exitCode = 130) => {};
  const interrupt = () => cancel(130), terminate = () => cancel(143), hangup = () => cancel(129);
  const render = () => {
    const budget = Math.max(1, (stdout.rows || 24) - 2);
    const header = budget < 10 ? undefined : options.header && {
      ...options.header, details: budget < 16 ? [] : options.header.details?.slice(0, budget - 10),
    };
    const capacity = Math.max(1, budget - 4 - (header ? 4 + (header.details?.length ?? 0) : 0));
    const start = Math.max(0, Math.min(selected - Math.floor(capacity / 2), choices.length - capacity));
    let body: { text: string; tone?: Tone }[] = [
      { text: message, tone: 'text' as const }, { text: '' },
      ...choices.slice(start, start + capacity).map((choice, index) => ({ text: `${start + index === selected ? '›' : ' '}  ${choice.label}`, tone: start + index === selected ? 'blue' as const : 'text' as const })),
      { text: '' }, { text: '↑↓ Move · Enter Select · Ctrl+C Exit', tone: 'text' as const },
    ];
    if (budget < 5) body = [
      ...(budget >= 2 ? [{ text: message }] : []),
      { text: `›  ${choices[selected].label}`, tone: 'blue' },
      ...(budget >= 3 ? [{ text: '↑↓ Move · Enter Select · Ctrl+C Exit', tone: 'text' as const }] : []),
    ];
    const output = lines(header, body, compact);
    if (printed) stdout.write(`\x1b[${printed}A\r\x1b[J`);
    stdout.write(output.join('\n') + '\n');
    printed = output.length;
  };
  const resize = () => {
    // A resized terminal may reflow old rows. Leave them in scrollback instead of erasing unrelated text.
    printed = 0; compact = true;
    stdout.write('\n'); render();
  };
  try {
    return await new Promise<string>((resolve, reject) => {
      cancel = (exitCode = 130) => { settled = true; reject(new PromptCancelled(exitCode)); };
      keypress = (_text, key) => {
        if (settled) return;
        if (key.name === 'escape' || (key.ctrl && ['c', 'd'].includes(key.name ?? ''))) { cancel(); return; }
        if (key.name === 'return' || key.name === 'enter') { settled = true; resolve(choices[selected].value); return; }
        if (key.name === 'up') selected = (selected + choices.length - 1) % choices.length;
        else if (key.name === 'down') selected = (selected + 1) % choices.length;
        else return;
        render();
      };
      emitKeypressEvents(stdin);
      stdin.on('keypress', keypress);
      stdin.once('end', interrupt);
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', terminate);
      process.once('SIGHUP', hangup);
      stdout.on('resize', resize);
      stdin.setRawMode(true);
      stdin.resume();
      stdout.write('\x1b[?25l');
      render();
    });
  } finally {
    stdin.removeListener('keypress', keypress);
    stdin.removeListener('end', interrupt);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGHUP', hangup);
    stdout.removeListener('resize', resize);
    stdin.setRawMode(wasRaw);
    if (!wasFlowing) stdin.pause();
    stdout.write('\x1b[?25h\n');
  }
}

export async function question(message: string, defaultValue: string, validate?: (value: string) => string | undefined) {
  if (!interactive()) throw new Error('An interactive terminal is required. Supply the missing command arguments.');
  const wasFlowing = stdin.readableFlowing === true, wasRaw = Boolean(stdin.isRaw);
  const prompt = createInterface({ input: stdin, output: stdout, terminal: true });
  let exitCode = 130;
  const interrupt = () => { exitCode = 130; prompt.emit('SIGINT'); };
  const terminate = () => { exitCode = 143; prompt.emit('SIGINT'); };
  const hangup = () => { exitCode = 129; prompt.emit('SIGINT'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  process.on('SIGHUP', hangup);
  try {
    for (;;) {
      const answer = await new Promise<string>((resolve, reject) => {
        const cancel = () => { cleanup(); reject(new PromptCancelled(exitCode)); };
        const cleanup = () => { prompt.removeListener('SIGINT', cancel); prompt.removeListener('close', cancel); };
        prompt.once('SIGINT', cancel);
        prompt.once('close', cancel);
        prompt.question(color(`  ? ${cleanText(message)} `, 'blue') + color(`(${cleanText(defaultValue)}): `, 'text'), value => { cleanup(); resolve(value); });
      });
      const value = answer.trim() || defaultValue;
      const error = validate?.(value);
      if (!error) return value;
      stdout.write(color(`  ${cleanText(error)}\n`, 'red'));
    }
  } catch (error) {
    if (error instanceof PromptCancelled) stdout.write('\n');
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGHUP', hangup);
    prompt.close();
    if (Boolean(stdin.isRaw) !== wasRaw) stdin.setRawMode(wasRaw);
    if (!wasFlowing) stdin.pause();
  }
}
