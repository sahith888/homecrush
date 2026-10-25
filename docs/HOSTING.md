# Hosting HomeCrush

Recommendation as of October 25, 2026: **Cloudflare Workers**. The current app already uses Cloudflare's runtime for its server routes, so this route needs the least adaptation. The browser renders the 3D world; the Worker keeps the model key private and handles AI edits and listing retrieval.

## Options

| Option | Fit for this repository | Cost / tradeoff |
| --- | --- | --- |
| **Cloudflare Workers** | Prepared here: Worker entrypoint, Wrangler configuration and build/deploy scripts. Static assets and API routes stay in one app. | A free plan exists; paid starts at $5/month plus usage. Free has a 10 ms CPU limit per invocation, so test actual SSR and listing parsing before relying on it. Waiting for external AI responses is not CPU time. |
| **Vercel** | Good if you want to move to conventional Next.js. The current Worker-specific environment imports and Vinext deployment configuration need adaptation first. This repository is not a tested one-click Vercel deployment. | Hobby is for personal, non-commercial use. Pro has a subscription plus usage. |
| **GitHub Pages** | Suitable for a static visual demo only. It cannot run the server routes that protect the model key and retrieve listings. | Would require a separate backend for the full app. |
| **Existing ChatGPT Site** | The original private demo already works there. | Its publication is separate from this GitHub repository; GitHub pushes do not update that Site automatically. |

Provider references: [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Cloudflare: connect the GitHub repository

1. Open Cloudflare's **Workers & Pages** area and create a Worker from an existing GitHub repository.
2. Select `sahith888/homecrush`, branch `main`, with the repository root as the project directory.
3. Use Worker name `homecrush` to match `wrangler.jsonc`. Change both if you choose a different name.
4. Configure the commands below. Use Node.js 24 for the build environment.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --config dist/server/wrangler.json` |
| Root directory | Repository root |
| Production branch | `main` |

Workers Builds installs the locked npm dependencies. The build generates `dist/server/wrangler.json` and the client assets. Deploy that generated configuration, not the unbuilt TypeScript entrypoint. [Build settings reference](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

5. In the Worker's **Settings → Variables and Secrets**, add a **Secret** named `GEMINI_API_KEY`. Add it as a runtime secret; build-only variables are not available to server requests. Deploy the change. Without the key, the app remains in preview-edit mode. [Secrets reference](https://developers.cloudflare.com/workers/configuration/secrets/).
6. Open the resulting `workers.dev` URL and test an edit, two-floor movement and listing search. Attach a custom domain through the Worker settings if wanted.

No Cloudflare account, domain, paid subscription or deployment is created by checking this repository into GitHub.

## Cloudflare: deploy from your computer instead

After choosing your Cloudflare account and hosting plan:

```sh
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put GEMINI_API_KEY
```

The final command prompts for the key without putting it in source code. It updates and deploys the Worker's secret. The checked-in `.dev.vars.example` is only a local placeholder; `.dev.vars` is ignored.

To validate packaging without publishing:

```sh
npm run build
npx wrangler deploy --config dist/server/wrangler.json --dry-run
```

## Practical limits

Hosting bills and Google model/search bills are separate. Moving to Cloudflare does not increase Google API quota. If search reports a quota error, review the Google AI project quota/billing configuration; until then, the app uses its clearly labeled, live-rechecked starter collection.

The 3D rendering happens on the visitor's device. Worker CPU is used for server rendering, request validation, LangGraph and parsing listing pages. The free Worker's CPU ceiling may be more relevant than its request allowance for this app. A paid plan gives more headroom, but actual usage determines cost. No paid plan has been enabled by this setup.

The standalone Worker serves the app without the original Site's owner-only login. For a private demonstration, configure Cloudflare Access. For a public event, add request throttling or a challenge and set Google API quotas before sharing the AI endpoints widely. CORS/Origin checks alone are not an authentication or abuse-control system.

Designs and saved homes live in localStorage for each website origin. A new domain starts with a fresh browser state; export the current dream home first if you want to retain a file copy. There is no server database, account sync or automatic import of existing localStorage.

Listing photos are loaded from the source website. Some providers can change their page structure or block server requests; the app reports a short/empty deck instead of inventing homes.
