/**
 * Helpers de output formateado con chalk.
 * Detecta TTY — sin colores en pipes / JSON.
 */
import chalk from 'chalk';

const isTTY = process.stdout.isTTY;

function strip(text: string): string {
  return text;
}

export const ok = (text: string): string => (isTTY ? chalk.green(text) : text);
export const warn = (text: string): string => (isTTY ? chalk.yellow(text) : text);
export const err = (text: string): string => (isTTY ? chalk.red(text) : text);
export const info = (text: string): string => (isTTY ? chalk.cyan(text) : text);
export const dim = (text: string): string => (isTTY ? chalk.gray(text) : text);
export const bold = (text: string): string => (isTTY ? chalk.bold(text) : text);
export const magenta = (text: string): string => (isTTY ? chalk.magenta(text) : text);
export const orange = (text: string): string => (isTTY ? chalk.hex('#ffa657')(text) : text);

/**
 * Imprime una línea con prefix de severidad.
 */
export function printOk(message: string): void {
  console.log(`${ok('✓')} ${message}`);
}

export function printWarn(message: string): void {
  console.log(`${warn('⚠')} ${message}`);
}

export function printErr(message: string): void {
  console.error(`${err('✗')} ${message}`);
}

export function printInfo(message: string): void {
  console.log(`${info('→')} ${message}`);
}

export function printDim(message: string): void {
  console.log(dim(message));
}

/**
 * Color del badge por dev_type — consistente con la APP y los mockups.
 */
export function devTypeBadge(devType: string | null): string {
  if (!devType) return dim('⬢ sin tipo');
  const colors: Record<string, (s: string) => string> = {
    'greenfield': (s) => (isTTY ? chalk.green(s) : s),
    'brownfield-feature': (s) => (isTTY ? chalk.cyan(s) : s),
    'brownfield-refactor': (s) => (isTTY ? chalk.hex('#ffa657')(s) : s),
    'modernizacion': (s) => (isTTY ? chalk.magenta(s) : s),
    'integracion-externa': (s) => (isTTY ? chalk.hex('#3fd5e0')(s) : s),
  };
  const colorFn = colors[devType] ?? ((s: string) => s);
  return colorFn(`⬢ ${devType}`);
}
