/**
 * Proxy Cloudflare devant le backend Convex de Rawdah.
 *
 * Certains antivirus (WebShield Avast/Norton) bloquent les domaines
 * *.convex.cloud : l'app ne peut alors ni charger les données ni garder sa
 * connexion temps réel. Ce Worker relaie tout (HTTP et WebSocket) depuis un
 * domaine à nous vers le déploiement Convex, sans rien modifier.
 *
 * CONVEX_CLOUD_URL est défini dans wrangler.toml (URL publique, pas un secret).
 */
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, env.CONVEX_CLOUD_URL);
    // fetch() relaie aussi les connexions WebSocket (en-tête Upgrade conservé).
    return fetch(new Request(target, request));
  },
};
