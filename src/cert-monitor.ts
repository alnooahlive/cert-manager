import tls from 'tls';

const HOST = process.env.AGENT_HOST || 'hotspotmikrotik.alnooah.pro';

// Read the public certificate served by the agent host (Cloudflare-managed).
export function checkAgentCertificate(): Promise<{
  host: string;
  subject: string | null;
  issuer: string | null;
  notAfter: string | null;
  daysLeft: number | null;
  ok: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false }, () => {
      const cert: any = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) {
        return resolve({ host: HOST, subject: null, issuer: null, notAfter: null, daysLeft: null, ok: false, error: 'no certificate' });
      }
      const notAfter = new Date(cert.valid_to);
      const daysLeft = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
      resolve({
        host: HOST,
        subject: cert.subject?.CN || null,
        issuer: cert.issuer?.O || cert.issuer?.CN || null,
        notAfter: cert.valid_to,
        daysLeft,
        ok: daysLeft > 30,
      });
    });
    socket.setTimeout(10000, () => { socket.destroy(); resolve({ host: HOST, subject: null, issuer: null, notAfter: null, daysLeft: null, ok: false, error: 'timeout' }); });
    socket.on('error', (e) => resolve({ host: HOST, subject: null, issuer: null, notAfter: null, daysLeft: null, ok: false, error: e.message }));
  });
}
