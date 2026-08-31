# Development workflow

## Branches and review

```text
feature/* -> pull request -> dev -> verified release pull request -> main
```

- Never push directly to `main`.
- Require one reviewer for important pull requests.
- Require frontend and backend CI checks.
- Keep feature branches short-lived.
- Update `docs/api-contract.md` and both schema implementations in the same pull
  request for any contract change.
- Tag a judge-ready verified release as `demo-v1.1`; do not tag incomplete work.

Recommended GitHub Project columns: `BACKLOG`, `TODO`, `IN PROGRESS`, `REVIEW`,
`BLOCKED`, `DONE`. Creating the remote Project and branch-protection rules needs
repository-owner access and is not performed by local setup scripts.

## Ownership

- F1/F2: WXT entrypoints, browser compatibility, UX
- B1/B2: API, state machine, model adapters, integration
- P1/P2: detection, policy, redaction, privacy assertions
- Team lead: contract approval, integration health, acceptance sign-off

Ownership is not acceptance. A target is complete only after tests, adjacent
integration, documentation, demonstrated criteria, and independent reproduction.

## Contract-first change

1. Modify Zod and Pydantic schemas together.
2. Add or update a shared fixture.
3. Add negative and positive tests.
4. Update the API contract.
5. Implement producers and consumers independently against the fixture.

## Local checks

Run `./scripts/check.sh` before requesting review. Privacy bugs must gain a
regression fixture before the fix. Never add a “temporary” raw fallback.

## Dependency policy

JavaScript versions are locked by `package-lock.json`; Python versions are exact
in `server/requirements.txt` and `pyproject.toml`. Model artifacts require URL,
destination, and SHA-256 in an externally reviewed manifest. Do not commit model
weights, `.env`, traces, databases, or credentials.
