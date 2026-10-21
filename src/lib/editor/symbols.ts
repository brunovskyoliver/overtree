// Symbol palette data (feature 015): a Unicode glyph to show, the LaTeX command to insert, a name to search.
// Every command is complete (no empty argument to fill) and works in math mode; a few need amssymb
// (\mathbb, \nexists, \Box, \Diamond, \iint), which most templates load.

export type Sym = { glyph: string; cmd: string; name: string };
export type Category = { name: string; symbols: Sym[] };

const s = (glyph: string, cmd: string, name: string): Sym => ({ glyph, cmd, name });

export const CATEGORIES: Category[] = [
	{
		name: 'Greek',
		symbols: [
			s('α', '\\alpha', 'alpha'), s('β', '\\beta', 'beta'), s('γ', '\\gamma', 'gamma'), s('δ', '\\delta', 'delta'),
			s('ε', '\\epsilon', 'epsilon'), s('ϵ', '\\varepsilon', 'epsilon variant'), s('ζ', '\\zeta', 'zeta'), s('η', '\\eta', 'eta'),
			s('θ', '\\theta', 'theta'), s('ϑ', '\\vartheta', 'theta variant'), s('ι', '\\iota', 'iota'), s('κ', '\\kappa', 'kappa'),
			s('λ', '\\lambda', 'lambda'), s('μ', '\\mu', 'mu'), s('ν', '\\nu', 'nu'), s('ξ', '\\xi', 'xi'), s('π', '\\pi', 'pi'),
			s('ϖ', '\\varpi', 'pi variant'), s('ρ', '\\rho', 'rho'), s('ϱ', '\\varrho', 'rho variant'), s('σ', '\\sigma', 'sigma'),
			s('ς', '\\varsigma', 'sigma final'), s('τ', '\\tau', 'tau'), s('υ', '\\upsilon', 'upsilon'), s('φ', '\\phi', 'phi'),
			s('ϕ', '\\varphi', 'phi variant'), s('χ', '\\chi', 'chi'), s('ψ', '\\psi', 'psi'), s('ω', '\\omega', 'omega'),
			s('Γ', '\\Gamma', 'Gamma capital'), s('Δ', '\\Delta', 'Delta capital'), s('Θ', '\\Theta', 'Theta capital'),
			s('Λ', '\\Lambda', 'Lambda capital'), s('Ξ', '\\Xi', 'Xi capital'), s('Π', '\\Pi', 'Pi capital'),
			s('Σ', '\\Sigma', 'Sigma capital'), s('Υ', '\\Upsilon', 'Upsilon capital'), s('Φ', '\\Phi', 'Phi capital'),
			s('Ψ', '\\Psi', 'Psi capital'), s('Ω', '\\Omega', 'Omega capital')
		]
	},
	{
		name: 'Operators',
		symbols: [
			s('±', '\\pm', 'plus minus'), s('∓', '\\mp', 'minus plus'), s('×', '\\times', 'times multiply'), s('÷', '\\div', 'divide'),
			s('·', '\\cdot', 'dot multiply'), s('∗', '\\ast', 'asterisk'), s('∘', '\\circ', 'compose circle'), s('∙', '\\bullet', 'bullet'),
			s('⊕', '\\oplus', 'direct sum circled plus'), s('⊗', '\\otimes', 'tensor product circled times'), s('∩', '\\cap', 'intersection cap'),
			s('∪', '\\cup', 'union cup'), s('∧', '\\wedge', 'and wedge'), s('∨', '\\vee', 'or vee'), s('∖', '\\setminus', 'set minus'),
			s('∑', '\\sum', 'sum'), s('∏', '\\prod', 'product'), s('∐', '\\coprod', 'coproduct'), s('∫', '\\int', 'integral'),
			s('∬', '\\iint', 'double integral'), s('∮', '\\oint', 'contour integral'), s('⋂', '\\bigcap', 'big intersection'),
			s('⋃', '\\bigcup', 'big union'), s('∂', '\\partial', 'partial derivative'), s('∇', '\\nabla', 'nabla gradient'),
			s('√', '\\surd', 'square root surd'), s('lim', '\\lim', 'limit'), s('sin', '\\sin', 'sine'), s('cos', '\\cos', 'cosine'),
			s('log', '\\log', 'logarithm'), s('ln', '\\ln', 'natural logarithm'), s('max', '\\max', 'maximum'), s('min', '\\min', 'minimum')
		]
	},
	{
		name: 'Relations',
		symbols: [
			s('≤', '\\leq', 'less than or equal'), s('≥', '\\geq', 'greater than or equal'), s('≠', '\\neq', 'not equal'),
			s('≈', '\\approx', 'approximately'), s('≡', '\\equiv', 'equivalent identical'), s('∼', '\\sim', 'similar tilde'),
			s('≃', '\\simeq', 'similar or equal'), s('≅', '\\cong', 'congruent'), s('∝', '\\propto', 'proportional'),
			s('≪', '\\ll', 'much less'), s('≫', '\\gg', 'much greater'), s('∈', '\\in', 'element of in'), s('∉', '\\notin', 'not element of'),
			s('∋', '\\ni', 'contains as member'), s('⊂', '\\subset', 'subset'), s('⊃', '\\supset', 'superset'),
			s('⊆', '\\subseteq', 'subset or equal'), s('⊇', '\\supseteq', 'superset or equal'), s('⊥', '\\perp', 'perpendicular'),
			s('∥', '\\parallel', 'parallel'), s('∣', '\\mid', 'divides mid'), s('⊢', '\\vdash', 'proves turnstile'),
			s('⊨', '\\models', 'models'), s('≺', '\\prec', 'precedes'), s('≻', '\\succ', 'succeeds'), s('≐', '\\doteq', 'dot equal')
		]
	},
	{
		name: 'Arrows',
		symbols: [
			s('←', '\\leftarrow', 'left arrow'), s('→', '\\rightarrow', 'right arrow to'), s('↑', '\\uparrow', 'up arrow'),
			s('↓', '\\downarrow', 'down arrow'), s('↔', '\\leftrightarrow', 'left right arrow'), s('⇐', '\\Leftarrow', 'left double arrow'),
			s('⇒', '\\Rightarrow', 'right double arrow implies'), s('⇔', '\\Leftrightarrow', 'left right double arrow iff'),
			s('⟶', '\\longrightarrow', 'long right arrow'), s('⟵', '\\longleftarrow', 'long left arrow'),
			s('⟹', '\\Longrightarrow', 'long right double arrow'), s('⟺', '\\iff', 'if and only if'), s('↦', '\\mapsto', 'maps to'),
			s('↪', '\\hookrightarrow', 'hook right arrow injection'), s('⇀', '\\rightharpoonup', 'right harpoon'),
			s('⇌', '\\rightleftharpoons', 'right left harpoons equilibrium'), s('↗', '\\nearrow', 'north east arrow'),
			s('↘', '\\searrow', 'south east arrow'), s('↙', '\\swarrow', 'south west arrow'), s('↖', '\\nwarrow', 'north west arrow'),
			s('⇑', '\\Uparrow', 'up double arrow'), s('⇓', '\\Downarrow', 'down double arrow')
		]
	},
	{
		name: 'Delimiters',
		symbols: [
			s('{', '\\{', 'left brace'), s('}', '\\}', 'right brace'), s('⟨', '\\langle', 'left angle bracket'),
			s('⟩', '\\rangle', 'right angle bracket'), s('⌊', '\\lfloor', 'left floor'), s('⌋', '\\rfloor', 'right floor'),
			s('⌈', '\\lceil', 'left ceiling'), s('⌉', '\\rceil', 'right ceiling'), s('|', '\\vert', 'vertical bar'),
			s('‖', '\\Vert', 'double vertical bar norm'), s('\\', '\\backslash', 'backslash'), s('(', '\\left(', 'left parenthesis sized'),
			s(')', '\\right)', 'right parenthesis sized')
		]
	},
	{
		name: 'Misc',
		symbols: [
			s('∞', '\\infty', 'infinity'), s('∀', '\\forall', 'for all'), s('∃', '\\exists', 'exists'), s('∄', '\\nexists', 'not exists'),
			s('∅', '\\emptyset', 'empty set'), s('¬', '\\neg', 'not negation'), s('ℵ', '\\aleph', 'aleph'), s('ℏ', '\\hbar', 'h bar planck'),
			s('ℓ', '\\ell', 'ell script l'), s('℘', '\\wp', 'weierstrass p'), s('ℜ', '\\Re', 'real part'), s('ℑ', '\\Im', 'imaginary part'),
			s('ℕ', '\\mathbb{N}', 'natural numbers'), s('ℤ', '\\mathbb{Z}', 'integers'), s('ℚ', '\\mathbb{Q}', 'rationals'),
			s('ℝ', '\\mathbb{R}', 'real numbers'), s('ℂ', '\\mathbb{C}', 'complex numbers'), s('′', '\\prime', 'prime'),
			s('°', '^\\circ', 'degree'), s('…', '\\ldots', 'dots ellipsis'), s('⋯', '\\cdots', 'centered dots'), s('⋮', '\\vdots', 'vertical dots'),
			s('⋱', '\\ddots', 'diagonal dots'), s('∠', '\\angle', 'angle'), s('△', '\\triangle', 'triangle'), s('□', '\\Box', 'box square'),
			s('◇', '\\Diamond', 'diamond'), s('♠', '\\spadesuit', 'spade'), s('♥', '\\heartsuit', 'heart'), s('★', '\\star', 'star'),
			s('†', '\\dagger', 'dagger'), s('‡', '\\ddagger', 'double dagger'), s('⊤', '\\top', 'top'), s('⊥', '\\bot', 'bottom false')
		]
	}
];

/** Symbols whose command or name contains every word of `query` (case-insensitive); a leading `\` is ignored. */
export function searchSymbols(query: string): Sym[] {
	const words = query.toLowerCase().replace(/^\\/, '').split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return CATEGORIES.flatMap((c) => c.symbols).filter((x) => {
		const hay = `${x.cmd.toLowerCase()} ${x.name.toLowerCase()}`;
		return words.every((w) => hay.includes(w));
	});
}
