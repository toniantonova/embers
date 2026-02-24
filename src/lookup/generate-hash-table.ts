/**
 * generate-hash-table.ts — Offline script to generate verb-hash-table.json.
 *
 * WHAT THIS DOES:
 * ───────────────
 * Reads all 20 template JSON files, extracts their anchor_verbs, generates
 * conjugation variants (3rd person, gerund, past tense, past participle),
 * and writes a flat { verb: templateId } JSON file.
 *
 * CONJUGATION STRATEGY (hand-rolled, NOT compromise.js):
 * ──────────────────────────────────────────────────────
 * This uses an explicit irregular verb table (90+ verbs) plus regular
 * suffix rules. This gives us more control and auditability than using
 * compromise's conjugation at generation time.
 *
 * Irregular verbs: "swim" → ["swims", "swimming", "swam", "swum"] (correct)
 * Regular verbs:   "walk" → ["walks", "walking", "walked"] (suffix rules)
 *
 * A6 (template expansion to 200+ templates) can rely on this same
 * conjugation pipeline — just add anchor verbs to new templates and
 * re-run this script.
 *
 * USAGE:
 * ──────
 *   npx tsx src/lookup/generate-hash-table.ts
 *
 * OUTPUT:
 * ───────
 *   data/verb-hash-table.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ── IRREGULAR VERB TABLE ────────────────────────────────────────────
// Every anchor verb that is irregular should be in this table.
// Format: base → [3rd_person, gerund, past, past_participle]

const IRREGULAR_VERBS: Record<string, string[]> = {
    run: ['runs', 'running', 'ran', 'run'],
    eat: ['eats', 'eating', 'ate', 'eaten'],
    fly: ['flies', 'flying', 'flew', 'flown'],
    swim: ['swims', 'swimming', 'swam', 'swum'],
    shake: ['shakes', 'shaking', 'shook', 'shaken'],
    spin: ['spins', 'spinning', 'spun', 'spun'],
    grow: ['grows', 'growing', 'grew', 'grown'],
    speak: ['speaks', 'speaking', 'spoke', 'spoken'],
    break: ['breaks', 'breaking', 'broke', 'broken'],
    take: ['takes', 'taking', 'took', 'taken'],
    give: ['gives', 'giving', 'gave', 'given'],
    come: ['comes', 'coming', 'came', 'come'],
    go: ['goes', 'going', 'went', 'gone'],
    know: ['knows', 'knowing', 'knew', 'known'],
    see: ['sees', 'seeing', 'saw', 'seen'],
    get: ['gets', 'getting', 'got', 'gotten'],
    make: ['makes', 'making', 'made', 'made'],
    find: ['finds', 'finding', 'found', 'found'],
    stand: ['stands', 'standing', 'stood', 'stood'],
    sit: ['sits', 'sitting', 'sat', 'sat'],
    lie: ['lies', 'lying', 'lay', 'lain'],
    lay: ['lays', 'laying', 'laid', 'laid'],
    rise: ['rises', 'rising', 'rose', 'risen'],
    fall: ['falls', 'falling', 'fell', 'fallen'],
    dive: ['dives', 'diving', 'dove', 'dived'],
    leap: ['leaps', 'leaping', 'leapt', 'leapt'],
    creep: ['creeps', 'creeping', 'crept', 'crept'],
    sweep: ['sweeps', 'sweeping', 'swept', 'swept'],
    slide: ['slides', 'sliding', 'slid', 'slid'],
    ride: ['rides', 'riding', 'rode', 'ridden'],
    hide: ['hides', 'hiding', 'hid', 'hidden'],
    write: ['writes', 'writing', 'wrote', 'written'],
    bite: ['bites', 'biting', 'bit', 'bitten'],
    sing: ['sings', 'singing', 'sang', 'sung'],
    swing: ['swings', 'swinging', 'swung', 'swung'],
    cling: ['clings', 'clinging', 'clung', 'clung'],
    fling: ['flings', 'flinging', 'flung', 'flung'],
    shrink: ['shrinks', 'shrinking', 'shrank', 'shrunk'],
    drink: ['drinks', 'drinking', 'drank', 'drunk'],
    spring: ['springs', 'springing', 'sprang', 'sprung'],
    tear: ['tears', 'tearing', 'tore', 'torn'],
    wear: ['wears', 'wearing', 'wore', 'worn'],
    throw: ['throws', 'throwing', 'threw', 'thrown'],
    blow: ['blows', 'blowing', 'blew', 'blown'],
    draw: ['draws', 'drawing', 'drew', 'drawn'],
    show: ['shows', 'showing', 'showed', 'shown'],
    freeze: ['freezes', 'freezing', 'froze', 'frozen'],
    wake: ['wakes', 'waking', 'woke', 'woken'],
    fight: ['fights', 'fighting', 'fought', 'fought'],
    think: ['thinks', 'thinking', 'thought', 'thought'],
    bring: ['brings', 'bringing', 'brought', 'brought'],
    dig: ['digs', 'digging', 'dug', 'dug'],
    stick: ['sticks', 'sticking', 'stuck', 'stuck'],
    hang: ['hangs', 'hanging', 'hung', 'hung'],
    swell: ['swells', 'swelling', 'swelled', 'swollen'],
    melt: ['melts', 'melting', 'melted', 'molten'],
    bend: ['bends', 'bending', 'bent', 'bent'],
    lend: ['lends', 'lending', 'lent', 'lent'],
    send: ['sends', 'sending', 'sent', 'sent'],
    spend: ['spends', 'spending', 'spent', 'spent'],
    build: ['builds', 'building', 'built', 'built'],
    burn: ['burns', 'burning', 'burnt', 'burnt'],
    burst: ['bursts', 'bursting', 'burst', 'burst'],
    cut: ['cuts', 'cutting', 'cut', 'cut'],
    hit: ['hits', 'hitting', 'hit', 'hit'],
    put: ['puts', 'putting', 'put', 'put'],
    set: ['sets', 'setting', 'set', 'set'],
    shut: ['shuts', 'shutting', 'shut', 'shut'],
    split: ['splits', 'splitting', 'split', 'split'],
    spread: ['spreads', 'spreading', 'spread', 'spread'],
    shed: ['sheds', 'shedding', 'shed', 'shed'],
    seek: ['seeks', 'seeking', 'sought', 'sought'],
    weave: ['weaves', 'weaving', 'wove', 'woven'],
    wind: ['winds', 'winding', 'wound', 'wound'],
    grind: ['grinds', 'grinding', 'ground', 'ground'],
    stink: ['stinks', 'stinking', 'stank', 'stunk'],
    sink: ['sinks', 'sinking', 'sank', 'sunk'],
};


/**
 * Generate conjugation variants for a verb.
 * Returns the base form + all conjugations.
 *
 * Uses irregular table first (90+ entries), then regular suffix rules:
 *   3rd person: -s, -es (sibilants), -ies (consonant+y)
 *   Gerund:     -ing (with e-drop, consonant doubling for short CVC)
 *   Past:       -ed, -d (ends in e), -ied (consonant+y)
 */
function conjugate(verb: string): string[] {
    const base = verb.toLowerCase();
    const forms = new Set<string>([base]);

    // Check irregular dictionary first
    if (IRREGULAR_VERBS[base]) {
        for (const form of IRREGULAR_VERBS[base]) {
            forms.add(form);
        }
        return Array.from(forms);
    }

    // Regular conjugation rules
    const lastChar = base[base.length - 1];
    const lastTwo = base.slice(-2);
    const endsInE = lastChar === 'e';
    const endsInConsonantY = lastTwo.match(/[^aeiou]y$/);
    const endsInSibilant = /(?:s|x|z|ch|sh)$/.test(base);
    const shortCVC = base.length <= 4 && /^[^aeiou]*[aeiou][^aeiouxyw]$/.test(base);
    const endsInDoubleConsonant = /[^aeiou][^aeiou]$/.test(base) && base.length > 2;

    // 3rd person singular
    if (endsInConsonantY) {
        forms.add(base.slice(0, -1) + 'ies');
    } else if (endsInSibilant) {
        forms.add(base + 'es');
    } else {
        forms.add(base + 's');
    }

    // Gerund (-ing)
    if (endsInE && base.length > 2) {
        forms.add(base.slice(0, -1) + 'ing');
    } else if (shortCVC && !endsInDoubleConsonant) {
        forms.add(base + base[base.length - 1] + 'ing');
    } else {
        forms.add(base + 'ing');
    }

    // Past tense (-ed)
    if (endsInE) {
        forms.add(base + 'd');
    } else if (endsInConsonantY) {
        forms.add(base.slice(0, -1) + 'ied');
    } else if (shortCVC && !endsInDoubleConsonant) {
        forms.add(base + base[base.length - 1] + 'ed');
    } else {
        forms.add(base + 'ed');
    }

    return Array.from(forms);
}


// ── MAIN SCRIPT ─────────────────────────────────────────────────────

function main() {
    const templatesDir = path.resolve(__dirname, '../templates/templates');
    const outputPath = path.resolve(__dirname, '../../data/verb-hash-table.json');

    console.log(`Reading templates from: ${templatesDir}`);
    console.log(`Output to: ${outputPath}`);

    const jsonFiles = findJsonFiles(templatesDir);
    console.log(`Found ${jsonFiles.length} template files`);

    const hashTable: Record<string, string> = {};
    let totalVerbs = 0;
    let totalConjugations = 0;

    for (const file of jsonFiles) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const template = JSON.parse(content);

            if (!template.template_id || !template.anchor_verbs) {
                console.warn(`  Skipping ${path.basename(file)}: missing template_id or anchor_verbs`);
                continue;
            }

            const templateId = template.template_id;
            const anchorVerbs: string[] = template.anchor_verbs;

            console.log(`  ${templateId}: ${anchorVerbs.length} anchor verbs`);
            totalVerbs += anchorVerbs.length;

            for (const verb of anchorVerbs) {
                const forms = conjugate(verb);
                for (const form of forms) {
                    if (hashTable[form] && hashTable[form] !== templateId) {
                        console.warn(`    Collision: "${form}" already → "${hashTable[form]}", overwriting → "${templateId}"`);
                    }
                    hashTable[form] = templateId;
                    totalConjugations++;
                }
            }
        } catch (err) {
            console.error(`  Error processing ${file}:`, err);
        }
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(hashTable, null, 2) + '\n');

    console.log(`\nDone!`);
    console.log(`  Templates: ${jsonFiles.length}`);
    console.log(`  Anchor verbs: ${totalVerbs}`);
    console.log(`  Total entries (with conjugations): ${totalConjugations}`);
    console.log(`  Unique entries: ${Object.keys(hashTable).length}`);
    console.log(`  Conjugation strategy: hand-rolled (90+ irregulars + regular suffix rules)`);
    console.log(`  Output: ${outputPath}`);
}


function findJsonFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findJsonFiles(fullPath));
        } else if (entry.name.endsWith('.json')) {
            results.push(fullPath);
        }
    }
    return results;
}


main();
