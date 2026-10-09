/**
 * Katman bagimlilik kurali (Clean Architecture "dependency rule").
 *
 *   domain  <-  application  <-  interfaces / infrastructure  <-  main
 *
 * Bagimliliklar yalnizca ice dogru akar. Bu test kaynak dosyalardaki import'lari
 * okur ve kurali ihlal eden her satiri raporlar; boylece mimari bir belge olarak
 * kalmaz, CI'da korunur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const LAYERS = ['domain', 'application', 'interfaces', 'infrastructure', 'main'] as const;
type Layer = (typeof LAYERS)[number];

/** Her katmanin import edebilecegi katmanlar ve harici paketlere izin olup olmadigi. */
const RULES: Record<Layer, { layers: Layer[]; packages: boolean }> = {
  domain: { layers: ['domain'], packages: false },
  application: { layers: ['domain', 'application'], packages: false },
  interfaces: { layers: ['domain', 'application', 'interfaces'], packages: true },
  infrastructure: { layers: ['domain', 'application', 'infrastructure'], packages: true },
  main: { layers: [...LAYERS], packages: true },
};

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const layerOf = (file: string): Layer => path.relative(SRC, file).split(path.sep)[0] as Layer;

function violations(): string[] {
  const found: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const from = layerOf(file);
    const rule = RULES[from];
    const source = fs.readFileSync(file, 'utf8');

    for (const [, specifier] of source.matchAll(IMPORT_RE)) {
      if (!specifier) continue;
      const where = `${path.relative(SRC, file)} -> ${specifier}`;

      if (!specifier.startsWith('.')) {
        if (!rule.packages) found.push(`${where} (${from} harici paket import edemez)`);
        continue;
      }

      const target = layerOf(path.resolve(path.dirname(file), specifier));
      if (!rule.layers.includes(target)) found.push(`${where} (${from} -> ${target} yasak)`);
    }
  }
  return found;
}

describe('mimari', () => {
  it('src altinda yalnizca bilinen katmanlar vardir', () => {
    const dirs = fs.readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(dirs.map((d) => d.name).sort()).toEqual([...LAYERS].sort());
  });

  it('bagimliliklar yalnizca ice dogru akar', () => {
    expect(violations()).toEqual([]);
  });
});
