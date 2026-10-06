// Bundled completion data (research R11), hand-written for Overtree.
// In the lists below `#{}` marks a tab stop (CodeMirror reads `#{}` like `${}`; String.raw can't hold `${`).
// Exported snippets use `${}`; the popup label is the snippet without its tab stops.

export type BundledCommand = { label: string; snippet: string; detail?: string; boost?: number };
export type BundledEnvironment = { name: string; snippet: string };

/** `\textbf{#{}}` → `\textbf{${}}${}`: a last stop after the text so Tab leaves the braces. Numbered stops are kept as written. */
function toSnippet(compact: string) {
	let s = compact.replace(/#\{/g, '${');
	if (s.includes('${}') && !s.endsWith('${}')) s += '${}';
	return s;
}
const labelOf = (snippet: string) => snippet.replace(/\$\{[^}]*\}/g, '');

// The most used commands first: they rank above the rest when the typed text matches equally well
// (this order is what the popup shows for a bare `\`, like reference-autocomplete.png).
// `\begin{}` gets its `\end{}` and the name mirror from source.ts.
const COMMON = String.raw`
\usepackage{#{1}}#{0} \begin{#{1}} \end{#{}} \usepackage[#{2}]{#{1}}#{0} \item \item[#{}] \section{#{}} \subsection{#{}}
\textbf{#{}} \textit{#{}} \emph{#{}} \label{#{}} \ref{#{}} \cite{#{}} \frac{#{}}{#{}} \includegraphics{#{}}
\includegraphics[#{}]{#{}} \caption{#{}} \centering \documentclass{#{}} \footnote{#{}} \maketitle \tableofcontents
\newcommand{#{}}{#{}} \hspace{#{}} \vspace{#{}} \title{#{}} \author{#{}} \texttt{#{}} \mathbb{#{}} \mathbf{#{}}
\subsubsection{#{}} \paragraph{#{}} \sqrt{#{}} \sum \url{#{}} \bibliography{#{}} \input{#{}} \alpha
`;

const OTHER = String.raw`
\documentclass[#{}]{#{}} \RequirePackage{#{}} \NeedsTeXFormat{#{}} \ProvidesPackage{#{}} \ProvidesClass{#{}}
\LoadClass{#{}} \DeclareOption{#{}}{#{}} \ProcessOptions \PassOptionsToPackage{#{}}{#{}}
\part{#{}} \chapter{#{}} \section*{#{}} \section[#{}]{#{}} \subsection*{#{}} \subsubsection*{#{}} \chapter*{#{}}
\subparagraph{#{}} \appendix \frontmatter \mainmatter \backmatter \date{#{}} \today \thanks{#{}} \and
\listoffigures \listoftables \include{#{}} \includeonly{#{}} \bibliographystyle{#{}} \addbibresource{#{}}
\printbibliography \nocite{#{}} \citep{#{}} \citet{#{}} \parencite{#{}} \textcite{#{}} \autocite{#{}} \cite[#{}]{#{}}
\eqref{#{}} \pageref{#{}} \autoref{#{}} \cref{#{}} \Cref{#{}} \nameref{#{}} \hyperref[#{}]{#{}} \href{#{}}{#{}}
\textsc{#{}} \textsf{#{}} \textrm{#{}} \textmd{#{}} \textup{#{}} \textsl{#{}} \textnormal{#{}} \underline{#{}}
\text{#{}} \textcolor{#{}}{#{}} \color{#{}} \colorbox{#{}}{#{}} \fcolorbox{#{}}{#{}}{#{}} \definecolor{#{}}{#{}}{#{}}
\bfseries \itshape \ttfamily \sffamily \rmfamily \scshape \mdseries \upshape \slshape \normalfont
\tiny \scriptsize \footnotesize \small \normalsize \large \Large \LARGE \huge \Huge
\newline \linebreak \pagebreak \newpage \clearpage \cleardoublepage \noindent \indent \par \smallskip \medskip
\bigskip \vfill \hfill \hline \cline{#{}} \toprule \midrule \bottomrule \cmidrule{#{}} \multicolumn{#{}}{#{}}{#{}}
\multirow{#{}}{#{}}{#{}} \tabularnewline \arraystretch \tabcolsep \linewidth \textwidth \textheight \columnwidth
\paperwidth \paperheight \baselineskip \parindent \parskip \setlength{#{}}{#{}} \addtolength{#{}}{#{}}
\setcounter{#{}}{#{}} \addtocounter{#{}}{#{}} \stepcounter{#{}} \newcounter{#{}} \value{#{}} \arabic{#{}}
\roman{#{}} \Roman{#{}} \alph{#{}} \Alph{#{}} \thepage \pagenumbering{#{}} \pagestyle{#{}} \thispagestyle{#{}}
\renewcommand{#{}}{#{}} \newcommand{#{}}[#{}]{#{}} \providecommand{#{}}{#{}} \newenvironment{#{}}{#{}}{#{}}
\renewenvironment{#{}}{#{}}{#{}} \DeclareMathOperator{#{}}{#{}} \newtheorem{#{}}{#{}} \theoremstyle{#{}}
\def \let \makeatletter \makeatother \ensuremath{#{}} \mbox{#{}} \makebox{#{}} \fbox{#{}} \framebox{#{}}
\parbox{#{}}{#{}} \raisebox{#{}}{#{}} \resizebox{#{}}{#{}}{#{}} \scalebox{#{}}{#{}} \rotatebox{#{}}{#{}}
\graphicspath{#{}} \caption*{#{}} \captionof{#{}}{#{}} \subcaption{#{}} \listof \footnotemark \footnotetext{#{}}
\marginpar{#{}} \verb \lstinline \lstinputlisting{#{}} \hyphenation{#{}} \selectlanguage{#{}} \geometry{#{}}
\hypersetup{#{}} \tikz \draw \node \fill \filldraw \path \coordinate \usetikzlibrary{#{}} \pgfplotsset{#{}}
\addplot \foreach \LaTeX \TeX \LaTeXe \ldots \dots \cdots \vdots \ddots \quad \qquad \enspace \thinspace
\displaystyle \textstyle \scriptstyle \left( \right) \left[ \right] \bigl \bigr \Bigl \Bigr \middle
\dfrac{#{}}{#{}} \tfrac{#{}}{#{}} \binom{#{}}{#{}} \sqrt[#{}]{#{}} \overline{#{}} \underbrace{#{}}_{#{}}
\overbrace{#{}}^{#{}} \hat{#{}} \widehat{#{}} \tilde{#{}} \widetilde{#{}} \bar{#{}} \vec{#{}} \dot{#{}} \ddot{#{}}
\mathrm{#{}} \mathit{#{}} \mathcal{#{}} \mathsf{#{}} \mathtt{#{}} \mathfrak{#{}} \mathscr{#{}} \boldsymbol{#{}}
\operatorname{#{}} \tag{#{}} \notag \nonumber \intertext{#{}} \substack{#{}} \stackrel{#{}}{#{}} \overset{#{}}{#{}}
\underset{#{}}{#{}} \prod \int \iint \iiint \oint \lim_{#{}} \limsup \liminf \sup \inf \max \min \log \ln \exp
\sin \cos \tan \cot \csc \arcsin \arccos \arctan \sinh \cosh \tanh \det \dim \ker \deg \gcd \arg \Pr
\infty \partial \nabla \pm \mp \times \div \cdot \circ \ast \star \oplus \otimes \leq \geq \neq \approx
\equiv \sim \simeq \cong \propto \ll \gg \subset \subseteq \supset \supseteq \in \notin \ni \cup \cap \setminus
\emptyset \varnothing \forall \exists \nexists \neg \land \lor \implies \impliedby \iff \to \gets \mapsto
\rightarrow \leftarrow \Rightarrow \Leftarrow \leftrightarrow \Leftrightarrow \longrightarrow \Longrightarrow
\uparrow \downarrow \langle \rangle \lfloor \rfloor \lceil \rceil \mid \parallel \perp \angle \prime \ell
\hbar \Re \Im \aleph \beta \gamma \delta \epsilon \varepsilon \zeta \eta \theta \vartheta \iota \kappa \lambda
\mu \nu \xi \pi \varpi \rho \varrho \sigma \varsigma \tau \upsilon \phi \varphi \chi \psi \omega \Gamma \Delta
\Theta \Lambda \Xi \Pi \Sigma \Upsilon \Phi \Psi \Omega \checkmark \dag \ddag \S \P \copyright \textregistered
\texttrademark \textdegree \textbackslash \textasciitilde \textbullet \textendash \textemdash \guillemotleft
\enquote{#{}} \si{#{}} \SI{#{}}{#{}} \num{#{}} \qty{#{}}{#{}} \unit{#{}} \todo{#{}} \lipsum \blindtext
`;

/** At least 300 common commands (spec FR-028). */
export const COMMANDS: BundledCommand[] = (() => {
	const common = COMMON.trim().split(/\s+/);
	const all = [...common, ...OTHER.trim().split(/\s+/)];
	return all.map((compact, i) => {
		const snippet = toSnippet(compact);
		const label = labelOf(snippet);
		return i < common.length ? { label, snippet, boost: common.length - i } : { label, snippet };
	});
})();

// Body lines of environments that need more than an empty line; `#{}` before the name's `}` adds arguments.
const BODIES: Record<string, string> = {
	itemize: String.raw`\item #{}`,
	enumerate: String.raw`\item #{}`,
	description: String.raw`\item[#{}] #{}`,
	figure: String.raw`\centering
#{}
\caption{#{}}
\label{#{}}`,
	'figure*': String.raw`\centering
#{}
\caption{#{}}`,
	table: String.raw`\centering
\caption{#{}}
\label{#{}}
#{}`,
	'table*': String.raw`\centering
\caption{#{}}
#{}`,
	frame: String.raw`\frametitle{#{}}
#{}`
};

const ARGS: Record<string, string> = {
	tabular: '{#{}}',
	'tabular*': '{#{}}{#{}}',
	tabularx: '{#{}}{#{}}',
	longtable: '{#{}}',
	array: '{#{}}',
	minipage: '{#{}}',
	wrapfigure: '{#{}}{#{}}',
	multicols: '{#{}}',
	thebibliography: '{#{}}',
	subfigure: '{#{}}',
	tikzpicture: '[#{}]',
	alignat: '{#{}}'
};

const ENVIRONMENT_NAMES = String.raw`
itemize enumerate description figure figure* table table* tabular tabular* tabularx longtable array equation
equation* align align* alignat gather gather* multline multline* split cases matrix pmatrix bmatrix vmatrix
Bmatrix Vmatrix smallmatrix center flushleft flushright minipage quote quotation verse verbatim abstract
document theorem lemma proof definition corollary proposition remark example thebibliography tikzpicture
axis frame block columns column lstlisting minted wrapfigure subfigure multicols titlepage appendices
displaymath math comment
`;

/** At least 40 common environments; the snippet is the whole `\begin…\end` block. */
export const ENVIRONMENTS: BundledEnvironment[] = ENVIRONMENT_NAMES.trim()
	.split(/\s+/)
	.map((name) => {
		const body = (BODIES[name] ?? '#{}').replace(/\n/g, '\n\t');
		return { name, snippet: toSnippet(`\\begin{${name}}${ARGS[name] ?? ''}\n\t${body}\n\\end{${name}}`) };
	});

/** At least 200 common package names. */
export const PACKAGES: string[] = `
amsmath amssymb amsthm amsfonts mathtools mathrsfs bm bbm dsfont esint cancel siunitx physics braket
graphicx xcolor color tikz pgfplots pgf pgfplotstable circuitikz tikz-cd forest tcolorbox mdframed framed
float caption subcaption subfig wrapfig sidecap placeins rotating pdflscape lscape adjustbox booktabs tabularx
tabulary longtable multirow multicol array colortbl makecell threeparttable diagbox ltablex supertabular
hyperref url cleveref nameref varioref bookmark xr natbib biblatex cite csquotes babel polyglossia fontspec
inputenc fontenc lmodern times mathptmx helvet courier palatino mathpazo newtxtext newtxmath libertine
sourcesanspro sourcecodepro inconsolata fourier charter kpfonts textcomp microtype geometry fancyhdr titlesec
titletoc tocloft setspace parskip indentfirst enumitem paralist footmisc footnote ragged2e lipsum blindtext
xspace ifthen etoolbox xparse xstring calc keyval kvoptions pgfkeys expl3 xkeyval environ verbatim fancyvrb
listings minted algorithm algorithmic algorithmicx algpseudocode algorithm2e appendix glossaries acronym
nomencl imakeidx makeidx index todonotes fixme comment soul ulem xurl hyphenat datetime datetime2 fmtcount
currfile standalone import subfiles docmute pdfpages eso-pic background watermark draftwatermark transparent
graphbox overpic epstopdf svg import chngcntr totcount lastpage zref refcount marginnote sidenotes tikzpagenodes
changepage multido forloop pgffor tikzscale qrcode tcolorbox fontawesome fontawesome5 academicons marvosym
pifont wasysym dingbat bbding skull stmaryrd mathabx MnSymbol txfonts pxfonts upgreek textgreek gensymb
units nicefrac xfrac chemfig mhchem chemformula tikz-feynman feynmp-auto pst-all pstricks auto-pst-pdf
beamer beamerposter tikzposter a0poster moderncv europasscv letter scrlayer-scrpage scrextend koma-script
memoir showframe layout vmargin anysize typearea hvfloat floatrow afterpage needspace ccaption epigraph
quoting lettrine mwe hologo metalogo dirtree menukeys tabto tabstackengine stackengine scalerel graphics
trimclip etex fixltx2e filecontents shellesc luacode luatextra unicode-math xltxtra xunicode CJKutf8 ctex
arabtex bidi hebrew cyrillic tipa linguex gb4e expex qtree tikz-qtree tree-dvips pgfgantt pgfornament
`
	.trim()
	.split(/\s+/)
	.filter((name, i, all) => all.indexOf(name) === i);
