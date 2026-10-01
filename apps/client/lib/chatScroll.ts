export function shouldAutoScrollAfterAction(actionPending: boolean, userScrolledUp: boolean): boolean {
  return actionPending && !userScrolledUp;
}
