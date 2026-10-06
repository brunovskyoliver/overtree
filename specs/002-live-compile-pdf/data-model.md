# Data model: Live compilation & PDF preview

## SQLite (Drizzle, new migration)

### `compile_settings`
| Column | Type | Notes |
|--------|------|-------|
| `project` | text PK | `'main'` until feature 005 adds projects |
| `compiler` | text not null | `'pdflatex' \| 'xelatex' \| 'lualatex'`, default `'pdflatex'` when no row |

Validation: the PUT route rejects any other compiler value with 400.

## Files: `$DATA_DIR/compile/main/`
| File | Written when |
|------|--------------|
| `output.pdf` | a compile produced a PDF (replaces previous via temp + rename) |
| `output.synctex.gz` | with the PDF it belongs to |
| `output.log` | every compile that produced a log |
| `result.json` | every finished compile (`CompileResult`) |

## Types (`src/lib/compile-types.ts`, shared by server and client)

```ts
type Compiler = 'pdflatex' | 'xelatex' | 'lualatex';

type CompileStatus =
  | 'success'      // PDF produced (may still have errors)
  | 'failure'      // finished, no PDF
  | 'timeout'      // killed at COMPILE_TIMEOUT_MS
  | 'oom'          // killed at COMPILE_MEMORY
  | 'unavailable'; // docker CLI/daemon/image missing

type LogEntry = {
  level: 'error' | 'warning' | 'typesetting';
  message: string;
  file?: string;   // as in the log, './' stripped, e.g. 'main.tex'
  line?: number;
  raw: string;     // the source log line(s)
};

type CompileResult = {
  id: string;             // uuid of this compile
  status: CompileStatus;
  compiler: Compiler;
  stopOnFirstError: boolean;
  startedAt: number;      // epoch ms
  durationMs: number;
  pdfId?: string;         // id of the compile whose PDF is currently stored (this one or an earlier one)
  entries: LogEntry[];
  message?: string;       // human text for timeout/oom/unavailable/failure
};
```

State transitions (per project, server): `idle → running → idle`; while running, at most one `queued` compile exists.

## Browser storage
| Key | Value |
|-----|-------|
| `overtree:compile` | `{ autoCompile: boolean, stopOnFirstError: boolean }`, default both `false` |
| `overtree:pdf` | `{ dark: boolean }`, default `false` |
