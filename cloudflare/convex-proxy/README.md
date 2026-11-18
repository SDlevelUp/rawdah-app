# Proxy Convex (Cloudflare Worker)

## Pourquoi

Certains antivirus (WebShield Avast/Norton) classent les domaines
`*.convex.cloud` et `*.convex.site` comme dangereux et les bloquent. L'app
reste alors sur « Chargement de ton espace… » et la connexion Google échoue.

La solution : l'app parle à des domaines à nous, qui relaient vers Convex.

- **Données + temps réel (WebSocket)** : ce Worker Cloudflare. Vercel ne relaie
  pas les WebSocket (testé le 2026-11-18), d'où Cloudflare.
- **Connexion Google / e-mail (HTTP)** : la règle `/_convex-site/...` de
  `vercel.json`, sur `rawdahapp.vercel.app`.

Coût : gratuit (plan Workers Free, 100 000 requêtes/jour ; une connexion
WebSocket compte pour une requête).

## Mise en place

### 1. Déployer le Worker

1. Crée un compte gratuit sur https://dash.cloudflare.com.
2. Dans ce dossier : `npx wrangler login` puis `npx wrangler deploy`.
3. Wrangler affiche l'URL du Worker, par ex.
   `https://rawdah-convex-proxy.<ton-sous-domaine>.workers.dev`.

Recommandé : utiliser ton propre domaine (ex. `api.ton-domaine.fr`), moins
susceptible d'être bloqué qu'un `workers.dev`. Ajoute le domaine dans
Cloudflare, puis décommente la ligne `routes` de `wrangler.toml` et relance
`npx wrangler deploy`.

### 2. Brancher l'app sur le Worker (Vercel)

Vercel → projet rawdah → Settings → Environment Variables :

- `VITE_CONVEX_PROXY_URL` = l'URL du Worker (sans `/` final), environnement
  Production.

Puis redéploie.

### 3. Faire passer la connexion par Vercel (Convex + Google)

1. Convex → déploiement de prod → Settings → Environment Variables :
   `CUSTOM_AUTH_SITE_URL` = `https://rawdahapp.vercel.app/_convex-site`
2. Google Cloud Console → Identifiants → ton client OAuth → URI de
   redirection autorisés : ajoute
   `https://rawdahapp.vercel.app/_convex-site/api/auth/callback/google`
   (garde l'ancienne URI à côté).

### Revenir en arrière

Supprime `VITE_CONVEX_PROXY_URL` dans Vercel et `CUSTOM_AUTH_SITE_URL` dans
Convex, puis redéploie : l'app se reconnecte directement à Convex.
