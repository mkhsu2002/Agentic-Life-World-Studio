/** Node-side adapter for the Cloudflare platform base class; workflow logic is tested separately. */
export class WorkflowEntrypoint<Env, Params = unknown> {
  protected env: Env;
  constructor(_ctx: unknown, env: Env) {
    this.env = env;
  }
}
