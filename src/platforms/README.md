# platforms

How Scout signs in to the sites that need it (LinkedIn, Indeed, Naukri and others), in two ways the user chooses per platform and can change at any time.

**Public interface:** `src/platforms/index.ts`. Other modules import only from there.

## The two ways

| Way                | What happens                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `manual` (default) | The user signs in themselves in Scout's browser window. Scout types nothing and reuses the saved browser session.          |
| `saved`            | The username and password live in the OS keychain. When the session has expired Scout signs in itself, once, then goes on. |

The choice is `settings.platformLogins[platform]`; a platform not listed is `manual`. The apply level stays `settings.boardLevels[platform]`.

## Public interface

| Export                                                        | What it does                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platformForUrl(url)`, `KNOWN_PLATFORMS`, `findKnownPlatform` | Maps a posting address to a platform name by host name (`example.com` gives `example`); the three known platforms have a sign-in page and domains |
| `hostBelongsToPlatform(host, platform)`                       | The own-domain check behind "never type on another site"                                                                                          |
| `createCredentialVault({ runner })`                           | Keychain access (`security` on macOS, `secret-tool` on Linux); `save`, `exists`, `read`, `forget`                                                 |
| `createSessionStore(path)`                                    | `<data>/platform-sessions.json`: username and last sign-in times per platform, atomic writes                                                      |
| `manualLogin(driver, platform, context, address?)`            | Opens the sign-in page, waits for Enter, records the time                                                                                         |
| `autoLogin(driver, platform, vault, context)`                 | One automatic sign-in with every guard below; returns `{ signedIn }` or a stop with a reason                                                      |
| `resolveVault(overrides)`, `PlatformOverrides`                | The real vault, or the test fake                                                                                                                  |

## Rules that never break

- The password lives only in the OS keychain. Saving runs the keychain program on the user's own terminal, so the program itself asks for the password: Scout never receives it while saving and never puts it in a command line. Reading is for one sign-in only, captured in memory.
- Credentials are never read from a file or an environment variable, and never appear in a log, error, evidence file, action log, settings file, session record or model prompt. A test scans the whole data folder and all output for the test password.
- Automatic sign-in types only on an https page whose host is the platform's own domain, checked after the page opens and again just before typing. The password is not even fetched from the keychain on any other page.
- One submit per attempt, never a retry, and at most one attempt per platform per six hours (the attempt time is written down before typing).
- A CAPTCHA, a one-time code, a "verify it's you" step or the sign-in form showing again stops it. It never solves anything. The user finishes by hand with `scout login <platform>`.
- Another system, or a missing keychain program, gives `ScoutError("unavailable")` saying credentials cannot be saved here and manual sign-in still works.

## Known limits (honest status)

- Never run against a real site, a real keychain or a real browser. Tests use a fake keychain program runner, a fake vault and a fake website.
- The sign-in page addresses of the three platforms are best guesses and may change.
- The form finder is generic and strict. A site with a two-step sign-in (email, then password) or any unusual form is not recognised, and the user signs in by hand.
- `BrowserDriver.currentUrl()` was added for the own-domain check; the Playwright version is also untested.
- The Linux `secret-tool` existence check reads the password into memory and drops it (that program has no check-only form). Its exit codes for "not found" are not verified.
- `scout logout` cannot remove the browser's own cookies: the user signs out in the window or deletes `<data>/browser-profile`.
- Automating these sites may break their terms and risk the account. Choosing `saved` or `auto` for a known platform needs the platform name typed.
