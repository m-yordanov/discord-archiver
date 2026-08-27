##  Contributing to Discord Archiver
Thanks for taking a look. Bug reports, ideas, and pull requests are all welcome.

## Prerequisites

- Node.js 18 or newer
- The Rust toolchain
- Microsoft C++ Build Tools

## Running it

```bash
npm run tauri dev
```

The first Rust build takes a few minutes. Later runs are incremental, and the
frontend hot-reloads on save.

## Tests

```bash
cargo test
```

The tests build their own fixture package in a temporary directory, so there is no
checked-in test data and they run on a fresh clone with no setup.


## Pull requests

Please make sure `cargo test` and `npm run build` both pass before opening one, and
keep unrelated changes in separate commits. Keep the pull requests small enough and concise so they can be easily reviewed.
