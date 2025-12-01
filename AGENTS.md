# AGENTS.md

This file provides guidance to AI assistants when working with code in this repository.

## Overview

Saleor CLI is a command-line tool for managing Saleor Cloud resources and local development workflows. It handles authentication with Saleor Cloud, environment/organization/project management, storefront scaffolding, app management, webhooks, and integrations with Vercel/GitHub.

## Build and Development Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Bundle the CLI using esbuild
pnpm watch            # Watch mode (runs tsc, esbuild, and graphql-codegen concurrently)
pnpm lint             # Run prettier and eslint with auto-fix
pnpm test             # Run tests with vitest
pnpm generate         # Generate GraphQL types from schema
```

### Running the CLI locally

After building, run the CLI with:
```bash
node dist/saleor.js <command>
```

### Running a single test

```bash
pnpm vitest run src/lib/environment.test.ts
```

### Environment Variables

- `DEBUG=saleor-cli:*` - Enable debug output for CLI modules
- `RUN_FUNCTIONAL_TESTS=true` - Enable functional tests
- `SALEOR_CLI_TOKEN` - Override authentication token
- `SALEOR_CLI_ENV_URL` - Override Cloud API URL
- `NODE_ENV` - Controls Sentry reporting (only in `production`)

## Architecture

### Entry Point and CLI Structure

The CLI uses **yargs** for command parsing. Entry point is `src/cli.ts` which:
- Registers all command modules from `src/cli/` subdirectories
- Sets up global middleware (online checker)
- Handles version checks and Sentry error reporting
- Processes global options (`--json`, `--short`, `--instance`)

### Command Organization

Commands are organized by resource type in `src/cli/`:
- `app/` - Saleor App management (create, install, tunnel, etc.)
- `env/` - Environment management (create, list, upgrade, etc.)
- `organization/` - Organization management
- `project/` - Project management
- `storefront/` - Storefront scaffolding
- `webhook/` - Webhook management
- `backup/` - Backup/restore operations
- `vercel/`, `github/` - Third-party integrations

Each command module exports yargs command configuration with `command`, `describe`, `builder`, and `handler`.

### Middleware System

`src/middleware/index.ts` contains reusable middleware for:
- `useToken` - Token resolution (config file, env var, or prompt)
- `useOrganization` / `useEnvironment` - Resource selection with interactive prompts
- `useInstanceConnector` - Resolves Saleor instance URL from org/env
- `useGithub` / `useVercel` - Third-party auth checks
- `useAvailabilityChecker` - Ensures environment is not in maintenance

Middleware is composed in handlers to build up the `argv` context progressively.

### API Layer

`src/lib/index.ts` provides HTTP helpers (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) that:
- Automatically add auth headers from config
- Use the Cloud API URL from config or environment
- Return JSON-parsed responses

`API` object defines URL path templates for all Cloud API endpoints.

### Configuration

`src/lib/config.ts` manages persistent config stored in `~/.config/saleor.json`:
- Auth tokens (Saleor Cloud, GitHub, Vercel)
- Selected organization/environment
- Cloud API URL overrides

### GraphQL

- Schema and generated types in `src/generated/graphql.ts`
- Codegen config expects a `.graphqlrc` or similar
- Uses `graphql-request` for Saleor API queries

### Key Types

`src/types.ts` defines:
- `Options` - Base interface for command arguments
- `Environment`, `Organization`, `Project` - Cloud resource types
- `App`, `Webhook` - Saleor API entities

## Testing

Tests use **vitest** with **msw** for API mocking. Functional tests require `RUN_FUNCTIONAL_TESTS=true`.

Test files follow the pattern `*.test.ts` and are located both in `src/lib/` and `test/` directories.
