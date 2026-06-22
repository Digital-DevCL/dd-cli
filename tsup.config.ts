import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'bin/dd-cli': 'src/bin/dd-cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: {
    entry: 'src/index.ts',
  },
  shims: false,
  banner: ({ format }) => {
    // Shebang solo en el binario
    return { js: '' };
  },
  esbuildOptions(options, { format }) {
    options.platform = 'node';
  },
  onSuccess: async () => {
    // Agregar shebang al binario después del build
    const fs = await import('node:fs');
    const path = 'dist/bin/dd-cli.js';
    const content = fs.readFileSync(path, 'utf-8');
    if (!content.startsWith('#!')) {
      fs.writeFileSync(path, `#!/usr/bin/env node\n${content}`);
      fs.chmodSync(path, 0o755);
    }
  },
});
