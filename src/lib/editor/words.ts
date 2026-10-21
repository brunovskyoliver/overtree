// Word count of a LaTeX file: the words a reader sees, roughly. Only the body when the file has one, no comments,
// no math, no command names, and no arguments that aren't text (labels, citations, file names, sizes).
// ponytail: regexes, not a parser; a macro's own text and \verb are counted as written. texcount when it matters.

const NOT_TEXT =
	/\\(?:begin|end|label|ref|eqref|autoref|pageref|cref|Cref|cite[a-z]*|nocite|usepackage|documentclass|input|include|includegraphics|bibliography|bibliographystyle|addbibresource|url|hspace|vspace|setlength|newcommand|renewcommand)(?![a-zA-Z@])\*?(?:\[[^\]]*\]|\{[^{}]*\})*/g;

export function wordCount(tex: string): number {
	const body = /\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/.exec(tex)?.[1] ?? tex;
	const text = body
		.replace(/(^|[^\\])%.*$/gm, '$1') // comments, not \%
		.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(^|[^\\])\$(?:\\.|[^$\\])*\$/g, '$1 ')
		.replace(/\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}[\s\S]*?\\end\{\1\2\}/g, ' ')
		.replace(NOT_TEXT, ' ')
		.replace(/\\[a-zA-Z@]+\*?|\\./g, ' ');
	return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}
