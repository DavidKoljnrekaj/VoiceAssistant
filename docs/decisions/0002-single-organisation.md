# 0002 — Own Supabase project, single organisation

## Context

Landmark's assistant lives inside Landmark's project and schema. The new product is standalone. Multi-tenancy was considered because later channels might serve more than one company.

## Decision

An own Supabase project with a single organisation: `users` with `auth_user_id`, `role`, `language`; RLS per user through `public.app_user_id()`. Alternatives: multi-tenant from day one (an `organizations` column on every table and every policy, for a product with one customer); share Landmark's project (couples releases and secrets).

## Consequences

Nothing in the skeleton assumes multi-tenancy, and nothing forbids it: an `organizations` table and an `organization_id` column can be added by one later migration. Every policy is written against the user, not a tenant. The Landmark data a future tool pack reads stays in Landmark's project (Part 8).

## Date

2026-10-26
