# Offline kit

One folder with everything a Docker Compose install downloads on its first
start, for installing on many laptops at once (workshops, demos) without a
fast network. Copy it to USB sticks. Sign-in still needs internet (Clerk), so
this covers a slow or crowded network, not none at all.

## Build

```bash
git checkout <release tag>          # the kit is one commit: images + source
deploy/offline-kit/build-kit.sh 6d33cc62-d59d-4661-a76d-715aa4abddfd 7f0d43e7-8a7b-48f3-9aff-cfa9703a51e8
```

The arguments are tests whose Go modules are pre-downloaded, so **Build**
works offline for them. Options: `--arch amd64,arm64` (default both),
`--library-ref <branch>` (test library, default `main`; another branch also
needs `TESTS_REPO_BRANCH` set to it in `backend/.env`, or Sync fails),
`--out <dir>`. The images are built from a clean copy of HEAD, so
uncommitted changes and untracked files (e.g. `wiki/node_modules`) never get
in, and the test library is pinned to one commit, recorded in `KIT-INFO.txt`.
It needs network access, Docker with buildx, and QEMU (binfmt) for the
architecture that isn't this machine's. Output, in
`deploy/offline-kit/out/achilles-kit/` (gitignored):

```
START-HERE.md           attendee steps, English and Spanish
kit.sh / kit.ps1        checks, loads the images, unpacks the source
ProjectAchilles.tar.gz  the source at that commit, with .git (origin: GitHub)
images/amd64/*.tar      Windows, Intel Macs, Linux
images/arm64/*.tar      Apple Silicon
images/lab-endpoint.tar amd64 only (emulated on Apple Silicon)
images/IMAGES, COMMIT   what kit.sh checks after loading
KIT-INFO.txt            versions in the kit
SHA256SUMS
```

## How it avoids every download

| First-start download | In the kit |
|---|---|
| Image builds (npm, apt, Go toolchain, base images) | Images exported with `docker buildx bake` (`docker-bake.hcl`) as `docker load` tarballs, named the way Compose names built images (`projectachilles-backend`, ...). In a checkout named `ProjectAchilles`, `docker compose up` finds them and builds nothing. |
| Test library clone | Baked into the kit's backend image at `/app/data/f0_library` (`backend-preload.Dockerfile`). Docker copies an image's files into a named volume the first time it is mounted empty, so the `repo-cache` volume starts with it and the backend skips the clone. |
| Go modules for test builds | Same, in the `go-cache` volume: modules of the tests you name, and the standard library compiled for `linux` and `windows` amd64. |
| ES seed client (`pip`) | `deploy/es-seed/Dockerfile` installs it at build time. |

The images are exported straight to files and never tagged on the build
machine, so building a kit never replaces an install's own images there.

## Prove it

```bash
bash deploy/offline-kit/tests/fixes.test.sh                 # the install fixes it relies on
bash deploy/offline-kit/tests/kit.test.sh                   # amd64: full install, no network
KIT_ARCH=arm64 bash deploy/offline-kit/tests/kit.test.sh    # arm64: loads, runs emulated
```

`kit.test.sh` runs a second Docker engine in a container with
`--network none`, loads the kit with `kit.sh`, starts the stack with the lab
endpoint, and checks the seed, the preloaded library, an offline build of each
preloaded test, and the lab endpoint's enrollment. Anything that tries to
download fails it.

## Limits

- An existing `ProjectAchilles` folder is left as it is; Compose then uses the
  kit's images whatever version that folder holds.
- Docker fills a named volume from the image only when the volume is new.
  If `projectachilles_repo-cache` or `projectachilles_go-cache` already exist
  (an earlier install), they keep their old content and test builds need the
  network; `kit.sh` / `kit.ps1` warn and print the `docker volume rm` command.
- `setup.sh` only writes the configuration; the stack starts with
  `docker compose --profile elasticsearch -f docker-compose.yml -f docker-compose.lab.yml up -d`
  (the command `kit.sh` prints, which `kit.test.sh` runs).
- A checkout under another folder name has another Compose project name, and
  builds its images instead (online). Unpack with `kit.sh`/`kit.ps1`.
- Tests not named at build time still build, but need the network for their
  Go modules.
