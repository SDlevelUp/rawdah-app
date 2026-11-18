import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

// Délai maximal d'attente du retour de Google avant de renvoyer vers /auth.
const AUTH_CODE_TIMEOUT_MS = 10_000;
// Au-delà, on considère que le serveur (Convex) est injoignable : on arrête
// le chargement infini et on explique quoi faire.
const SERVER_TIMEOUT_MS = 15_000;

/**
 * Protège une page réservée aux personnes connectées.
 *
 * Au retour de Google, l'URL porte un `?code=` que Convex Auth échange contre
 * une session : pendant cet échange, on affiche « Connexion en cours… » au lieu
 * de conclure trop tôt que la personne n'est pas connectée (cause du « il faut
 * se connecter deux fois »). Sans session, on renvoie directement vers la page
 * de connexion, qui ramène ici via `returnTo`.
 *
 * Si le serveur ne répond pas (réseau coupé, antivirus ou pare-feu qui bloque
 * convex.cloud…), on affiche un message avec un bouton « Réessayer » au lieu
 * de laisser tourner le chargement indéfiniment.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const hasAuthCode = params.has("code");
  const [codeTimedOut, setCodeTimedOut] = useState(false);
  const [serverTimedOut, setServerTimedOut] = useState(false);

  useEffect(() => {
    if (!hasAuthCode) return;
    const timer = window.setTimeout(() => setCodeTimedOut(true), AUTH_CODE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [hasAuthCode]);

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setTimeout(() => setServerTimedOut(true), SERVER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const waitingForGoogle = hasAuthCode && !codeTimedOut;

  if (isLoading && serverTimedOut) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p role="alert" className="text-base font-semibold text-foreground">
            Impossible de joindre Rawdah pour le moment
          </p>
          <p className="text-sm text-muted-foreground">
            Vérifie ta connexion internet. Si tu as un antivirus ou un pare-feu
            (Avast, Norton…), il bloque peut-être la connexion au serveur de
            l'app.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Réessayer</Button>
      </main>
    );
  }

  if (isLoading || (!isAuthenticated && waitingForGoogle)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <p role="status" className="text-sm text-muted-foreground">
          {hasAuthCode ? "Connexion en cours…" : "Chargement de ton espace…"}
        </p>
      </main>
    );
  }

  if (!isAuthenticated) {
    params.delete("code");
    const search = params.toString();
    const returnTo = `${location.pathname}${search ? `?${search}` : ""}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return children;
}
