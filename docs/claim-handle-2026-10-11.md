# Claim handle repair, 2026-10-11

## Cause and scope

The connected-wallet onboarding card returned null whenever `modalOpen` became true. This removed both the card and its `ProfileEditorModal`, so clicking **Claim handle** appeared to do nothing. The shared editor also authenticated on opening, requiring a wallet signature before displaying any editable fields. Header-mounted overlays could be constrained by the sticky, blurred header.

Handle claiming remains optional for basket creation, minting and redemption. Existing social posting/follow requirements stay unchanged. This is a frontend correction; the backend authorization contract, devnet deployment, financial projection guards and onchain programs are unchanged.

## Changes

- Hide the nudge while keeping its dialog mounted. Restore it on cancellation.
- Use the installed Base UI dialog with a body portal, focus management, Escape dismissal and scroll locking.
- All claim entry points show one username input. Keep avatar, bio, display name and visibility in the full profile editor.
- Read existing profile through the public endpoint, without signing on open. Abort slow reads after ten seconds and offer an explicit retry.
- Sign only when saving. Show wallet confirmation and saving states, rejected signatures and taken handles inline.
- Claim updates send only `handle`, preserving existing avatar, bio, display name and privacy settings.
- Cancelled pending signatures and a changed wallet cannot write the old form or dismiss another wallet's onboarding.
- Keep the desktop claim chip available across regular site routes. The connected-wallet menu also links to **My profile**, including on mobile. Owner setup and the creation workspace keep their existing scope.

## Validation

Local app validation: 468 Node tests, 66 Vitest tests (including eight actual React interaction regressions), concept-preview integrity, typecheck and production build passed. Keyboard focus returns to the claim button after Escape. Tests use mocked public reads and wallet authentication, without publishing profiles or signing on behalf of a human. Release and live browser evidence are pending below.

## Hosted browser verification

The first staged artifact from `d3f1a28c9798f06e50c4eba67ccdd44a06bdced4` passed live Chrome checks: the previously broken nudge opens the one-field dialog; the existing profile handle loads without a signing request; Escape restores the nudge; the header opens a body-portaled dialog. A 390 × 844 viewport contains the entire form. A final polish increases the Cancel touch target to forty pixels and makes the wallet-menu profile link occupy the full row. No user profile was modified by the agent. The viewport override is reset after verification. Final exact-source release evidence will follow below.
