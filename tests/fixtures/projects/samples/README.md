# Sample projects (SC-002)

Three thesis-like projects written for these tests. `tests/unit/compile-multi.test.ts` zips each folder with fflate, imports it with `importZip`, compiles it in `texlive/texlive:latest-medium` and checks the page count from the log line `Output written on ... (N pages`.

| Folder | What it exercises | Main file | Pages |
| --- | --- | --- | --- |
| `thesis-book` | `book` class, front/main/back matter, `\include`d chapters, PNG figures in `figures/`, table, bibtex (`plain`) | `main.tex` | 17 |
| `article-biblatex` | `article`, biblatex `authoryear` with biber, `\graphicspath`, images in `img/` and `img/plots/`, hyperref | `main.tex` | 2 |
| `report-sty` | `report`, custom `thesisstyle.sty` (title page, header, `remark` environment), `\include`d chapters, image in `graphics/` | `thesis.tex` (picked because it is the only `.tex` with `\documentclass`) | 5 |

Change a sample and the count may change: update both this table and the test.
