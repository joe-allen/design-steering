import { describe, expect, test, vi } from 'vitest';
import { handleCritiqueClick, renderCritique } from './render.js';

const toUrl = (path) => `asset://localhost/${encodeURIComponent(path)}`;
const render = (markdown) => renderCritique(markdown, { runDir: '/data/runs/home-design-critique', toUrl });
const dom = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
};

describe('renderCritique', () => {
  test('a normal run keeps headings, checklist items, resolved markers and its frame image', () => {
    const html = render(
      [
        '# Design critique',
        '',
        '<a href="./_frames/1-frame-a.png"><img src="./_frames/1-frame-a.png" alt="Frame 1" style="max-width: 400px;"></a>',
        '',
        '- [ ] **1**: Make this bigger [Resolved]',
      ].join('\n'),
    );
    const content = dom(html);
    expect(content.querySelector('h1').textContent).toBe('Design critique');
    expect(content.querySelector('li').textContent).toContain('Make this bigger [Resolved]');
    expect(content.querySelector('input[type=checkbox]')).toBeTruthy();
    const image = content.querySelector('img');
    expect(image.getAttribute('src')).toBe(toUrl('/data/runs/home-design-critique/_frames/1-frame-a.png'));
    expect(image.hasAttribute('style')).toBe(false);
    expect(content.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  test('each image paragraph and the comment list after it are grouped in a frame', () => {
    const content = dom(
      render(
        [
          '# Design critique',
          '[![Frame 1](./_frames/1-a.png)](https://www.figma.com/design/x)',
          '- [ ] **1**: First',
          '![Frame 2](./_frames/2-b.png)',
          '## General comments',
          '- [ ] **2**: Second',
        ].join('\n\n'),
      ),
    );
    const layout = [...content.children].map((el) =>
      el.className === 'frame' ? `frame(${[...el.children].map((child) => child.tagName).join('+')})` : el.tagName,
    );
    expect(layout).toEqual(['H1', 'frame(P+UL)', 'P', 'H2', 'UL']);
    expect(content.querySelector('.frame img').alt).toBe('Frame 1');
    expect(content.querySelector('.frame li').textContent).toContain('First');
  });

  test('script tags and event handlers are removed', () => {
    const html = render(
      [
        '- [ ] **1**: <script>window.__pwned = true</script>hello',
        '',
        '<img src="./_frames/1-a.png" onerror="window.__pwned = true">',
        '',
        '<div onclick="window.__pwned = true"><iframe src="https://evil.example"></iframe>text</div>',
        '',
        '<a href="javascript:alert(1)" onmouseover="alert(1)">click</a>',
      ].join('\n'),
    );
    expect(html).not.toMatch(/<script|onerror|onclick|onmouseover|<iframe|javascript:/i);
    expect(html).toContain('hello');
    expect(globalThis.__pwned).toBeUndefined();
  });

  test("images that are not the run's own frames are removed", () => {
    const html = render(
      [
        '![remote](https://evil.example/x.png)',
        '![scheme-relative](//evil.example/x.png)',
        '<img src="data:image/png;base64,AAAA">',
        '<img src="file:///etc/passwd">',
        '<img src="./_frames/../../secret.png">',
        '<img src="./_frames/ok.png">',
      ].join('\n\n'),
    );
    const sources = [...dom(html).querySelectorAll('img')].map((image) => image.getAttribute('src'));
    expect(sources).toEqual([toUrl('/data/runs/home-design-critique/_frames/ok.png')]);
  });

  test('only http(s) links keep their href', () => {
    const content = dom(render('[site](https://example.com) and [bad](javascript:alert(1)) and [rel](./other.md)'));
    const hrefs = [...content.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com', null, null]);
    expect(content.querySelector('a').getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('handleCritiqueClick', () => {
  const click = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const openExternal = vi.fn();
    host.addEventListener('click', (e) => handleCritiqueClick(e, openExternal));
    host.querySelector('[data-target]').dispatchEvent(event);
    host.remove();
    return { event, openExternal };
  };

  test('external links open in the system browser and never navigate', () => {
    const { event, openExternal } = click('<a href="https://example.com"><span data-target>go</span></a>');
    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  test('other links do nothing', () => {
    const { event, openExternal } = click('<a><img data-target></a>');
    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  test('clicks outside links are left alone', () => {
    const { event, openExternal } = click('<p data-target>text</p>');
    expect(event.defaultPrevented).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
