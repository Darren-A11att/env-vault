/**
 * Read the full contents of a readable stream as UTF-8 and strip a single
 * trailing line terminator (`\r\n` or `\n`). Used by `envault set --stdin`
 * so secret values can be piped in without appearing on argv / shell history.
 */
export async function readStdinValue(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  let value = Buffer.concat(chunks).toString('utf8');
  if (value.endsWith('\r\n')) {
    value = value.slice(0, -2);
  } else if (value.endsWith('\n')) {
    value = value.slice(0, -1);
  }
  return value;
}

export async function setCmd(
  name: string,
  value: string | undefined,
  opts: { stdin?: boolean } = {},
): Promise<void> {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    console.error(`invalid secret name: ${name}. Use letters, digits, underscore; must not start with a digit.`);
    process.exit(1);
  }
  if (opts.stdin && value !== undefined) {
    console.error('pass either --stdin OR a value, not both');
    process.exit(1);
  }
  let resolvedValue: string;
  if (opts.stdin) {
    resolvedValue = await readStdinValue(process.stdin);
    if (resolvedValue === '') {
      console.error('stdin was empty; nothing to store');
      process.exit(1);
    }
  } else if (value === undefined) {
    console.error('missing value; pass a value or --stdin');
    process.exit(1);
    return;
  } else {
    resolvedValue = value;
  }
  const { Vault } = await import('../vault.js');
  const vault = Vault.open();
  try {
    const { pseudokey, created } = vault.set(name, resolvedValue);
    console.log(`${created ? 'added' : 'updated'}: ${name} → ${pseudokey}`);
  } finally {
    vault.close();
  }
}
