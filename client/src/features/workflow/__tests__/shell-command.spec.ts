import { describe, expect, it } from 'vitest'
import { formatShellCommand, parseShellCommand } from '../lib/shell-command'

describe('shell workflow command parser', () => {
  it('preserves quoted arguments and placeholders', () => {
    expect(parseShellCommand("convert --quality 80 '{{input}}' '{{output}}'")).toEqual({
      command: 'convert',
      args: ['--quality', '80', '{{input}}', '{{output}}'],
    })
  })

  it('supports escaped spaces and rejects unfinished syntax', () => {
    expect(parseShellCommand('tool file\\ name')).toEqual({ command: 'tool', args: ['file name'] })
    expect(() => parseShellCommand("tool 'unfinished")).toThrow('unfinished')
  })

  it('formats values that need shell quoting', () => {
    expect(formatShellCommand('tool', ['hello world', '{{input}}'])).toBe("tool 'hello world' '{{input}}'")
  })
})
