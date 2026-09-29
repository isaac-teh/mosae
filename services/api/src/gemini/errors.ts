export class DemoLimitReached extends Error {
  constructor() {
    super("Demo limit reached — try the options");
    this.name = "DemoLimitReached";
  }
}
