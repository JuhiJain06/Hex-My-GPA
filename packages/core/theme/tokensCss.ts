/// <reference path="./css.d.ts" />
import css from './tokens.css';

/** tokens.css for a shadow root: its `:root` blocks apply to the shadow host instead. */
export const toShadowCss = (tokensCss: string): string => tokensCss.replace(/:root\b/g, ':host');

/** The theme tokens for a shadow root (the YouTube card), bundled as text by the extension build. */
export const SHADOW_TOKENS_CSS: string = toShadowCss(css);
