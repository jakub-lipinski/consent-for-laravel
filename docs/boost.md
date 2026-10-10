# Laravel Boost

Consent for Laravel ships a short always-loaded guideline and one task-focused skill with twelve supporting references. Laravel Boost discovers these resources from the installed Composer package; no separate consent command, asset publishing, or runtime dependency on Boost is required.

## Install in Your Application

Install the package and Boost in your Laravel application, if they are not already installed:

```bash
composer require jakub-lipinski/consent-for-laravel
composer require laravel/boost --dev
php artisan boost:install
```

Use a Boost version that supports third-party package skills. Run the installer in your development environment, select **AI Guidelines** and **Agent Skills**, select `jakub-lipinski/consent-for-laravel` from the third-party package list, and choose your agents. MCP configuration is an independent Boost feature; this package needs no additional MCP server.

Installing AI resources does not enable a tracker, configure a consent purpose, publish configuration, or change visitor decisions. The skill guides the agent through those application changes when requested.

## Package Resources

```text
resources/boost/
├── guidelines/
│   └── core.blade.php
└── skills/
    └── consent-for-laravel-development/
        ├── SKILL.md
        └── references/
            ├── setup.md
            ├── interface.md
            ├── custom-scripts.md
            ├── browser-api.md
            ├── php-api.md
            ├── audit.md
            ├── verification.md
            └── integrations/
                ├── google.md
                ├── meta-pixel.md
                ├── clarity.md
                ├── matomo.md
                └── tiktok.md
```

`core.blade.php` gives the agent the package's essential constraints and tells it when to activate the skill. `SKILL.md` provides the workflow, a quick start, the measurement/permission matrix, and links to the relevant reference. Each reference has practical examples, verification steps, and common mistakes. Google Analytics and Ads share one reference because they share the Google bridge and event helper.

References stay inside the skill directory, so they work after Boost copies the skill to an agent. They are Markdown rather than application-dependent Blade templates: the agent reads the application's actual configuration before adapting examples. SDK source, complete translation dictionaries, package test infrastructure, and exhaustive vendor manuals stay outside the skill; its job is to explain the public package API and help the agent find the next relevant detail.

## Files in the Laravel Application

For Codex with Boost's default paths, the relevant application files look like this:

```text
your-application/
├── AGENTS.md
├── boost.json
├── .agents/skills/consent-for-laravel-development/
│   ├── SKILL.md
│   └── references/              # All twelve reference files
└── vendor/jakub-lipinski/consent-for-laravel/resources/boost/
    ├── guidelines/core.blade.php
    └── skills/consent-for-laravel-development/
```

The original core file stays in `vendor`. Boost renders and merges its contents into the agent's guideline file, alongside Laravel and other selected package guidance. It does not publish a separate `core` file into the application. `boost.json` records the selected agents, packages, and features.

| Agent | Default installed skill directory |
| --- | --- |
| Codex | `.agents/skills/consent-for-laravel-development/` |
| Claude Code | `.claude/skills/consent-for-laravel-development/` |
| Cursor | `.cursor/skills/consent-for-laravel-development/` |

Guideline locations depend on the agent, existing files, and Boost configuration. For example, Claude Code may use an existing `CLAUDE.md`; inspect the installer's output rather than assuming every agent uses `AGENTS.md`. Package skills do not require an application `.ai/skills` copy.

An agent can then follow a request such as:

> Configure Matomo through Consent for Laravel, measure confirmed orders with its guarded API, and verify acceptance, refusal, and withdrawal.

The short guideline activates `consent-for-laravel-development`; the skill directs it to setup, Matomo, and verification references as needed.

## Updates and Application Customizations

After updating the installed Composer package, refresh selected guidance and skills:

```bash
php artisan boost:update
```

For a package newly added to an existing Boost installation, run the interactive discovery flow:

```bash
php artisan boost:update --discover
```

Select the package when prompted. Current Boost also discovers by default; the explicit option makes the intention clear. Alternatively, rerun `boost:install` and select the package, guidelines, and skills. An unattended update refreshes the existing selection and does not select a newly discovered package for you.

Treat agent-specific installed package files as generated resources: updates may replace them. Keep application-specific guidance in Boost's custom guideline mechanism, such as `.ai/guidelines/consent.md`. To override this entire skill deliberately, create `.ai/skills/consent-for-laravel-development/SKILL.md` with the same skill name and include any references it needs. Boost gives custom skills precedence; your override then needs maintenance when the package API changes. Never edit package files in `vendor`.

Boost remains an optional development tool. Applications without it continue using the same package runtime, configuration, views, translations, and audit behavior. See the [official Boost documentation](https://laravel.com/docs/13.x/boost) for agent configuration and custom resources.
