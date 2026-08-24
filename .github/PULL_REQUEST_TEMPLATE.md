# Pull Request

## Summary

<!-- What does this PR do and why? Link the related issue: Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring (no behavior change)
- [ ] Documentation
- [ ] Infrastructure / CI

## Checklist

<!-- See CONTRIBUTING.md for the full build/test matrix. -->

- [ ] Backend: `./gradlew clean build` passes (if `backend/**` touched)
- [ ] Frontend: `npm run lint && npm run build && npm test` passes (if `frontend/**` touched)
- [ ] Contracts: `npm run build && npm run test:coverage && npm run lint` passes (if `contracts/**` touched)
- [ ] Specs synced (if API changed): `docs/specs/openapi.yaml` via `./gradlew exportOpenApi`, `docs/specs/stomp-routes.json` via `./gradlew exportStompRoutes`, narrative in `docs/specs/API.md` / `DATA_MODELS.md`
- [ ] i18n: new user-facing strings added to **both** `frontend/src/i18n/locales/en.json` and `ru.json`
- [ ] No secrets, tokens, keys, or mnemonics in the diff
- [ ] The change preserves the zero-knowledge invariant (server never sees plaintext or keys)

## Screenshots / recordings

<!-- Required for UI changes. Delete this section otherwise. -->

## Notes for the reviewer

<!-- Trade-offs, follow-ups, areas needing extra attention. -->
