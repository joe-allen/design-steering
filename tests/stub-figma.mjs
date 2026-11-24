// Preloaded with `node --import` to replace the Figma API with canned responses.
const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const leaf = { id: '3:3', absoluteBoundingBox: { x: 5, y: 5, width: 10, height: 10 } };
const frame = {
  id: '2:2',
  name: 'Frame A',
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
  children: [{ id: '3:0', children: [{ id: '3:1', children: [{ id: '3:2', children: [leaf] }] }] }],
};
const pages = [
  { id: '1:1', name: 'Checkout', children: [frame] },
  { id: '5:1', name: 'Other page', children: [{ id: '5:2', name: 'Other frame', children: [{ id: '5:3' }] }] },
];
const partialFrame = {
  ...frame,
  children: [
    {
      id: '6:0',
      name: 'Group',
      children: [
        {
          id: '6:5',
          name: 'Group',
          children: [
            {
              id: '6:1',
              name: 'Shared name',
              absoluteBoundingBox: { x: 1, y: 1, width: 10, height: 10 },
              children: [{ id: '6:3', name: 'Good pin', absoluteBoundingBox: { x: 3, y: 3, width: 10, height: 10 } }],
            },
            {
              id: '6:2',
              name: 'Shared name',
              absoluteBoundingBox: { x: 2, y: 2, width: 10, height: 10 },
              children: [
                { id: '6:4', name: 'Unreadable child', absoluteBoundingBox: { x: 4, y: 4, width: 10, height: 10 } },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const partialPages = [{ ...pages[0], children: [partialFrame] }, pages[1]];
const budgetFrame = {
  ...frame,
  children: [
    {
      id: '7:parent',
      name: 'Group',
      children: [
        {
          id: '7:group',
          name: 'Group',
          children: Array.from({ length: 80 }, (_, i) => ({
            id: `7:${i}`,
            name: 'Repeated layer',
            absoluteBoundingBox: { x: i, y: i, width: 10, height: 10 },
            children: [
              { id: `7:leaf-${i}`, name: 'Pin layer', absoluteBoundingBox: { x: i, y: i, width: 10, height: 10 } },
            ],
          })),
        },
      ],
    },
  ],
};
const budgetPages = [{ ...pages[0], children: [budgetFrame] }, pages[1]];
function truncate({ children, ...node }, depth) {
  return depth && children ? { ...node, children: children.map((child) => truncate(child, depth - 1)) } : node;
}
let lookupAttempts = 0;
globalThis.fetch = async (input) => {
  const url = new URL(input);
  const [, , , key, endpoint] = url.pathname.split('/');
  const nested = key === 'LARGE' || key === 'DOWN';
  const currentPages =
    key === 'PARTIAL' || key === 'EMPTY_PARTIAL' ? partialPages : key === 'BUDGET' ? budgetPages : pages;
  if (!endpoint) {
    if (key === 'PAGEFAIL')
      return new Response('page unavailable', { status: 500, headers: { 'retry-after': '0.001' } });
    if (url.search !== '?depth=1') return new Response('file outline or pin lookup too large', { status: 500 });
    return json({ document: { id: '0:0', children: currentPages.map((page) => truncate(page, 0)) } });
  }
  if (endpoint === 'nodes') {
    const ids = url.searchParams.get('ids').split(',');
    const depth = Number(url.searchParams.get('depth'));
    if (!depth || depth > 3) return new Response('subtree too large', { status: 500 });
    if (nested && ids.includes(frame.id) && (++lookupAttempts === 1 || key === 'DOWN')) {
      return new Response('server error', { status: 500 });
    }
    if (
      ['PARTIAL', 'EMPTY_PARTIAL'].includes(key) &&
      ((ids.includes('6:1') && ids.includes('6:2')) || ids.includes('6:2'))
    ) {
      return new Response('server error', { status: 500, headers: { 'retry-after': '0.001' } });
    }
    if (key === 'BUDGET' && ids.some((id) => id.startsWith('7:') && /^\d+$/.test(id.slice(2)))) {
      return new Response('server error', { status: 500, headers: { 'retry-after': '0.001' } });
    }
    const nodes = {};
    function visit(node) {
      if (ids.includes(node.id)) nodes[node.id] = { document: truncate(node, depth) };
      for (const child of node.children ?? []) visit(child);
    }
    currentPages.forEach(visit);
    return json({ nodes });
  }
  if (endpoint === 'comments') {
    if (key === 'DENIED') return new Response('forbidden', { status: 403 });
    if (key === 'RATE') return new Response('slow down', { status: 429, headers: { 'retry-after': '0.001' } });
    if (key === 'COMMENTSFAIL') {
      return new Response('comments unavailable', { status: 500, headers: { 'retry-after': '0.001' } });
    }
    return json({
      comments:
        key === 'EMPTY_PARTIAL'
          ? [
              {
                id: 'unconfirmed',
                order_id: '3',
                message: 'This pin is inside the unreadable branch',
                created_at: '2026-01-01T00:03:00Z',
                user: { handle: 'ada' },
                client_meta: { node_id: '6:4', node_offset: { x: 4, y: 4 } },
              },
            ]
          : key === 'PARTIAL'
            ? [
                {
                  id: 'c1',
                  order_id: '1',
                  message: 'Keep the ancestor pin',
                  created_at: '2026-01-01T00:00:00Z',
                  user: { handle: 'ada' },
                  client_meta: { node_id: '2:2', node_offset: { x: 10, y: 10 } },
                },
                {
                  id: 'c1-reply',
                  parent_id: 'c1',
                  message: 'Keep its reply once',
                  created_at: '2026-01-01T00:01:00Z',
                  user: { handle: 'grace' },
                },
                {
                  id: 'c2',
                  order_id: '2',
                  message: 'Readable sibling pin',
                  created_at: '2026-01-01T00:02:00Z',
                  user: { handle: 'ada' },
                  client_meta: { node_id: '6:3', node_offset: { x: 3, y: 3 } },
                },
              ]
            : key === 'BUDGET'
              ? [
                  {
                    id: 'c1',
                    order_id: '1',
                    message: 'Keep the ancestor pin',
                    created_at: '2026-01-01T00:00:00Z',
                    user: { handle: 'ada' },
                    client_meta: { node_id: '2:2', node_offset: { x: 10, y: 10 } },
                  },
                  {
                    id: 'c2',
                    order_id: '2',
                    message: 'Unconfirmed branch pin',
                    created_at: '2026-01-01T00:02:00Z',
                    user: { handle: 'ada' },
                    client_meta: { node_id: '7:leaf-0', node_offset: { x: 3, y: 3 } },
                  },
                ]
              : [
                  {
                    id: 'c1',
                    order_id: '1',
                    message: 'Make this bigger',
                    created_at: '2026-01-01T00:00:00Z',
                    user: { handle: 'ada' },
                    reactions: [{ emoji: ':white_check_mark:', user: { handle: 'grace' } }],
                    client_meta: { node_id: nested ? '3:3' : '2:2', node_offset: { x: 10, y: 10 } },
                  },
                  ...(key === 'BRANCH' || nested
                    ? [
                        {
                          id: 'c2',
                          parent_id: 'c1',
                          message: 'Will do',
                          created_at: '2026-01-01T00:01:00Z',
                          user: { handle: 'grace' },
                        },
                      ]
                    : []),
                  ...(nested
                    ? [
                        { id: 'off-page', client_meta: { node_id: '5:3' } },
                        { id: 'on-canvas', client_meta: { node_id: '1:1' } },
                        { id: 'deleted', client_meta: { node_id: '9:9' } },
                      ]
                    : []),
                ],
    });
  }
  return new Response('unexpected request', { status: 400 });
};
