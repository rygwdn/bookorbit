import { extractTemplateKeys, substituteTemplate } from './workflow-template';

describe('workflow-template', () => {
  describe('extractTemplateKeys', () => {
    it('finds all placeholders across a multi-arg array and deduplicates them', () => {
      const args = ['--input', '{{input}}', '--output', '{{output}}', '--title', '{{title}} by {{authors}}', '{{input}}'];
      const keys = extractTemplateKeys(args);
      expect(keys).toEqual(['input', 'output', 'title', 'authors']);
    });

    it('returns an empty array when no placeholders are present', () => {
      const args = ['-v', '--help', 'clean'];
      expect(extractTemplateKeys(args)).toEqual([]);
    });

    it('finds multiple placeholders within a single argument string', () => {
      const args = ['{{workDir}}/{{bookId}}.{{format}}'];
      expect(extractTemplateKeys(args)).toEqual(['workDir', 'bookId', 'format']);
    });
  });

  describe('substituteTemplate', () => {
    it('replaces every {{key}} occurrence with its context value and leaves unrelated text untouched', () => {
      const args = [
        '--in',
        '{{input}}',
        '--out',
        '{{output}}',
        '--work-dir',
        '{{workDir}}',
        '--title',
        '{{title}}',
        '--meta',
        '{{title}} - {{authors}} [{{series}}]',
        '--literal',
        'unchanged-flag',
      ];
      const context = {
        input: '/tmp/step-0.epub',
        output: '/tmp/step-1.epub',
        workDir: '/tmp/work',
        title: 'Dune',
        authors: 'Frank Herbert',
        series: 'Dune Saga',
        format: 'epub',
        bookId: '42',
      };

      const result = substituteTemplate(args, context);
      expect(result).toEqual([
        '--in',
        '/tmp/step-0.epub',
        '--out',
        '/tmp/step-1.epub',
        '--work-dir',
        '/tmp/work',
        '--title',
        'Dune',
        '--meta',
        'Dune - Frank Herbert [Dune Saga]',
        '--literal',
        'unchanged-flag',
      ]);
    });

    it('leaves unknown placeholder keys untouched', () => {
      const args = ['--custom', '{{customPlaceholder}}', '--known', '{{title}}'];
      const result = substituteTemplate(args, { title: 'Dune' } as never);
      expect(result).toEqual(['--custom', '{{customPlaceholder}}', '--known', 'Dune']);
    });

    it('substitutes empty string when context value is empty', () => {
      const args = ['--series', '{{series}}'];
      const result = substituteTemplate(args, { series: '' } as never);
      expect(result).toEqual(['--series', '']);
    });
  });
});
