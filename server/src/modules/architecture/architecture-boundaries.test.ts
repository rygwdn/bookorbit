import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(fullPath);
      return [fullPath];
    }),
  );
  return files.flat();
}

describe('Architecture boundaries', () => {
  const modulesRoot = join(process.cwd(), 'src/modules');

  it('prevents controllers from importing repositories directly', async () => {
    const allowlist = ['src/modules/authors/authors.controller.ts', 'src/modules/book-metadata-fetch/book-metadata-fetch.controller.ts'].sort();

    const allFiles = await listFilesRecursive(modulesRoot);
    const controllerFiles = allFiles.filter((file) => file.endsWith('.controller.ts'));
    const violations: string[] = [];

    for (const filePath of controllerFiles) {
      const contents = await readFile(filePath, 'utf8');
      if (/from ['"].*\.repository['"]/.test(contents)) {
        violations.push(relative(process.cwd(), filePath));
      }
    }

    expect(violations.sort()).toEqual(allowlist);
  });
});
