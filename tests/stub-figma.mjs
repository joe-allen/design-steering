// Preloaded with `node --import` to replace the Figma API with canned responses.
const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input) => {
  const url = String(input);
  if (/\/files\/[^/]+\?depth=2/.test(url)) {
    return json({ document: { children: [{ id: '1:1', name: 'Checkout', children: [{ id: '2:2' }] }] } });
  }
  if (/\/files\/[^/]+\/nodes\?/.test(url)) {
    return json({
      nodes: {
        '1:1': {
          document: {
            children: [{ id: '2:2', name: 'Frame A', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }],
          },
        },
      },
    });
  }
  if (/\/files\/[^/]+\/comments/.test(url)) {
    return json({
      comments: [
        {
          id: 'c1',
          order_id: '1',
          message: 'Make this bigger',
          created_at: '2026-01-01T00:00:00Z',
          user: { handle: 'ada' },
          reactions: [{ emoji: ':white_check_mark:', user: { handle: 'grace' } }],
          client_meta: { node_id: '2:2', node_offset: { x: 10, y: 10 } },
        },
        ...(url.includes('/files/BRANCH/comments')
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
      ],
    });
  }
  return new Response('unexpected request', { status: 500 });
};
