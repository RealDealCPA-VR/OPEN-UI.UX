# Release signing setup

OpenCodex ships signed installers for macOS and Windows. Signing requires credentials that this repository does not (and cannot) check in — the project owner must enrol with Apple and a Windows CA, then drop the secrets into the GitHub repo settings.

This doc walks through what to buy, what to generate, and which GitHub Secrets to populate so [`.github/workflows/release.yml`](../.github/workflows/release.yml) picks them up.

If a secret is missing the release job still produces an installer — it will simply be **unsigned**. Users see an "unidentified developer" warning on macOS and SmartScreen on Windows, which is acceptable for pre-1.0 alpha builds but blocks real distribution.

---

## macOS — Developer ID Application + Notarization

### One-time setup

1. **Enrol in the Apple Developer Program** — <https://developer.apple.com/programs/> ($99/year). Individual or organization, both work.
2. In the Apple Developer dashboard, **Certificates, IDs & Profiles → Certificates → +**, create a **Developer ID Application** certificate. (Not "Apple Development", not "Mac App Distribution" — must be **Developer ID Application** for distribution outside the App Store.)
3. Download the `.cer` and double-click to install it into Keychain Access. Then in Keychain Access, find the cert under "login → My Certificates", right-click → **Export**, choose `.p12`, set a password.
4. Base64-encode the `.p12` for the GitHub Secret:

   ```sh
   base64 -i developer-id-application.p12 | pbcopy
   ```

5. **Create an app-specific password** for notarization at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Label it `opencodex-notarization`. Save the generated string.
6. Find your **Team ID** at <https://developer.apple.com/account> → Membership.

### GitHub Secrets to add

| Secret                        | Value                                       |
| ----------------------------- | ------------------------------------------- |
| `CSC_LINK`                    | base64 of the `.p12` (from step 4).         |
| `CSC_KEY_PASSWORD`            | password you set when exporting the `.p12`. |
| `APPLE_ID`                    | your Apple ID email.                        |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from step 5.          |
| `APPLE_TEAM_ID`               | 10-character Team ID from step 6.           |

`electron-builder` reads all five automatically — no further config needed in `electron-builder.yml`. With all five set, the macOS job in `release.yml` will codesign **and** notarize the `.dmg` + `.zip` artifacts. Notarization adds 2–10 minutes to the build.

### Verifying locally

```sh
# Codesign check
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/OpenCodex.app"

# Notarization staple check
spctl -a -t exec -vvv "release/mac-arm64/OpenCodex.app"
# Expected: "accepted; source=Notarized Developer ID"
```

---

## Windows — Authenticode (EV recommended)

### One-time setup

1. **Purchase an EV Code Signing certificate** from a CA: Sectigo, DigiCert, GlobalSign, or SSL.com. EV certs cost roughly $300–$500/year and require business validation (3–10 business days). A standard (non-EV) OV cert is cheaper but triggers SmartScreen warnings until the cert builds reputation — EV bypasses SmartScreen from the first signature.
2. **EV certs ship on a hardware token** (USB HSM). The private key never leaves the token; signing has to physically touch the token. This means **EV signing cannot run on a hosted GitHub Actions runner.** Options:
   - **Self-hosted runner** with the token plugged in on a build machine you control. Tag the runner so only the windows job uses it.
   - **Manual signing pass**: run the release workflow with the windows job disabled (or skip the win signing env vars), then sign locally and re-upload.
   - **Cloud KMS option**: services like SSL.com eSigner or DigiCert KeyLocker expose the EV key via REST API so CI can sign — most expensive route but unblocks fully-automated releases.
3. For an OV cert (no hardware token), export to `.pfx` with a password and base64-encode it the same way as macOS:

   ```sh
   certutil -encode codesign.pfx codesign.pfx.b64
   # then: cat codesign.pfx.b64 | clip
   ```

### GitHub Secrets to add (OV certs only — EV needs a runner-side setup)

| Secret                 | Value                                       |
| ---------------------- | ------------------------------------------- |
| `WIN_CSC_LINK`         | base64 of the `.pfx`.                       |
| `WIN_CSC_KEY_PASSWORD` | password you set when exporting the `.pfx`. |

For EV certs, set `WIN_CSC_LINK` to point at the runner-local cert store or use electron-builder's `signtoolOptions` in `electron-builder.yml` to invoke `signtool.exe` against the hardware token.

### Verifying locally

```powershell
Get-AuthenticodeSignature .\release\OpenCodex-Setup-X.Y.Z.exe
# Status should be "Valid"
```

---

## How `release.yml` consumes these

The workflow at [`.github/workflows/release.yml`](../.github/workflows/release.yml) forwards every signing-related secret as an environment variable on the desktop build step:

```yaml
env:
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

| Env var                       | Purpose                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GH_TOKEN`                    | electron-builder uses this to create the GitHub Release draft and upload artifacts. The default `GITHUB_TOKEN` is sufficient. |
| `CSC_LINK`                    | macOS Developer ID `.p12`, base64.                                                                                            |
| `CSC_KEY_PASSWORD`            | macOS `.p12` password.                                                                                                        |
| `APPLE_ID`                    | Apple ID used for notarization.                                                                                               |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization.                                                                                       |
| `APPLE_TEAM_ID`               | Apple Developer Team ID for notarization.                                                                                     |
| `WIN_CSC_LINK`                | Windows code-signing `.pfx`, base64.                                                                                          |
| `WIN_CSC_KEY_PASSWORD`        | Windows `.pfx` password.                                                                                                      |

Missing secrets are **not fatal**: electron-builder logs `skipped signing` and produces an unsigned artifact. The release will still go up as a draft.

---

## Cutting a release

1. Bump the version in `apps/desktop/package.json` (and root `package.json` if you keep them in sync).
2. Commit and push: `git commit -am "chore: release vX.Y.Z" && git push origin main`.
3. Tag and push the tag:

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. The `release.yml` workflow fires on the tag, builds on macOS/Windows/Linux in parallel, signs, notarizes, and publishes a **draft** GitHub Release with all installers attached.
5. Open the draft, paste in [`RELEASE_NOTES_TEMPLATE.md`](../RELEASE_NOTES_TEMPLATE.md) filled out, attach checksums, then click **Publish release**.

## Further reading

- electron-builder code signing docs: <https://www.electron.build/code-signing>
- electron-builder publishing: <https://www.electron.build/configuration/publish>
- Apple notarization deep-dive: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Microsoft signing best practices: <https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptography-tools>
