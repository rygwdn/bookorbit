export type ParsedShellCommand = { command: string; args: string[] }

export function parseShellCommand(input: string): ParsedShellCommand {
  const tokens: string[] = []
  let token = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  let started = false

  for (const char of input.trim()) {
    if (escaped) {
      token += char
      escaped = false
      started = true
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else token += char
      started = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
    } else {
      token += char
      started = true
    }
  }

  if (escaped || quote) throw new Error('Command contains an unfinished quote or escape')
  if (started) tokens.push(token)
  const [command = '', ...args] = tokens
  if (!command) throw new Error('Command is required')
  return { command, args }
}

export function formatShellCommand(command: string, args: string[]): string {
  return [command, ...args].map((value) => (/^[\w./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)).join(' ')
}
