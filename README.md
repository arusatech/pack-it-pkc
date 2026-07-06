# pack-it-pkc

Convert documents to Markdown and pack them into PKC format.

## Project structure

```
src/
  convert/   # Document-to-Markdown conversion
  detect/    # Format detection
  pkc/       # PKC packing
test/        # Tests
```

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Scripts

| Command       | Description                          |
| ------------- | ------------------------------------ |
| `npm run dev` | Build in watch mode                  |
| `npm run build` | Build for production (`dist/`)     |
| `npm test`    | Run tests with Vitest                |

## License

MIT — Mr. Yakub Mohammad &lt;yakub@annadata.ai&gt;
