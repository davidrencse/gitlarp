# GitLarp

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User approved React, TypeScript, Vite, and Express. Hosting remains undecided. Build directly in code. The current brief replaces the earlier violet workspace with black-and-white liquid glass and a native WebGL visual, inspired by Unicorn Studio effects.

## Users
Developers selecting a GitHub project to improve its documentation, repository presentation, and organization.

## Product Purpose
Connect a GitHub account, find a project, generate useful repository assets, review them, and publish real changes with descriptive commit messages.

## Operating Context
GitHub OAuth, repository browsing, documentation editing, branches, forks, new repositories, and pull requests.

## Capabilities and Constraints
List accessible repositories with pagination. Inspect real repository metadata, files, package scripts, README and recent commits. Generate and edit documentation and contribution templates. Publish meaningful commit groups on a new branch, a fork, or a new documentation repository. Preserve original history. By default, use the authenticated user's identity and the actual creation time; the publish screen also offers an explicitly labeled override for a supplied author and past dates. This override can make commit metadata misrepresent when or by whom work was done, so it carries a trust and reputation risk. Demo mode is removed. The user confirmed both GitHub browser OAuth and personal access token sign-in. OAuth requires configured app credentials; token sign-in validates the user's token through GitHub and keeps it in expiring server memory. The local app also connects an existing GitHub CLI account when explicitly enabled on loopback in development. A live read-only check verified that connection and repository listing; external writes and OAuth app credentials remain unverified.

## Project intelligence

The user requested source-aware Groq improvements with both technical depth and clear project presentation. Analyze real sampled source, expose capabilities/architecture/recommendations with immutable file citations, answer project questions, and draft complete selected Markdown. Keep generation reviewable and require a separate publish action. Show sampling limits, unverified areas, and provider-returned usage. Route analysis/Q&A and documents through the configured Groq models; use bounded retrieval, compact task-specific prompts, snapshot/focus cache reuse, and omit repeated analysis during drafting. Purely deterministic file selections skip the provider. Keep credentials server-side and disclose that selected excerpts are shared with Groq. A live provider check validated model access and JSON-mode inference; no GitHub changes were made.

## Product Principles
Review before publishing. Claims must come from repository evidence. Every commit represents a real file change. Keep repository ownership and destination visible. Keep credentials server-side.

## Brand Commitments
User explicitly requested black and white, dark liquid glass, Unicorn Studio-like effects, real WebGL, impeccable design, and functional authenticated interactions. Support reduced motion, a pause control, and a static fallback.

## Evidence on Hand
An existing audited app with an OAuth backend, repository inspection, reviewed commit publishing, unit/API tests, and Playwright. Synthetic repositories exist only in test fixtures and mocked integration responses, never in the shipped app. Live GitHub data is available after authentication.
