import { Buffer } from 'node:buffer';
import { transform } from 'lightningcss';
import { compile } from 'svelte/compiler';
import { expect, test } from 'vitest';
import source from './LoadingLogo.svelte?raw';

// Vite minifies production CSS with Lightning CSS; dev and jsdom never do, so the break only shows in built apps.
test('the logo animation keeps its duration and repeats after production minification', () => {
  const { css } = compile(source, { filename: 'LoadingLogo.svelte', css: 'external' });
  const minified = transform({
    filename: 'LoadingLogo.css',
    code: Buffer.from(css.code),
    minify: true,
  }).code.toString();

  expect(minified).toMatch(/11\.2s/);
  expect(minified).toMatch(/infinite/);
});
