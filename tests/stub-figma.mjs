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
function truncate({ children, ...node }, depth) {
  return depth && children ? { ...node, children: children.map((child) => truncate(child, depth - 1)) } : node;
}
let lookupAttempts = 0;
globalThis.fetch = async (input) => {
  const url = new URL(input);
  const [, , , key, endpoint] = url.pathname.split('/');
  const nested = key === 'LARGE' || key === 'DOWN';
  if (!endpoint) {
    if (url.search !== '?depth=1') return new Response('file outline or pin lookup too large', { status: 500 });
    return json({ document: { id: '0:0', children: pages.map((page) => truncate(page, 0)) } });
  }
  if (endpoint === 'nodes') {
    const ids = url.searchParams.get('ids').split(',');
    const depth = Number(url.searchParams.get('depth'));
    if (!depth || depth > 3) return new Response('subtree too large', { status: 500 });
    if (nested && ids.includes(frame.id) && (++lookupAttempts === 1 || key === 'DOWN')) {
      return new Response('server error', { status: 500 });
    }
    const nodes = {};
    function visit(node) {
      if (ids.includes(node.id)) nodes[node.id] = { document: truncate(node, depth) };
      for (const child of node.children ?? []) visit(child);
    }
    pages.forEach(visit);
    return json({ nodes });
  }
  if (endpoint === 'comments') {
    return json({
      comments: [
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
