import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('production D1 migrations', () => {
  it('contain every table created by the local auth schema bootstrap', () => {
    const authSource = readFileSync(join(projectRoot, 'src/server/auth.ts'), 'utf8');
    const migrationSource = readdirSync(join(projectRoot, 'migrations'))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort()
      .map((fileName) => readFileSync(join(projectRoot, 'migrations', fileName), 'utf8'))
      .join('\n');
    const runtimeTables = [...authSource.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g)]
      .map((match) => match[1] as string);
    const missingTables = [...new Set(runtimeTables)].filter((tableName) => {
      const escapedName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+${escapedName}\\b`, 'i')
        .test(migrationSource);
    });

    expect(missingTables).toEqual([]);
  });
});
