import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type MigrationJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: MigrationJournalEntry[];
};

const migrationsDirUrl = new URL('./migrations/', import.meta.url);
const journalPath = fileURLToPath(new URL('./meta/_journal.json', migrationsDirUrl));

function readJournal(): MigrationJournal {
  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

describe('Drizzle migration journal', () => {
  it('keeps migration timestamps strictly increasing in journal order', () => {
    const journal = readJournal();

    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length);

    for (let i = 0; i < journal.entries.length; i += 1) {
      const entry = journal.entries[i];
      const previous = journal.entries[i - 1];

      expect(entry.idx).toBe(i);
      expect(Number.isSafeInteger(entry.when)).toBe(true);
      expect(entry.when).toBeGreaterThan(0);
      expect(existsSync(fileURLToPath(new URL(`./${entry.tag}.sql`, migrationsDirUrl)))).toBe(true);

      if (previous) {
        expect(entry.when, `${entry.tag} must have a later journal timestamp than ${previous.tag}`).toBeGreaterThan(previous.when);
      }
    }
  });
});
