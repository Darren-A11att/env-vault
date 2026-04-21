#!/usr/bin/env node
import { Command } from 'commander';
import { initCmd } from './commands/init.js';
import { setCmd } from './commands/set.js';
import { getCmd } from './commands/get.js';
import { listCmd } from './commands/list.js';
import { rmCmd } from './commands/rm.js';
import { importCmd } from './commands/import.js';
import { exportCmd } from './commands/export.js';
import { runCmd } from './commands/run.js';

const program = new Command();

program
  .name('envault')
  .description('OS-native SQLite secrets vault with SSH-key master.')
  .enablePositionalOptions()
  .version('0.1.0');

program
  .command('init')
  .description('Initialize the vault. Generates an Ed25519 key at ~/.ssh/envault_key and an empty vault db.')
  .option('--reuse <path>', 'Reuse an existing SSH private key instead of generating a new one')
  .option('--force', 'Overwrite existing key (WARNING: destroys access to existing secrets)')
  .action((opts) => {
    try {
      initCmd(opts);
    } catch (err) {
      console.error(`envault init: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('set <name> <value>')
  .description('Store or update a secret')
  .action((name: string, value: string) => {
    try {
      setCmd(name, value);
    } catch (err) {
      console.error(`envault set: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('get <name>')
  .description('Print a decrypted secret to stdout')
  .option('--pseudokey', 'Print the pseudokey instead of the value')
  .action(async (name: string, opts) => {
    try {
      await getCmd(name, opts);
    } catch (err) {
      console.error(`envault get: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List secret names and pseudokeys (values are never printed)')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    try {
      listCmd(opts);
    } catch (err) {
      console.error(`envault list: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('rm <name>')
  .alias('remove')
  .description('Remove a secret')
  .action((name: string) => {
    try {
      rmCmd(name);
    } catch (err) {
      console.error(`envault rm: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('import <envFile>')
  .description('Bulk-import secrets from a .env file')
  .option('--replace', 'Rewrite the source .env in place with pseudokeys (real values move to vault only)')
  .action((envFile: string, opts) => {
    try {
      importCmd(envFile, opts);
    } catch (err) {
      console.error(`envault import: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Escape hatch: dump decrypted secrets as a .env to stdout')
  .option('--to-env', 'Output as .env format (required flag; future formats may be added)')
  .action(async (opts) => {
    try {
      await exportCmd(opts);
    } catch (err) {
      console.error(`envault export: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Spawn a child process with pseudokeys resolved to real values in its env. Use -- to separate envault flags from the child command.')
  .option('--env-file <path>', 'Load additional .env file (defaults to ./.env if present)')
  .option('--no-load-env', 'Do not auto-load ./.env')
  .argument('<cmd...>', 'Command and arguments to spawn')
  .passThroughOptions(true)
  .action(async (argv: string[], opts) => {
    try {
      await runCmd(argv, opts);
    } catch (err) {
      console.error(`envault run: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`envault: ${(err as Error).message}`);
  process.exit(1);
});
