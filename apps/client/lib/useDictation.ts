// Native speech-to-text arrives with the iOS and Android apps.
export function useDictation(_onText: (text: string) => void) {
  return { listening: false, supported: false, toggle: () => undefined };
}
