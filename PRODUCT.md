# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Employees of one client company, signing in at work on a desktop browser during the working day: finance and
operations staff doing their daily tasks, and the company's own administrators who invite colleagues, assign roles
and manage API keys. Nobody signs up on their own; access starts with an invite from the company's administrator.
A Digimuza operator (`Super`) also signs in to set the system up and enable modules.

## Product Purpose

`system-template` is the starter for each client company's own system: one Next.js + Convex app per company, built
on `@digimuza/system-core` (users, roles, permissions, invites, API keys, module registry, audit). Each copy adds the
client's business modules (`finance` is the example). Success: an invited employee gets from the invite email to
their work in a few calm steps, and an administrator can control who can do what without help.

## Positioning

Each client gets their own system, under their own name, with enterprise-grade access control (roles, delegation,
audit, SSO-ready sign-in through WorkOS) that the client never has to think about.

## Operating Context

- Sign-in is WorkOS AuthKit's hosted page; the app's own screens sit before it (`/login`, `/invite`) and after it
  (`/auth/complete`, no-access state). They must feel like one flow with the hosted page.
- Personal account settings (profile, password/MFA, sessions) come from WorkOS Widgets inside `/app/account`.
- Users, roles, invites and API keys are managed by system-core, never in WorkOS.
- Invites arrive by email as a one-time link.

## Capabilities and Constraints

- One template, many client brands: the client's name, logo and accent colour are set in one place per copy.
  Digimuza is not shown to end users.
- Languages: Lithuanian and English. Lithuanian is the default.
- One Docker image serves staging and production; nothing environment- or brand-specific may depend on build-time
  environment variables.
- UI hints (`<Can>`) never replace the server-side permission checks in Convex.

## Brand Commitments

None of its own: the template is a neutral host for each client's brand.

## Evidence on Hand

No client logos, names or customer content exist in the template. Do not invent client names, testimonials or
claims; use clearly marked placeholders.

## Product Principles

1. The client's brand, not ours: every screen reads as the client company's own system.
2. Calm, predictable access: tell people plainly where they are, what they can do, and what to do next.
3. One source of truth for access: system-core decides permissions; other tools only display or authenticate.
4. Fail clearly: misconfiguration and denied access get specific, actionable messages with an operation ID.
