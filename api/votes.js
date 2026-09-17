// Vercel Serverless Function  ->  /api/votes
// Pa asnjë import. Kërkon: UPSTASH_URL, UPSTASH_TOKEN, SALT

export default async function handler(req, res) {
  const URL_ = process.env.UPSTASH_URL;
  const TOK  = process.env.UPSTASH_TOKEN;

  if (!URL_ || !TOK) {
    return res.status(500).json({ error: 'env-mungon', has_url: !!URL_, has_token: !!TOK });
  }

  const redis = async (cmds) => {
    const r = await fetch(URL_.replace(/\/+$/, '') + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds)
    });
    if (!r.ok) throw new Error('upstash-' + r.status + '-' + (await r.text()).slice(0, 120));
    return r.json();
  };

  const now = Date.now();

  try {
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(ip + (process.env.SALT || ''))
      );
      const key = 'ip:' + Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);

      const [set] = await redis([['SET', key, '1', 'NX', 'EX', '86400']]);

      if (set.result === 'OK') {
        const city = decodeURIComponent(req.headers['x-vercel-ip-city'] || '');
        const cmds = [
          ['INCR', 'votes'],
          ['ZADD', 'votes:ts', now, key + now],
          ['ZREMRANGEBYSCORE', 'votes:ts', 0, now - 3600000]
        ];
        if (city) cmds.push(['LPUSH', 'votes:places', city], ['LTRIM', 'votes:places', 0, 19]);
        await redis(cmds);
      }
    }

    const out = await redis([
      ['GET', 'votes'],
      ['ZCOUNT', 'votes:ts', now - 600000, now],
      ['LRANGE', 'votes:places', 0, 9]
    ]);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      count:  Number(out[0].result) || 0,
      recent: Number(out[1].result) || 0,
      places: Array.from(new Set(out[2].result || []))
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
