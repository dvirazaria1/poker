# Auth/session hardening report

Source: `.superpowers/codex-connection-review.md` findings #2, #3, #6, #10, #12, #13 (all in `kupa-sgura.html`; #1 already fixed on main). Suite: 704 tests pass (698 + 6 new in `tests/auth-session-hardening.test.cjs`; one assertion in `tests/auth-login.test.cjs` updated for the new 429 copy).

## #2 stale profile work
- New `authSessionGen`, `authPendingUserId`. `applySession` bumps the generation on the null-session path and before every profile request; `signOutAccount` bumps it too. After `await ensureProfile` a mismatched generation returns silently.
- `authAppliedUserId` is now set only after a successful, current-generation init. Same-user events during an in-flight request are skipped via `authPendingUserId`.
- When a different account arrives while another is applied, the old identity is cleared and `exitCloudMode()` runs before the new profile loads.
- `signOutAccount` guard widened so a pending/failed (authUser still null) session still gets `supabase.auth.signOut()`.
- Not done: no serialization queue beyond the same-user pending flag; no timeout on a hung profile request (review suggested one; outside the listed scope).

## #3 profile must really exist
- `ensureProfile` now returns `null` when the SELECT errors/throws (no blind upsert, so an existing name is never overwritten) or when the row is missing and the upsert errors/throws. If a row exists and only the update fails, the existing profile is kept.
- `applySession` on `null`: no cloud mode, `authProfileFailedUserId` set, login shown once per failing user (later auth events retry silently, not deduped since the applied marker is unset). Inline Hebrew line "ההתחברות הצליחה אבל לא הצלחנו לטעון את החשבון." + retry button on the login screen (`#authProfileFail`, `#authProfileRetryBtn`) and in settings (`#setProfileFail`, `#setProfileRetryBtn`). `retryAuthProfile` re-reads the SDK session and re-applies it; `renderAuthProfileState` syncs both surfaces.
- Not done: the settings "התנתקות" button stays tied to `authUser` (an existing test asserts that exact expression), so in the failed state the user can retry or continue locally but not sign out from settings.

## #6 invite notices after deferred boot
- New `refreshInviteNotices()` re-renders a visible join/friend notice; called at the end of `bootBackend` and on both null-session exits of `applySession`. A notice the person already dismissed is not re-shown.
- The join notice "המשך" button, when `!supabase`, only hides the notice (token and `?join=` kept); with a backend it still calls `closeJoinNotice`. After sign-in `maybeRunPendingJoin` re-reads the token.
- Not done: the friend notice has no equivalent "continue" path (its "לא עכשיו" is an explicit dismissal and still clears the token).

## #10 getSession error
- `initAuth` inspects `error`. New `isInvalidSessionError` (400/401/403 or refresh/invalid token/session-missing text; status 0 / network text is explicitly not invalid): invalid -> `applySession(null)`; network failure -> nothing, local work and any current identity kept.
- Not done: no separate "reauthentication required" UI state; no SDK `signOut({scope:'local'})` call (auth-js already removes a non-retryable session itself).

## #12 email OTP
- `resendEmailCode` is single-flight via `authResendBusy`; the button is disabled during the request and `tickResendButton` respects the flag.
- `mapAuthError(..., "email")` on 429 now says the email quota is exhausted for now and suggests Google. The code-verification step keeps the old "try again in a few minutes" text, since that limit is per attempt.
- Not done: external SMTP configuration (operational task).

## #13 OAuth callback errors
- Boot: when a redirect error was stored, `showLogin()` runs first even if a local name exists or an invite token is in the URL (the token stays in the URL and is picked up after sign-in). The message stays the fixed generic string; nothing from the URL is logged or displayed.
- `authGoogleBusy` + `resetGoogleBusy` on `pageshow` and `visibilitychange` (visible) so the button does not stay on "מעביר…" if the redirect never takes over the page.
- Not done: installed-PWA / redirect allowlist behaviour (hypotheses, need a real device); SDK init errors that are not URL error params are still not surfaced.

## Could not verify
- Nothing was run against Supabase or a browser; behaviour is covered by vm-slice tests with mocks and source-shape checks. Visual layout of the two new inline error blocks (login and settings) was not checked on a device.
- `build.py`, `index.html`, `sw.js`, `VERSION` untouched.
