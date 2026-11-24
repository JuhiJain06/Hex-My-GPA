/**
 * A `.css` import is the file's text: the extension's esbuild build uses the `text` loader for CSS.
 * (Vitest blanks CSS imports, so tests read tokens.css from disk instead.)
 */
declare module '*.css' {
  const text: string;
  export default text;
}
