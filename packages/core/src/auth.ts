import { signInAnonymously, type User } from "firebase/auth";
import { getAuthClient } from "./firebase";

export async function ensureSignedIn(): Promise<User> {
  const auth = getAuthClient();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  const { user } = await signInAnonymously(auth);
  return user;
}
