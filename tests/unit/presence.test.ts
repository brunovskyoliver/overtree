import { describe, expect, it } from 'vitest';
import { colorFor, initials, lightColor, PALETTE } from '../../src/lib/presence.ts';

describe('colorFor', () => {
	it('is stable and from the palette', () => {
		for (const id of ['user_2abc', 'test_a@test.local', '']) {
			expect(PALETTE).toContain(colorFor(id));
			expect(colorFor(id)).toBe(colorFor(id));
		}
	});

	it('spreads ids over the palette', () => {
		const counts = new Map<string, number>();
		for (let i = 0; i < 800; i++) {
			const c = colorFor(`user_${i}`);
			counts.set(c, (counts.get(c) ?? 0) + 1);
		}
		expect(counts.size).toBe(PALETTE.length);
		// 100 per color on average: none far off
		for (const n of counts.values()) expect(n).toBeGreaterThan(50);
	});
});

describe('lightColor and initials', () => {
	it('adds 20 % alpha', () => {
		expect(lightColor('#81c995')).toBe('#81c99533');
	});

	it('takes first and last initials', () => {
		expect(initials('Ada Lovelace')).toBe('AL');
		expect(initials('ada')).toBe('A');
		expect(initials('Jean Paul Sartre')).toBe('JS');
		expect(initials('  ')).toBe('?');
		expect(initials('élodie durand')).toBe('ÉD');
	});
});
