# Contributing to YTKit

Thanks for your interest in contributing to YTKit! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. Use **Node 22+** (`.nvmrc` is included for `nvm use`)
4. Run `npm ci`
5. If you are testing the userscript build, install [Tampermonkey](https://www.tampermonkey.net/) (Chrome) or [Violentmonkey](https://violentmonkey.github.io/) (Firefox)

## Project Structure

```
YouTube-Kit/
  extension/           # MV3 extension source
    core/              # Shared runtime utilities
    ytkit.js           # Main feature/content-script runtime
    ytkit-main.js      # MAIN-world bridge
    background.js      # Service worker
    options.*          # Options UI
    popup.*            # Toolbar popup UI
  build-extension.js   # Canonical packager for Chrome/Firefox/userscript artifacts
  tests/               # Focused Node-based verification
  ytkit.user.js        # Repo-tracked userscript source
  CHANGELOG.md         # Public version history
  CODEX-CHANGELOG.md   # Agent repair ledger / handoff trail
```

## Architecture

The repo now ships both an MV3 extension and a userscript build. Most feature logic lives in `extension/ytkit.js` and follows the feature object pattern:

```javascript
{
    id: 'featureName',
    name: 'Human Readable Name',
    description: 'What this feature does',
    group: 'Category',        // Appearance, Playback, Interface, etc.
    icon: 'lucide-icon-name',
    init() { /* activate */ },
    destroy() { /* clean up */ }
}
```

### Key patterns:
- **CSS-only features**: Use `cssFeature()` factory
- **DOM observation**: Use `addMutationRule()` / `removeMutationRule()`
- **SPA navigation**: Use `addNavigateRule()` / `removeNavigateRule()`
- **Settings storage**: Use `StorageManager.get()` / `StorageManager.set()`
- **Extension packaging**: Use `build-extension.js` rather than ad-hoc zipping
- **Generated catalogs**: `default-settings.json` and `settings-meta.json` are generated from `ytkit.js`

## Adding a Feature

1. Define your feature object in the `features` array in `extension/ytkit.js`
2. Add a default value in `settingsManager.defaults`
3. Implement `init()` to activate and `destroy()` to fully clean up
4. Always remove event listeners, observers, and DOM elements in `destroy()`
5. Test with the feature toggled on/off multiple times

## Verification

Run these before sending changes:

```bash
npm test
npm run check
npm run build
```

## Code Style

- Avoid new dependencies unless they solve a clear, high-value problem
- Use `cachedQuery()` for frequently accessed DOM elements
- Use `DebugManager.log()` for debug output
- Always clean up in `destroy()` -- no leaked listeners or DOM nodes
- Follow existing indentation (4 spaces)

## Submitting Changes

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run `npm test`, `npm run check`, and `npm run build`
4. Test thoroughly on YouTube (watch page, home, search, channels)
5. Commit with a clear message
6. Push and open a Pull Request

## Reporting Bugs

Use the [Bug Report template](https://github.com/SysAdminDoc/YouTube-Kit/issues/new?template=bug_report.md) and include:
- Browser + version
- Userscript manager + version
- YTKit version
- Steps to reproduce
- Console errors (F12 > Console)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
