// Normalise label text that MCP clients sometimes deliver with literal
// escape sequences.
//
// Why: Claude occasionally double-encodes a newline as the two characters
// `\n` (backslash + n) when it emits JSON inside a tool call — typically
// because the diagramming convention it was taught elsewhere (Mermaid,
// dot notation) uses a literal `\n`. Excalidraw renders whatever string
// we hand it verbatim, so the backslash-n ends up visible on the node
// label instead of producing a line break.
//
// We normalise at the MCP tool boundary so the scene store, emit
// pipeline, and query tools never have to double-check. A single pass is
// enough because a JSON-decoded input of `"\\n"` arrives here as two
// characters (`\` + `n`) — never as four.

/**
 * Convert any stray literal `\n` (two characters: backslash + n) inside
 * the input into a real `\n` newline. Real newlines pass through
 * untouched, so the helper is idempotent: `f(f(x)) === f(x)`.
 *
 * Scope is deliberately narrow. `\t` / `\r` show up rarely in diagram
 * labels; if the model starts producing them we can extend this helper
 * rather than sprinkling additional replacements at the call sites.
 */
export function sanitizeLabelText(text: string): string {
  return text.replace(/\\n/g, '\n');
}
