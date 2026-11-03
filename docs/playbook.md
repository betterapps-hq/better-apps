# Shared Playbook guidance

Shared rules, documentation, and selected skills come from
[betterapps-hq/playbook](https://github.com/betterapps-hq/playbook).

- `pnpm guidance:sync` regenerates instructions and copies best practices from the installed, locked Playbook package.
- `pnpm guidance:check` checks for drift without writing files.
- `pnpm guidance:update` fetches a new Playbook revision and regenerates guidance.
- `pnpm skills:add <source> --skill <name>` installs selected skills through Vercel's CLI.
- `pnpm skills:update` updates project skills using their recorded sources.
- `pnpm skills:remove <name>` removes a skill.
- `pnpm skills:sync` restores the Playbook skill selection and Claude Code links on this checkout.

Edit project instructions in `.rulesync/rules/90-project.md`, then run `pnpm guidance:sync`. Do not edit generated
AGENTS.md, CLAUDE.md, or .github/copilot-instructions.md directly. Shared rules live in Playbook. Keep project
documentation in `docs/`; shared documentation lives in `best-practices/`.

Commit generated instructions, shared docs, `.rulesync/playbook-docs.json`, and both package-manager and skills
lockfiles. Shared-doc copying refuses local differences; edit the source in Playbook or preserve the project-specific
content separately. Skill updates may replace local edits. Review guidance and skill changes before merging.

Existing project rules remain authoritative for project-specific tooling and workflows. The detailed setup is documented
in [Playbook's sync guide](https://github.com/betterapps-hq/playbook/blob/main/docs/sync.md).
