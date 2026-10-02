import { signInAnonymously, type User } from "firebase/auth";
import { getAuthClient } from "./firebase";

let pendingSignIn: Promise<User> | null = null;

export async function ensureSignedIn(): Promise<User> {
  const auth = getAuthClient();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  if (!pendingSignIn) {
    pendingSignIn = signInAnonymously(auth)
      .then(({ user }) => user)
      .finally(() => { pendingSignIn = null; });
  }
  return pendingSignIn;
}
