# Coread

Coread is a self-hosted Web application for human-and-AI co-reading.
It supports TXT and EPUB books, local annotations, chapter summaries,
batch reading with a primary and optional helper model, and structured
reading context for rereading.

## Highlights

- Read TXT and EPUB in a browser with local-first reading position and
  persistent page-cache shards.
- Add highlights, wavy underlines, comments, favorites, and chapter chat.
- Generate chapter summaries, block summaries, reading impressions, and
  per-chapter annotation summaries.
- Keep a book prelude, chapter preludes, and versioned facts with
  importance levels and append-only revision history.
- Choose fine or layered review context. Fine review can include favorite
  annotations; both modes can use accumulated annotation-summary memory.
- Run a primary model for close reading and an optional helper model for
  lower-cost summary-only batch reading.
- Manage books, categories, tags, search, trash, export, backups, and an
  optional password-protected session.
- Use the included MCP stdio or SSE server to connect a compatible client.

## Quick Start

Requirements: Node.js 20+ and a native build toolchain supported by
`better-sqlite3`.

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3000`. The server creates its local database under
`data/` by default; this directory is intentionally ignored by Git.

To enable model-backed reading, configure a compatible OpenAI-style chat
completion endpoint using environment variables before starting the server:

- `COREAD_MAIN_BASE_URL`
- `COREAD_MAIN_API_KEY`
- `COREAD_MAIN_MODEL`

The optional helper model uses the matching `COREAD_HELPER_*` variables.
No model is required for ordinary local reading, importing, annotation, and
library management.

## Public Release Notes

This repository intentionally contains no bundled fonts, book files,
databases, backups, deployment configuration, credentials, or private memory
integrations. The reader uses fonts available on the device.

## License And Attribution

Coread is released under the MIT License. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

