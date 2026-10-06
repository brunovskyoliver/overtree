import { SEED } from './collab.ts';

// Starter `main.tex` per template (005 research R12). Each compiles with pdfLaTeX on texlive:latest-medium.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

export const TEMPLATES = ['blank', 'article', 'report', 'beamer', 'letter'] as const;
export type Template = (typeof TEMPLATES)[number];

export const isTemplate = (t: unknown): t is Template => TEMPLATES.includes(t as Template);

const ARTICLE = `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{hyperref}

\\title{Untitled project}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
A short summary of the article.
\\end{abstract}

\\section{Introduction}
Start writing here.

\\section{Method}
An equation:
\\begin{equation}
  E = mc^2
\\end{equation}

\\section{Conclusion}

\\end{document}
`;

const REPORT = `\\documentclass[11pt]{report}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}

\\title{Untitled project}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

\\chapter{Introduction}
Start writing here.

\\section{Background}

\\chapter{Results}

\\chapter{Conclusion}

\\end{document}
`;

const BEAMER = `\\documentclass{beamer}
\\usetheme{Madrid}

\\title{Untitled project}
\\author{}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\begin{frame}{Outline}
  \\begin{itemize}
    \\item First point
    \\item Second point
  \\end{itemize}
\\end{frame}

\\end{document}
`;

const LETTER = `\\documentclass[11pt]{letter}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}

\\signature{Your name}
\\address{Street 1 \\\\ City}
\\date{\\today}

\\begin{document}

\\begin{letter}{Recipient \\\\ Street 2 \\\\ City}
\\opening{Dear Sir or Madam,}

Start writing here.

\\closing{Yours faithfully,}
\\end{letter}

\\end{document}
`;

const TEXTS: Record<Template, string> = {
	blank: SEED,
	article: ARTICLE,
	report: REPORT,
	beamer: BEAMER,
	letter: LETTER
};

/** The title with LaTeX's special characters escaped, safe inside `\title{}`. */
export function latexEscape(s: string): string {
	return s.replace(/[\\{}$&#^_%~]/g, (c) =>
		c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\textasciicircum{}' : c === '~' ? '\\textasciitilde{}' : `\\${c}`
	);
}

/** The template's `main.tex` with `title` in `\title{}` (the letter class has none: unchanged). */
export const templateText = (template: Template, title: string): string =>
	TEXTS[template].replace('\\title{Untitled project}', () => `\\title{${latexEscape(title)}}`);
