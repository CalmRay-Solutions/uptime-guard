// Wrangler bundles *.sql as text modules (see the `rules` in wrangler.toml).
declare module "*.sql" {
  const content: string;
  export default content;
}
