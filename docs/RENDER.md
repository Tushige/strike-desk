# Render handoff

The deployment contract is retained in `render.yaml`: one Node service serves the built React application and same-origin `/ws`; `/healthz` is the health endpoint. Node 24 and pnpm 12.5.1 remain pinned. No database or multi-instance state service is introduced.

Build:

```sh
NODE_ENV=development pnpm install --frozen-lockfile && pnpm run build
```

Start:

```sh
node apps/server/dist/server.js
```

This branch has not been deployed. The existing blueprint follows `main` with `checksPass`; verify the actual Render service settings against the blueprint before releasing. A checked-in blueprint is not evidence of the live settings. The public service's current revision and previous successful deployment ID were not inspected in this session.

## Release and rollback

1. Review the diff and [VERIFICATION.md](VERIFICATION.md), including the outstanding browser checks. Run the documented release commands on the final commit.
2. In Render, record the previous successful deployment's commit and deployment ID. Confirm the build/start/health settings above, single-instance deployment and Node version.
3. Deploy the reviewed commit through the project's usual merge/release process. A deployment loses in-memory games.
4. Verify the build stamp and run `pnpm smoke --url https://YOUR-SERVICE.onrender.com --expect-commit COMMIT7`. Check `/healthz` and perform a five-day game with a buy, cash-out, held settlement and skipped day. Refresh during a pending request and at final; verify reconnect and Play again. Open `/?board=2500&dev` in a separate tab and inspect its read-only board and measurements.
5. If verification fails, roll back to the recorded successful deployment in Render, or revert the port commit(s), run checks and redeploy. Record the actual revision and results in the verification document.

Sessions are kept in memory for up to 30 minutes after their last socket disconnects while the process remains alive. Restarts, redeployments and expiry lose games. Protective session/socket caps are not a measured concurrent-user capacity. Receipt recovery and tab storage do not change this limitation.
