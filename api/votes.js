// Cloudflare Pages Function  ->  bëhet automatikisht /api/votes
// Kërkon 3 variabla mjedisi: UPSTASH_URL, UPSTASH_TOKEN, SALT

export async function onRequest({ request, env }) {
  const redis = (cmds) =>
    fetch(env.UPSTASH_URL + '/pipeline', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.UPSTASH_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cmds)
    }).then(r => r.json());

  const now = Date.now();

  if (request.method === 'POST') {
    // IP-ja ruhet vetëm si hash, kurrë e hapur
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(ip + (env.SALT || ''))
    );
    const key = 'ip:' + [...new Uint8Array(buf)]
      .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);

    // një votë për IP në 24 orë
    const [set] = await redis([['SET', key, '1', 'NX', 'EX', '86400']]);

    if (set.result === 'OK') {
      const city = request.headers.get('cf-ipcity') || '';
      const cmds = [
        ['INCR', 'votes'],
        ['ZADD', 'votes:ts', now, key + now],
        ['ZREMRANGEBYSCORE', 'votes:ts', 0, now - 3600000]
      ];
      if (city) {
        cmds.push(['LPUSH', 'votes:places', city], ['LTRIM', 'votes:places', 0, 19]);
      }
      await redis(cmds);
    }
  }

  const out = await redis([
    ['GET', 'votes'],
    ['ZCOUNT', 'votes:ts', now - 600000, now],
    ['LRANGE', 'votes:places', 0, 9]
  ]);

  return Response.json({
    count:  Number(out[0].result) || 0,
    recent: Number(out[1].result) || 0,
    places: [...new Set(out[2].result || [])]
  }, { headers: { 'Cache-Control': 'no-store' } });
}
